import { TransformNode, Vector3, Quaternion, type Scene, type WebXRDefaultExperience } from '@babylonjs/core';
import type { SceneGraph } from '../sceneGraph';
import type { GrabSystem } from '../interaction/grabSystem';
import type { EquipmentSystem } from '../interaction/equipmentSystem';
import { isEquipHand } from '../interaction/equipmentRegistry';
import { SignalingClient, type SignalingMessage } from './signalingClient';
import { PeerLink } from './peerConnection';
import type { PlayerInfo, SlotTransform, WorldStateMessage, WorldSyncMessage } from './protocol';
import { createGhostRig, type GhostRig, type TransformPose } from '../avatar/defaultAvatar';
import { validateWorldPackage, MAX_SHARED_SCENE_BYTES } from '$lib/worlds/package';

const PRESENCE_INTERVAL_MS = 50;
const STATE_INTERVAL_MS = 50;

interface GuestEntry {
	link: PeerLink;
	headProxy: TransformNode;
	handProxies: Map<'left' | 'right', TransformNode>;
	ghost: GhostRig;
	player: PlayerInfo;
	lastPresenceSequence: number;
	lastTriggerValueAt: number;
}

/**
 * Host-authoritative world state. Reliable messages carry commands and
 * snapshots; the unordered state channel carries presence and live scene
 * state so a delayed frame cannot block newer transforms.
 */
export class HostAuthority {
	private signaling: SignalingClient;
	private guests = new Map<string, GuestEntry>();
	private presenceTimer: ReturnType<typeof setInterval>;
	private stateTimer: ReturnType<typeof setInterval>;
	private correctionTimer: ReturnType<typeof setInterval>;
	private dirtyTransforms = new Map<string, SlotTransform>();
	private revision = 0;
	private lastTransforms = new Map<string, string>();
	private presenceSequence = 0;

	constructor(
		private scene: Scene,
		private xr: WebXRDefaultExperience,
		private sceneGraph: SceneGraph,
		private grabSystem: GrabSystem,
		private equipment: EquipmentSystem,
		private roomCode: string,
		private iceServers: RTCIceServer[],
		private localPlayer: PlayerInfo,
		private voice?: {
			localTrack?: { track: MediaStreamTrack; stream: MediaStream };
			onRemoteStream?(guestId: string, stream: MediaStream, targetNode: TransformNode): void;
		}
	) {
		this.signaling = new SignalingClient(roomCode, 'host');
		this.signaling.onMessage((msg) => this.handleSignaling(msg));
		this.presenceTimer = setInterval(() => this.broadcastOwnPresence(), PRESENCE_INTERVAL_MS);
		this.stateTimer = setInterval(() => this.broadcastStateIfChanged(), STATE_INTERVAL_MS);
		this.correctionTimer = setInterval(() => this.sendCorrections(), 1_000);
	}

	private getPlayers(): PlayerInfo[] {
		return [this.localPlayer, ...[...this.guests.values()].map((entry) => entry.player)];
	}

	/** Resolves a player id (the host's own `localPlayer.playerId`, or a connected guest's id) to its display name — used to attribute codeBlock-driven actions (e.g. who threw a ball) to a player. */
	getPlayerDisplayName(playerId: string): string | undefined {
		if (playerId === this.localPlayer.playerId) return this.localPlayer.displayName;
		return this.guests.get(playerId)?.player.displayName;
	}

	private getLocalPresence(): Extract<WorldStateMessage, { kind: 'presence' }> {
		const camera = this.xr.baseExperience.camera;
		const head: TransformPose = {
			position: camera.globalPosition.asArray() as TransformPose['position'],
			rotation: (camera.rotationQuaternion?.asArray() ?? [0, 0, 0, 1]) as TransformPose['rotation']
		};
		const hands: Partial<Record<'left' | 'right', TransformPose>> = {};
		for (const controller of this.xr.input.controllers) {
			if (controller.inputSource.handedness === 'none') continue;
			const node = controller.grip ?? controller.pointer;
			hands[controller.inputSource.handedness] = {
				position: node.absolutePosition.asArray() as TransformPose['position'],
				rotation: (node.rotationQuaternion?.asArray() ?? [0, 0, 0, 1]) as TransformPose['rotation']
			};
		}
		return {
			kind: 'presence',
			player: this.localPlayer,
			sequence: ++this.presenceSequence,
			timestamp: Date.now(),
			head,
			hands
		};
	}

	private broadcastOwnPresence(): void {
		const presence = this.getLocalPresence();
		for (const { link } of this.guests.values()) link.sendState(presence);
	}

	private handleSignaling(msg: SignalingMessage): void {
		if (msg.type === 'guest-joined') void this.addGuest(msg.guestId);
		else if (msg.type === 'guest-left') this.removeGuest(msg.guestId);
		else if (msg.type === 'answer' && 'fromId' in msg && msg.fromId) {
			void this.guests.get(msg.fromId)?.link.acceptAnswer(msg.payload as RTCSessionDescriptionInit);
		} else if (msg.type === 'ice-candidate' && 'fromId' in msg && msg.fromId) {
			void this.guests.get(msg.fromId)?.link.addIceCandidate(msg.payload as RTCIceCandidateInit);
		}
	}

	private async addGuest(guestId: string): Promise<void> {
		const ghost = createGhostRig(this.scene);
		const headProxy = new TransformNode(`guest-${guestId}-head`, this.scene);
		const player: PlayerInfo = { playerId: guestId, displayName: 'Guest', role: 'guest' };

		const link = new PeerLink(
			{
				iceServers: this.iceServers,
				onData: (data, channel) => this.handleData(guestId, data, channel),
				onOpen: () => {
					this.sendSnapshotToGuest(guestId);
				},
				onConnectionStateChange: (state) => {
					if (state === 'failed' || state === 'closed') this.removeGuest(guestId);
				},
				onRemoteTrack: (_track, streams) => {
					if (streams[0]) this.voice?.onRemoteStream?.(guestId, streams[0], headProxy);
				}
			},
			true
		);
		link.onIceCandidate((candidate) => {
			this.signaling.send({ type: 'ice-candidate', roomCode: this.roomCode, targetId: guestId, payload: candidate });
		});
		if (this.voice?.localTrack) link.addLocalAudioTrack(this.voice.localTrack.track, this.voice.localTrack.stream);

		this.guests.set(guestId, { link, headProxy, handProxies: new Map(), ghost, player, lastPresenceSequence: 0, lastTriggerValueAt: 0 });
		const offer = await link.createOffer();
		this.signaling.send({ type: 'offer', roomCode: this.roomCode, targetId: guestId, payload: offer });
	}

	private removeGuest(guestId: string): void {
		const entry = this.guests.get(guestId);
		if (!entry) return;
		this.guests.delete(guestId);
		this.grabSystem.release(`${guestId}:left`);
		this.grabSystem.release(`${guestId}:right`);
		// Whatever they had equipped goes back into the world at its current pose.
		this.equipment.releasePlayer(guestId);
		entry.link.close();
		entry.headProxy.dispose();
		for (const node of entry.handProxies.values()) node.dispose();
		entry.ghost.dispose();
		for (const { link } of this.guests.values()) link.send({ kind: 'player-left', playerId: entry.player.playerId });
		this.broadcastSnapshot();
	}

	private getHandProxy(guestId: string, hand: 'left' | 'right'): TransformNode {
		const entry = this.guests.get(guestId)!;
		let node = entry.handProxies.get(hand);
		if (!node) {
			node = new TransformNode(`guest-${guestId}-${hand}`, this.scene);
			entry.handProxies.set(hand, node);
		}
		return node;
	}

	private handlePresence(guestId: string, msg: Extract<WorldStateMessage, { kind: 'presence' }>): void {
		const entry = this.guests.get(guestId);
		if (!entry || msg.sequence <= entry.lastPresenceSequence) return;
		entry.lastPresenceSequence = msg.sequence;
		entry.player = { ...msg.player, role: 'guest' };
		entry.headProxy.position = Vector3.FromArray(msg.head.position);
		entry.headProxy.rotationQuaternion = Quaternion.FromArray(msg.head.rotation);
		entry.ghost.setPose({
			head: msg.head,
			leftHand: msg.hands.left ?? msg.head,
			rightHand: msg.hands.right ?? msg.head
		});
		for (const hand of ['left', 'right'] as const) {
			const pose = msg.hands[hand];
			if (!pose) continue;
			const node = this.getHandProxy(guestId, hand);
			node.position = Vector3.FromArray(pose.position);
			node.rotationQuaternion = Quaternion.FromArray(pose.rotation);
		}
		const normalized = { ...msg, player: entry.player } satisfies Extract<WorldStateMessage, { kind: 'presence' }>;
		for (const [otherGuestId, other] of this.guests) {
			if (otherGuestId !== guestId) other.link.sendState(normalized);
		}
	}

	private handleData(guestId: string, data: unknown, channel: 'reliable' | 'state'): void {
		if (channel === 'state') {
			const msg = data as WorldStateMessage;
			if (msg.kind === 'presence') this.handlePresence(guestId, msg);
			return;
		}

		const msg = data as WorldSyncMessage;
		const entry = this.guests.get(guestId);
		if (!entry) return;
		switch (msg.kind) {
			case 'player-hello':
				entry.player = { ...msg.player, role: 'guest' };
				this.sendSnapshotToGuest(guestId);
				this.broadcastSnapshot();
				break;
			case 'snapshot-ack':
				break;
			case 'resync-request':
				this.sendSnapshotToGuest(guestId);
				break;
			case 'grab-request': {
				if (!isEquipHand(msg.grabberId)) break;
				const hand = msg.grabberId;
				const grabberId = `${guestId}:${hand}`;
				this.grabSystem.grab(grabberId, this.getHandProxy(guestId, hand), msg.slotId);
				entry.link.send({
					kind: 'interaction-result',
					requestId: msg.requestId,
					accepted: this.grabSystem.getHeldSlot(grabberId) === msg.slotId,
					slotId: msg.slotId
				});
				this.broadcastSnapshot();
				break;
			}
			case 'equip-request': {
				if (!isEquipHand(msg.hand)) break;
				// The host is the only place equipment is decided: it checks the slot is
				// equippable, free, and that this guest's hand is free.
				const accepted = this.equipment.equip(guestId, msg.hand, this.getHandProxy(guestId, msg.hand), msg.slotId);
				entry.link.send({ kind: 'interaction-result', requestId: msg.requestId, accepted, slotId: msg.slotId });
				this.broadcastSnapshot();
				break;
			}
			case 'unequip-request':
				if (isEquipHand(msg.hand)) this.equipment.unequip(guestId, msg.hand);
				this.broadcastSnapshot();
				break;
			case 'use-request': {
				if (!isEquipHand(msg.hand) || (msg.phase !== 'press' && msg.phase !== 'release' && msg.phase !== 'value')) break;
				if (this.equipment.getUsableSlot(guestId, msg.hand, msg.slotId) !== msg.slotId) break; // not an object this guest has equipped or is holding in that hand
				const now = Date.now();
				if (msg.phase === 'value') {
					if (now - entry.lastTriggerValueAt < PRESENCE_INTERVAL_MS) break; // analog pulls are rate limited
					entry.lastTriggerValueAt = now;
				}
				const value = Number.isFinite(msg.value) ? Math.min(1, Math.max(0, msg.value)) : msg.phase === 'press' ? 1 : 0;
				// Runs once, here; anything it spawns reaches everyone through the snapshot.
				this.equipment.dispatchTrigger(guestId, msg.hand, msg.phase, value, msg.slotId);
				break;
			}
			case 'release-request':
				this.grabSystem.release(`${guestId}:${msg.grabberId}`);
				this.broadcastSnapshot();
				break;
			case 'spawn-request':
				try {
					for (const portal of msg.slot.components.filter((component) => component.type === 'worldPortal')) validateWorldPackage(portal.world);
					if (JSON.stringify([...this.sceneGraph.serialize(), msg.slot]).length > MAX_SHARED_SCENE_BYTES) throw new Error('Shared scene is too large');
				} catch { this.sendSnapshotToGuest(guestId); break; }
				if (!this.sceneGraph.getLive(msg.slot.id)) this.sceneGraph.addSlot(msg.slot);
				this.broadcastSnapshot();
				break;
			case 'delete-request':
				if (this.sceneGraph.getLive(msg.slotId)) this.sceneGraph.removeSlot(msg.slotId);
				this.broadcastSnapshot();
				break;
			case 'media-control-request':
				if (this.sceneGraph.controlMedia(msg.slotId, msg.action)) this.broadcastSnapshot();
				break;
		}
	}

	private broadcastStateIfChanged(): void {
		const changed: SlotTransform[] = [];
		const seen = new Set<string>();
		for (const { id, position, rotation, scale } of this.sceneGraph.serialize()) {
			seen.add(id);
			const transform = { id, position, rotation, scale };
			const signature = JSON.stringify(transform);
			if (this.lastTransforms.get(id) === signature) continue;
			this.lastTransforms.set(id, signature);
			changed.push(transform);
			this.dirtyTransforms.set(id, transform);
		}
		for (const id of this.lastTransforms.keys()) if (!seen.has(id)) this.lastTransforms.delete(id);
		if (changed.length === 0) return;
		this.revision++;
		const msg: WorldStateMessage = { kind: 'scene-state', revision: this.revision, transforms: changed };
		for (const { link } of this.guests.values()) link.sendState(msg);
	}

	/** Reliable final poses repair a lost last packet on the unordered state channel. */
	private sendCorrections(): void {
		if (this.dirtyTransforms.size === 0) return;
		const transforms = [...this.dirtyTransforms.values()];
		this.dirtyTransforms.clear();
		const msg: WorldSyncMessage = { kind: 'transform-correction', revision: this.revision, transforms };
		for (const { link } of this.guests.values()) link.send(msg);
	}

	private sendSnapshotToGuest(guestId: string): void {
		const entry = this.guests.get(guestId);
		if (!entry) return;
		entry.link.send({
			kind: 'scene-snapshot',
			revision: this.revision,
			tree: this.sceneGraph.serialize(),
			players: this.getPlayers(),
			equipped: this.equipment.registry.list()
		});
	}

	broadcastSnapshot(): void {
		const tree = this.sceneGraph.serialize();
		this.lastTransforms.clear();
		this.dirtyTransforms.clear();
		for (const { id, position, rotation, scale } of tree) this.lastTransforms.set(id, JSON.stringify({ id, position, rotation, scale }));
		this.revision++;
		for (const { link } of this.guests.values()) {
			link.send({ kind: 'scene-snapshot', revision: this.revision, tree, players: this.getPlayers(), equipped: this.equipment.registry.list() });
		}
	}

	dispose(): void {
		clearInterval(this.presenceTimer);
		clearInterval(this.stateTimer);
		clearInterval(this.correctionTimer);
		for (const guestId of [...this.guests.keys()]) this.removeGuest(guestId);
		this.signaling.close();
	}
}
