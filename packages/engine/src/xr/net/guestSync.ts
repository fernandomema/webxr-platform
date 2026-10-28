import { TransformNode, type Scene, type UniversalCamera, type WebXRDefaultExperience } from '@babylonjs/core';
import type { SceneGraph } from '../sceneGraph.ts';
import type { GrabSystem } from '../interaction/grabSystem.ts';
import type { EquipmentSystem } from '../interaction/equipmentSystem.ts';
import type { MediaControlAction, Slot, UIEvent } from '../../ecs/types.ts';
import { SignalingClient, type SignalingMessage } from './signalingClient.ts';
import { PeerLink } from './peerConnection.ts';
import type { PlayerApiResult } from '../../worldStorage/ops.ts';
import { PROTOCOL_VERSION, type PlayerInfo, type WorldStateMessage, type WorldSyncMessage } from './protocol.ts';
import { migrateSlotTree } from '../../assets/ref.ts';
import { createGhostRig, type GhostRig, type TransformPose } from '../avatar/defaultAvatar.ts';
import type { AvatarHooks } from '../avatar/avatarHooks.ts';
import { readHandPoses } from '../avatar/localHands.ts';
import { localKeyboardPresence } from '../keyboard/service.ts';
import { parseKeyboardPresence } from '../keyboard/presence.ts';
import { RemoteKeyboards } from '../keyboard/remoteKeyboards.ts';
import { AssetPeer } from '../../assets/p2p.ts';
import { announceAssetSourcesChanged, getLocalAssetStore } from '../../assets/store.ts';
import type { SlotTree } from '../../ecs/types.ts';
import { cameraHeadPose } from '../avatar/headPose.ts';
import { parseTeleportTarget, type TeleportTarget } from '../playerPoses.ts';
import type { PayResult } from '../payments/types.ts';

const PRESENCE_INTERVAL_MS = 50;
const HOLD_MOVE_INTERVAL_MS = 50;

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
	private paymentHandler: ((publicationId: string, sku: string, op: 'buy' | 'owns') => Promise<PayResult | { owns: boolean }>) | null = null;
	private teleportHandler: ((target: TeleportTarget) => void) | null = null;
	private bodyHandlers: { impulse: (velocity: [number, number, number], add: boolean) => void; haptic: (hand: 'left' | 'right' | 'both', intensity: number, durationMs: number) => void } | null = null;
	private equipHandler: ((slotId: string, hand: 'left' | 'right') => void) | null = null;
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
					this.link?.send({ kind: 'player-hello', player: this.localPlayer, protocol: PROTOCOL_VERSION });
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

	/** What to do when the host puts something in this player's hand (see `ctx.world.equipPlayer`): the same on the guest's own hands. */
	setEquipHandler(handler: (slotId: string, hand: 'left' | 'right') => void): void {
		this.equipHandler = handler;
	}

	/** What to do when the host pushes this player (see `ctx.world.setPlayerVelocity`) or buzzes a controller (`ctx.haptics.pulse`). */
	setBodyHandlers(handlers: { impulse: (velocity: [number, number, number], add: boolean) => void; haptic: (hand: 'left' | 'right' | 'both', intensity: number, durationMs: number) => void }): void {
		this.bodyHandlers = handlers;
	}

	/** What to do when the host moves this player (see `ctx.world.teleportPlayer`). */
	setTeleportHandler(handler: (target: TeleportTarget) => void): void {
		this.teleportHandler = handler;
	}

	/** What to do when the host asks this player to pay or whether they own something. Answered by this player's own client, with this player's account. */
	setPaymentHandler(handler: (publicationId: string, sku: string, op: 'buy' | 'owns') => Promise<PayResult | { owns: boolean }>): void {
		this.paymentHandler = handler;
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
			case 'session-rejected':
				console.error(`[net] the host runs an incompatible version of the engine (protocol ${msg.protocol}, this one speaks ${PROTOCOL_VERSION})`);
				this.endSession();
				break;
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
			case 'scene-delta': {
				if (msg.revision < this.snapshotRevision || !Array.isArray(msg.slots)) break;
				const unknown = this.sceneGraph.applyDeltas(msg.slots, this.locallyGrabbed);
				// A slot the host changed that this guest does not have: ask for the whole world again.
				if (unknown.length > 0) this.link?.send({ kind: 'resync-request', haveRevision: this.snapshotRevision });
				this.onSceneChanged?.();
				break;
			}
			case 'transform-correction':
				if (msg.revision >= this.snapshotRevision) {
					this.sceneGraph.applyTransforms(msg.transforms, this.locallyGrabbed);
					this.latestTransforms = { kind: 'scene-state', revision: msg.revision, transforms: msg.transforms };
				}
				break;
			case 'player-left':
				this.removeAvatar(msg.playerId);
				break;
			case 'spawn-ephemeral': {
				const slot = migrateSlotTree([msg.slot])[0];
				if (slot && !this.sceneGraph.getLive(slot.id)) this.sceneGraph.addSlot(slot);
				break;
			}
			case 'equip':
				if (msg.hand === 'left' || msg.hand === 'right') this.equipHandler?.(msg.slotId, msg.hand);
				break;
			case 'unequip':
				if (msg.hand === 'left' || msg.hand === 'right') this.equipment.unequip(this.localPlayer.playerId, msg.hand);
				break;
			case 'teleport': {
				const target = parseTeleportTarget(msg);
				if (target) this.teleportHandler?.(target);
				break;
			}
			case 'impulse': {
				const v = msg.velocity;
				if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 200)) this.bodyHandlers?.impulse(v as [number, number, number], msg.add === true);
				break;
			}
			case 'haptic': {
				const hand = msg.hand === 'left' || msg.hand === 'right' ? msg.hand : 'both';
				if (Number.isFinite(msg.intensity) && Number.isFinite(msg.durationMs)) this.bodyHandlers?.haptic(hand, Math.min(1, Math.max(0, msg.intensity)), Math.min(2000, Math.max(1, msg.durationMs)));
				break;
			}
			case 'player-api-request': {
				const requestId = msg.requestId;
				void (this.storageHooks?.handlePlayerApi(msg.publicationId, msg.call) ?? Promise.resolve<PlayerApiResult>({ ok: true, unavailable: true }))
					.then((result) => this.link?.send({ kind: 'player-api-response', requestId, result }));
				break;
			}
			case 'pay-request': {
				const { requestId, publicationId, sku, op } = msg;
				const unavailable = op === 'buy' ? { ok: false, reason: 'unavailable' as const } : { owns: false };
				void (this.paymentHandler?.(publicationId, sku, op) ?? Promise.resolve(unavailable))
					.catch(() => unavailable)
					.then((result) => this.link?.send({ kind: 'pay-response', requestId, result }));
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
		const head: TransformPose = cameraHeadPose(camera);
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
		this.pendingHoldMove = null;
		this.link?.send({ kind: 'release-request', requestId: crypto.randomUUID(), grabberId });
	}

	private holdMoveAt = 0;
	private holdMoveTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingHoldMove: Extract<WorldSyncMessage, { kind: 'hold-move' }> | null = null;

	/** Tells the host where this guest holds an object (when it is pushed or pulled along the laser), a few times a second, the last one always. */
	requestHoldMove(grabberId: string, slotId: string, position: [number, number, number], rotation: [number, number, number, number]): void {
		this.pendingHoldMove = { kind: 'hold-move', grabberId, slotId, position, rotation };
		const wait = this.holdMoveAt + HOLD_MOVE_INTERVAL_MS - Date.now();
		if (wait <= 0) this.flushHoldMove();
		else this.holdMoveTimer ??= setTimeout(() => this.flushHoldMove(), wait);
	}

	private flushHoldMove(): void {
		if (this.holdMoveTimer) clearTimeout(this.holdMoveTimer);
		this.holdMoveTimer = null;
		if (!this.pendingHoldMove) return;
		this.holdMoveAt = Date.now();
		this.link?.send(this.pendingHoldMove);
		this.pendingHoldMove = null;
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
