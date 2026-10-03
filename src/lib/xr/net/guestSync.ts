import { TransformNode, type Scene, type UniversalCamera, type WebXRDefaultExperience } from '@babylonjs/core';
import type { SceneGraph } from '../sceneGraph';
import type { GrabSystem } from '../interaction/grabSystem';
import type { EquipmentSystem } from '../interaction/equipmentSystem';
import type { MediaControlAction, Slot, UIEvent } from '$lib/ecs/types';
import { SignalingClient, type SignalingMessage } from './signalingClient';
import { PeerLink } from './peerConnection';
import type { PlayerApiResult } from '$lib/worldStorage/ops';
import type { PlayerInfo, WorldStateMessage, WorldSyncMessage } from './protocol';
import { migrateSlotTree } from '$lib/assets/ref';
import { createGhostRig, type GhostRig, type TransformPose } from '../avatar/defaultAvatar';
import type { AvatarHooks } from '../avatar/avatarHooks';
import { readHandPoses } from '../avatar/localHands';
import { localKeyboardPresence } from '../keyboard/service';
import { parseKeyboardPresence } from '../keyboard/presence';
import { RemoteKeyboards } from '../keyboard/remoteKeyboards';
import { AssetPeer } from '$lib/assets/p2p';
import { announceAssetSourcesChanged, getLocalAssetStore } from '$lib/assets/store';
import type { SlotTree } from '$lib/ecs/types';

const PRESENCE_INTERVAL_MS = 50;

/** Applies host-authoritative world state and renders every remote participant. */
export class GuestSync {
	private signaling: SignalingClient;
	private link: PeerLink | null = null;
	private locallyGrabbed = new Set<string>();
	private presenceTimer: ReturnType<typeof setInterval> | null = null;
	private pendingIceCandidates: RTCIceCandidateInit[] = [];
	private remoteAvatars = new Map<string, GhostRig>();
	private players = new Map<string, PlayerInfo>();
	private lastPresenceSequences = new Map<string, number>();
	private presenceSequence = 0;
	private snapshotRevision = -1;
	private transformRevision = -1;
	private latestTransforms: Extract<WorldStateMessage, { kind: 'scene-state' }> | null = null;
	private disposed = false;
	private avatars: AvatarHooks | null = null;
	private storageHooks: { onPublication(publicationId: string | null): void; handlePlayerApi(publicationId: string, call: unknown): Promise<PlayerApiResult> } | null = null;
	private assetPeer: AssetPeer | null = null;
	readonly hostProxy: TransformNode;
	/** Stand-ins of the other players' keyboards while they type. */
	private keyboards: RemoteKeyboards;

	constructor(
		private scene: Scene,
		private xr: WebXRDefaultExperience | null,
		private desktopCamera: UniversalCamera,
		private sceneGraph: SceneGraph,
		private grabSystem: GrabSystem,
		private equipment: EquipmentSystem,
		private roomCode: string,
		private iceServers: RTCIceServer[],
		private localPlayer: PlayerInfo,
		private voice?: {
			localTrack?: { track: MediaStreamTrack; stream: MediaStream };
			onRemoteStream?(stream: MediaStream, targetNode: TransformNode): void;
		},
		private onSessionEnded?: () => void,
		private onSceneChanged?: () => void,
		private onConnected?: () => void
	) {
		this.hostProxy = new TransformNode('host-proxy', scene);
		this.keyboards = new RemoteKeyboards(scene);
		this.signaling = new SignalingClient(roomCode, 'join');
		this.signaling.onMessage((msg) => this.handleSignaling(msg));
		this.presenceTimer = setInterval(() => this.sendPresence(), PRESENCE_INTERVAL_MS);
	}

	private handleSignaling(msg: SignalingMessage): void {
		if (msg.type === 'offer') void this.acceptOffer(msg.payload as RTCSessionDescriptionInit);
		else if (msg.type === 'ice-candidate') {
			if (this.link) void this.link.addIceCandidate(msg.payload as RTCIceCandidateInit);
			else this.pendingIceCandidates.push(msg.payload as RTCIceCandidateInit);
		} else if (msg.type === 'error') {
			this.endSession();
		} else if (msg.type === 'host-left') {
			this.endSession();
		}
	}

	private endSession(): void {
		if (this.disposed) return;
		this.dispose();
		this.onSessionEnded?.();
	}

	/** The host as a source of assets, once the link to it is up. */
	getAssetPeer(): AssetPeer | null {
		return this.link?.assetChannelOpen ? this.assetPeer : null;
	}

	private async acceptOffer(offer: RTCSessionDescriptionInit): Promise<void> {
		this.assetPeer = new AssetPeer((data) => this.link?.sendBinary(data) ?? Promise.resolve(), getLocalAssetStore(), 'host');
		this.link = new PeerLink(
			{
				iceServers: this.iceServers,
				onData: (data, channel) => this.handleData(data, channel),
				onBinary: (data) => this.assetPeer?.handle(data),
				onAssetChannelOpen: announceAssetSourcesChanged,
				onOpen: () => {
					this.link?.send({ kind: 'player-hello', player: this.localPlayer });
					this.onConnected?.();
				},
				onConnectionStateChange: (state) => {
					if (state === 'failed' || state === 'closed') this.endSession();
				},
				onRemoteTrack: (_track, streams) => {
					if (streams[0]) this.voice?.onRemoteStream?.(streams[0], this.hostProxy);
				}
			},
			false
		);
		this.link.onIceCandidate((candidate) => {
			this.signaling.send({ type: 'ice-candidate', roomCode: this.roomCode, payload: candidate });
		});
		if (this.voice?.localTrack) this.link.addLocalAudioTrack(this.voice.localTrack.track, this.voice.localTrack.stream);
		for (const candidate of this.pendingIceCandidates.splice(0)) await this.link.addIceCandidate(candidate);

		const answer = await this.link.createAnswer(offer);
		this.signaling.send({ type: 'answer', roomCode: this.roomCode, payload: answer });
	}

	private ensureAvatar(player: PlayerInfo): GhostRig | null {
		if (player.playerId === this.localPlayer.playerId) return null;
		let avatar = this.remoteAvatars.get(player.playerId);
		if (!avatar) {
			avatar = createGhostRig(this.scene, player.role === 'host' ? '#fbbf24' : '#38bdf8');
			this.remoteAvatars.set(player.playerId, avatar);
		}
		this.players.set(player.playerId, player);
		return avatar;
	}

	private syncPlayers(players: PlayerInfo[]): void {
		const remoteIds = new Set(players.filter((player) => player.playerId !== this.localPlayer.playerId).map((player) => player.playerId));
		for (const playerId of this.remoteAvatars.keys()) {
			if (!remoteIds.has(playerId)) this.removeAvatar(playerId);
		}
		for (const player of players) this.ensureAvatar(player);
	}

	setAvatarHooks(hooks: AvatarHooks): void {
		this.avatars = hooks;
	}

	setStorageHooks(hooks: { onPublication(publicationId: string | null): void; handlePlayerApi(publicationId: string, call: unknown): Promise<PlayerApiResult> }): void {
		this.storageHooks = hooks;
	}

	/** Tells the host which avatar this player wears. The host rebuilds it after checking it. */
	sendAvatar(slots: SlotTree): void {
		this.link?.send({ kind: 'avatar-set-request', slots });
	}

	private removeAvatar(playerId: string): void {
		this.avatars?.system.removePlayer(playerId);
		this.remoteAvatars.get(playerId)?.dispose();
		this.remoteAvatars.delete(playerId);
		this.keyboards.remove(playerId);
		this.players.delete(playerId);
		this.lastPresenceSequences.delete(playerId);
	}

	private applyPresence(msg: Extract<WorldStateMessage, { kind: 'presence' }>): void {
		if (msg.player.playerId === this.localPlayer.playerId) return;
		const previousSequence = this.lastPresenceSequences.get(msg.player.playerId) ?? 0;
		if (msg.sequence <= previousSequence) return;
		this.lastPresenceSequences.set(msg.player.playerId, msg.sequence);
		const avatar = this.ensureAvatar(msg.player);
		if (!avatar) return;
		this.keyboards.update(msg.player.playerId, parseKeyboardPresence(msg.keyboard));
		avatar.setPose({
			head: msg.head,
			leftHand: msg.hands.left ?? msg.head,
			rightHand: msg.hands.right ?? msg.head
		});
		if (this.avatars) {
			this.avatars.system.setRemotePose(msg.player.playerId, { head: msg.head, left: msg.hands.left, right: msg.hands.right });
			avatar.setVisible(!this.avatars.system.isDriving(msg.player.playerId));
		}
		if (msg.player.role === 'host') {
			this.hostProxy.position.set(...msg.head.position);
			this.hostProxy.rotationQuaternion = avatar.head.rotationQuaternion?.clone() ?? null;
		}
	}

	private handleData(data: unknown, channel: 'reliable' | 'state'): void {
		if (channel === 'state') {
			const msg = data as WorldStateMessage;
			if (msg.kind === 'presence') this.applyPresence(msg);
			else if (msg.kind === 'scene-state') {
				if (msg.revision <= this.transformRevision) return;
				this.transformRevision = msg.revision;
				this.latestTransforms = msg;
				if (this.snapshotRevision >= 0 && msg.revision >= this.snapshotRevision) this.sceneGraph.applyTransforms(msg.transforms, this.locallyGrabbed);
			}
			return;
		}

		const msg = data as WorldSyncMessage;
		switch (msg.kind) {
			case 'scene-snapshot':
				if (msg.revision < this.snapshotRevision) break;
				this.snapshotRevision = msg.revision;
				this.sceneGraph.reconcile(migrateSlotTree(msg.tree), this.locallyGrabbed);
				if (msg.equipped) this.equipment.applyRemote(msg.equipped, this.localPlayer.playerId);
				this.onSceneChanged?.();
				if (this.latestTransforms && this.latestTransforms.revision > msg.revision) this.sceneGraph.applyTransforms(this.latestTransforms.transforms, this.locallyGrabbed);
				this.syncPlayers(msg.players);
				if (msg.publicationId !== undefined) this.storageHooks?.onPublication(typeof msg.publicationId === 'string' ? msg.publicationId : null);
				this.link?.send({ kind: 'snapshot-ack', revision: msg.revision });
				break;
			case 'transform-correction':
				if (msg.revision >= this.snapshotRevision) {
					this.sceneGraph.applyTransforms(msg.transforms, this.locallyGrabbed);
					this.latestTransforms = { kind: 'scene-state', revision: msg.revision, transforms: msg.transforms };
				}
				break;
			case 'player-left':
				this.removeAvatar(msg.playerId);
				break;
			case 'player-api-request': {
				const requestId = msg.requestId;
				void (this.storageHooks?.handlePlayerApi(msg.publicationId, msg.call) ?? Promise.resolve<PlayerApiResult>({ ok: true, unavailable: true }))
					.then((result) => this.link?.send({ kind: 'player-api-response', requestId, result }));
				break;
			}
			case 'interaction-result':
				if (!msg.accepted && msg.slotId) {
					this.locallyGrabbed.delete(msg.slotId);
					// The host refused an equip we applied optimistically: take it back off.
					const holder = this.equipment.registry.getHolder(msg.slotId);
					if (holder?.playerId === this.localPlayer.playerId) this.equipment.unequip(holder.playerId, holder.hand);
				}
				break;
		}
	}

	private sendPresence(): void {
		if (!this.link) return;
		const camera = this.xr?.baseExperience.camera ?? this.desktopCamera;
		const head: TransformPose = {
			position: camera.globalPosition.asArray() as TransformPose['position'],
			rotation: (camera.rotationQuaternion?.asArray() ?? [0, 0, 0, 1]) as TransformPose['rotation']
		};
		const hands = readHandPoses(this.xr);
		const keyboard = localKeyboardPresence();
		this.link.sendState({
			kind: 'presence',
			player: this.localPlayer,
			sequence: ++this.presenceSequence,
			timestamp: Date.now(),
			head,
			hands,
			...(keyboard ? { keyboard } : {})
		});
	}

	requestGrab(grabberId: string, slotId: string): void {
		this.locallyGrabbed.add(slotId);
		this.link?.send({ kind: 'grab-request', requestId: crypto.randomUUID(), slotId, grabberId });
	}

	requestRelease(grabberId: string, slotId?: string): void {
		if (slotId) this.locallyGrabbed.delete(slotId);
		this.link?.send({ kind: 'release-request', requestId: crypto.randomUUID(), grabberId });
	}

	requestEquip(hand: 'left' | 'right', slotId: string): void {
		this.locallyGrabbed.add(slotId);
		this.link?.send({ kind: 'equip-request', requestId: crypto.randomUUID(), slotId, hand });
	}

	requestUnequip(hand: 'left' | 'right', slotId?: string): void {
		if (slotId) this.locallyGrabbed.delete(slotId);
		this.link?.send({ kind: 'unequip-request', requestId: crypto.randomUUID(), hand });
	}

	/** Sends this hand's trigger to the host, which runs the equipped object's actions. */
	requestUse(slotId: string, hand: 'left' | 'right', phase: 'press' | 'release' | 'value', value: number): void {
		this.link?.send({ kind: 'use-request', slotId, hand, phase, value });
	}

	requestSpawn(slot: Slot): void {
		this.link?.send({ kind: 'spawn-request', requestId: crypto.randomUUID(), slot });
	}

	requestDelete(slotId: string): void {
		this.link?.send({ kind: 'delete-request', requestId: crypto.randomUUID(), slotId });
	}

	requestMediaControl(slotId: string, action: MediaControlAction): void {
		this.link?.send({ kind: 'media-control-request', requestId: crypto.randomUUID(), slotId, action });
	}

	requestUIEvent(event: UIEvent): void {
		this.link?.send({ kind: 'ui-event-request', requestId: crypto.randomUUID(), event });
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.presenceTimer) clearInterval(this.presenceTimer);
		this.equipment.releaseAll(); // nothing stays equipped once the session is gone
		this.assetPeer?.close();
		this.link?.close();
		this.signaling.close();
		for (const avatar of this.remoteAvatars.values()) avatar.dispose();
		this.remoteAvatars.clear();
		this.keyboards.dispose();
		this.hostProxy.dispose();
	}
}
