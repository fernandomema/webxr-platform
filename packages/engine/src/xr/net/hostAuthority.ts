import { TransformNode, Vector3, Quaternion, type Scene, type UniversalCamera, type WebXRDefaultExperience } from '@babylonjs/core';
import type { SceneGraph } from '../sceneGraph.ts';
import type { GrabSystem } from '../interaction/grabSystem.ts';
import type { EquipmentSystem } from '../interaction/equipmentSystem.ts';
import { isEquipHand } from '../interaction/equipmentRegistry.ts';
import { SignalingClient, type SignalingMessage } from './signalingClient.ts';
import { PeerLink } from './peerConnection.ts';
import type { PlayerApiCall, PlayerApiResult } from '../../worldStorage/ops.ts';
import { PROTOCOL_VERSION, type PlayerInfo, type SlotTransform, type WorldStateMessage, type WorldSyncMessage } from './protocol.ts';
import type { Slot } from '../../ecs/types.ts';
import { createGhostRig, type GhostRig, type TransformPose } from '../avatar/defaultAvatar.ts';
import { validateWorldPackage, MAX_SHARED_SCENE_BYTES } from '../../worlds/package.ts';
import { migrateSlotTree } from '../../assets/ref.ts';
import type { AvatarHooks } from '../avatar/avatarHooks.ts';
import { readHandPoses } from '../avatar/localHands.ts';
import { localKeyboardPresence } from '../keyboard/service.ts';
import { parseKeyboardPresence } from '../keyboard/presence.ts';
import { RemoteKeyboards } from '../keyboard/remoteKeyboards.ts';
import { AssetPeer } from '../../assets/p2p.ts';
import { announceAssetSourcesChanged, getLocalAssetStore } from '../../assets/store.ts';
import { cameraHeadPose } from '../avatar/headPose.ts';
import { createThrottle } from './throttle.ts';
import type { PlayerSummary, TeleportTarget } from '../playerPoses.ts';
import type { PayResult } from '../payments/types.ts';

const PRESENCE_INTERVAL_MS = 50;
const STATE_INTERVAL_MS = 50;
/** Full snapshots go out at most this often: a script that spawns or switches things several times a frame costs one, not one each. */
const SNAPSHOT_MIN_INTERVAL_MS = 100;

interface GuestEntry {
	link: PeerLink;
	headProxy: TransformNode;
	handProxies: Map<'left' | 'right', TransformNode>;
	ghost: GhostRig;
	player: PlayerInfo;
	lastPresenceSequence: number;
	lastTriggerValueAt: number;
	lastAvatarAt: number;
	/** This guest as a source of assets, and a customer for ours. */
	assets: AssetPeer;
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
	private snapshotThrottle = createThrottle(() => this.sendSnapshotToAll(), SNAPSHOT_MIN_INTERVAL_MS);
	private dirtyTransforms = new Map<string, SlotTransform>();
	private revision = 0;
	private lastTransforms = new Map<string, string>();
	private presenceSequence = 0;
	private avatars: AvatarHooks | null = null;
	private storageHooks: { getPublicationId(): string | null; onPlayerReady(player: PlayerInfo): void; onPlayerLeft?(player: PlayerInfo): void } | null = null;
	private pendingPay = new Map<string, { guestId: string; resolve(result: PayResult | { owns: boolean }): void; timer: ReturnType<typeof setTimeout> }>();
	private pendingApi = new Map<string, { guestId: string; resolve(result: PlayerApiResult): void; timer: ReturnType<typeof setTimeout> }>();
	/** Stand-ins of the guests' keyboards while they type. */
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
			onRemoteStream?(guestId: string, stream: MediaStream, targetNode: TransformNode): void;
		}
	) {
		this.keyboards = new RemoteKeyboards(scene);
		this.signaling = new SignalingClient(roomCode, 'host');
		this.signaling.onMessage((msg) => this.handleSignaling(msg));
		this.presenceTimer = setInterval(() => this.broadcastOwnPresence(), PRESENCE_INTERVAL_MS);
		this.stateTimer = setInterval(() => this.broadcastStateIfChanged(), STATE_INTERVAL_MS);
		this.correctionTimer = setInterval(() => this.sendCorrections(), 1_000);
	}

	setAvatarHooks(hooks: AvatarHooks): void {
		this.avatars = hooks;
	}

	setStorageHooks(hooks: { getPublicationId(): string | null; onPlayerReady(player: PlayerInfo): void; onPlayerLeft?(player: PlayerInfo): void }): void {
		this.storageHooks = hooks;
	}

	/** Asks a connected guest to run `call` with its own account. Resolves with an error result, never rejects, when the guest is gone or silent. */
	relayPlayerApi(playerId: string, call: PlayerApiCall): Promise<PlayerApiResult> {
		const publicationId = this.storageHooks?.getPublicationId();
		const found = [...this.guests.entries()].find(([, entry]) => entry.player.playerId === playerId);
		if (!found || !publicationId) return Promise.resolve({ ok: false, error: 'That player is not connected' });
		const [guestId, entry] = found;
		const requestId = crypto.randomUUID();
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pendingApi.delete(requestId);
				resolve({ ok: false, error: 'The player did not answer' });
			}, 15_000);
			this.pendingApi.set(requestId, { guestId, resolve, timer });
			entry.link.send({ kind: 'player-api-request', requestId, publicationId, call });
		});
	}

	/** Asks a connected guest to pay for `sku` (or say whether they own it) with their own account. Never rejects: a guest who is gone or silent is `unavailable`. */
	relayPayment(playerId: string, op: 'buy' | 'owns', sku: string): Promise<PayResult | { owns: boolean }> {
		const publicationId = this.storageHooks?.getPublicationId();
		const found = [...this.guests.entries()].find(([, entry]) => entry.player.playerId === playerId);
		const unavailable = op === 'buy' ? { ok: false, reason: 'unavailable' as const } : { owns: false };
		if (!found || !publicationId) return Promise.resolve(unavailable);
		const [guestId, entry] = found;
		const requestId = crypto.randomUUID();
		return new Promise((resolve) => {
			// A purchase waits for a person to read and decide, so it is given longer than a storage call.
			const timer = setTimeout(() => {
				this.pendingPay.delete(requestId);
				resolve(unavailable);
			}, op === 'buy' ? 90_000 : 15_000);
			this.pendingPay.set(requestId, { guestId, resolve, timer });
			entry.link.send({ kind: 'pay-request', requestId, publicationId, sku, op });
		});
	}

	/** The id the equipment registry uses for a player: a guest's connection id, or the host's own id. */
	equipmentKeyFor(playerId: string): string {
		for (const [guestId, entry] of this.guests) if (entry.player.playerId === playerId) return guestId;
		return playerId;
	}

	/** The id scripts know a guest by (the one it announced), given its connection id; the connection id itself until it has announced one. */
	announcedIdFor(guestId: string): string {
		return this.guests.get(guestId)?.player.playerId ?? guestId;
	}

	/** The connected guests, as scripts see them. */
	listGuests(): PlayerSummary[] {
		return [...this.guests.values()].map((entry) => ({ id: entry.player.playerId, name: entry.player.displayName, role: 'guest' as const }));
	}

	private guestByPlayerId(playerId: string): GuestEntry | undefined {
		for (const entry of this.guests.values()) if (entry.player.playerId === playerId) return entry;
		return undefined;
	}

	/** Where a guest's head and tracked hands are now (world space), from the presence it last sent; `null` when it is not connected or has not sent any yet. */
	getGuestPose(playerId: string): { head: TransformPose; left?: TransformPose; right?: TransformPose } | null {
		const entry = this.guestByPlayerId(playerId);
		if (!entry || entry.lastPresenceSequence === 0) return null;
		const pose = (node: TransformNode): TransformPose => ({
			position: node.position.asArray() as TransformPose['position'],
			rotation: (node.rotationQuaternion ?? Quaternion.Identity()).asArray() as TransformPose['rotation']
		});
		const left = entry.handProxies.get('left');
		const right = entry.handProxies.get('right');
		return { head: pose(entry.headProxy), ...(left ? { left: pose(left) } : {}), ...(right ? { right: pose(right) } : {}) };
	}

	/** Asks a guest's browser to move its player. Returns whether that guest is connected. */
	teleportGuest(playerId: string, target: TeleportTarget): boolean {
		const entry = this.guestByPlayerId(playerId);
		if (!entry) return false;
		entry.link.send({ kind: 'teleport', position: target.position, ...(target.yaw === undefined ? {} : { yaw: target.yaw }) });
		return true;
	}

	/** Connected guests whose asset channel is open: places to ask for a model only they have. */
	getAssetPeers(): AssetPeer[] {
		return [...this.guests.values()].filter((entry) => entry.link.assetChannelOpen).map((entry) => entry.assets);
	}

	private getPlayers(): PlayerInfo[] {
		return [this.localPlayer, ...[...this.guests.values()].map((entry) => entry.player)];
	}

	/** Resolves a player id (the host's own `localPlayer.playerId`, or a connected guest's id) to its display name — used to attribute codeBlock-driven actions (e.g. who threw a ball) to a player. */
	getPlayerDisplayName(playerId: string): string | undefined {
		if (playerId === this.localPlayer.playerId) return this.localPlayer.displayName;
		// By connection id (the equipment system's key) or by the id the guest announced (what scripts use).
		return (this.guests.get(playerId) ?? this.guestByPlayerId(playerId))?.player.displayName;
	}

	private getLocalPresence(): Extract<WorldStateMessage, { kind: 'presence' }> {
		const camera = this.xr?.baseExperience.camera ?? this.desktopCamera;
		const head: TransformPose = cameraHeadPose(camera);
		const hands = readHandPoses(this.xr);
		const keyboard = localKeyboardPresence();
		return {
			kind: 'presence',
			player: this.localPlayer,
			sequence: ++this.presenceSequence,
			timestamp: Date.now(),
			head,
			hands,
			...(keyboard ? { keyboard } : {})
		};
	}

	private broadcastOwnPresence(): void {
		if (this.guests.size === 0) return;
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

		const assets = new AssetPeer((data) => link.sendBinary(data), getLocalAssetStore(), `guest ${guestId.slice(0, 6)}`);
		const link = new PeerLink(
			{
				iceServers: this.iceServers,
				onData: (data, channel) => this.handleData(guestId, data, channel),
				onBinary: (data) => assets.handle(data),
				onAssetChannelOpen: announceAssetSourcesChanged,
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

		this.guests.set(guestId, { link, headProxy, handProxies: new Map(), ghost, player, lastPresenceSequence: 0, lastTriggerValueAt: 0, lastAvatarAt: 0, assets });
		const offer = await link.createOffer();
		this.signaling.send({ type: 'offer', roomCode: this.roomCode, targetId: guestId, payload: offer });
	}

	private removeGuest(guestId: string): void {
		const entry = this.guests.get(guestId);
		if (!entry) return;
		this.guests.delete(guestId);
		for (const [requestId, pending] of this.pendingApi) {
			if (pending.guestId !== guestId) continue;
			clearTimeout(pending.timer);
			this.pendingApi.delete(requestId);
			pending.resolve({ ok: false, error: 'That player left' });
		}
		for (const [requestId, pending] of this.pendingPay) {
			if (pending.guestId !== guestId) continue;
			clearTimeout(pending.timer);
			this.pendingPay.delete(requestId);
			pending.resolve({ ok: false, reason: 'unavailable' });
		}
		this.grabSystem.release(`${guestId}:left`);
		this.grabSystem.release(`${guestId}:right`);
		// Whatever they had equipped goes back into the world at its current pose.
		this.equipment.releasePlayer(guestId);
		entry.assets.close();
		entry.link.close();
		entry.headProxy.dispose();
		for (const node of entry.handProxies.values()) node.dispose();
		entry.ghost.dispose();
		this.keyboards.remove(entry.player.playerId);
		// Peers know a guest by the player id it announced, which is what owns its avatar.
		this.avatars?.system.removePlayer(entry.player.playerId);
		this.avatars?.players?.removePlayer(entry.player.playerId);
		for (const { link } of this.guests.values()) link.send({ kind: 'player-left', playerId: entry.player.playerId });
		this.broadcastSnapshot();
		try {
			this.storageHooks?.onPlayerLeft?.(entry.player);
		} catch (error) {
			console.warn('[host] a script failed on a player leaving', error);
		}
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
		entry.player = { ...msg.player, playerId: entry.player.playerId, role: 'guest' };
		entry.headProxy.position = Vector3.FromArray(msg.head.position);
		entry.headProxy.rotationQuaternion = Quaternion.FromArray(msg.head.rotation);
		entry.ghost.setPose({
			head: msg.head,
			leftHand: msg.hands.left ?? msg.head,
			rightHand: msg.hands.right ?? msg.head
		});
		if (this.avatars) {
			this.avatars.system.setRemotePose(entry.player.playerId, { head: msg.head, left: msg.hands.left, right: msg.hands.right });
			entry.ghost.setVisible(!this.avatars.system.isDriving(entry.player.playerId));
		}
		for (const hand of ['left', 'right'] as const) {
			const pose = msg.hands[hand];
			if (!pose) continue;
			const node = this.getHandProxy(guestId, hand);
			node.position = Vector3.FromArray(pose.position);
			node.rotationQuaternion = Quaternion.FromArray(pose.rotation);
		}
		const keyboard = parseKeyboardPresence(msg.keyboard);
		this.keyboards.update(entry.player.playerId, keyboard);
		// Passed on to the other guests only as checked here.
		const normalized = { ...msg, player: entry.player, keyboard } satisfies Extract<WorldStateMessage, { kind: 'presence' }>;
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
			case 'player-hello': {
				if ((msg.protocol ?? 1) !== PROTOCOL_VERSION) {
					entry.link.send({ kind: 'session-rejected', reason: 'incompatible-protocol', protocol: PROTOCOL_VERSION });
					setTimeout(() => this.removeGuest(guestId), 250); // a moment for the refusal to arrive before the link closes
					break;
				}
				// A player id is what owns an avatar, so one that is already taken cannot be claimed.
				const taken = msg.player.playerId === this.localPlayer.playerId || [...this.guests.entries()].some(([id, other]) => id !== guestId && other.player.playerId === msg.player.playerId);
				entry.player = { ...msg.player, playerId: taken ? guestId : msg.player.playerId, role: 'guest' };
				this.storageHooks?.onPlayerReady(entry.player);
				this.sendSnapshotToGuest(guestId);
				this.broadcastSnapshot();
				break;
			}
			case 'avatar-set-request': {
				const now = Date.now();
				if (!this.avatars?.players || now - entry.lastAvatarAt < 1_000) break; // changing avatar is rate limited
				entry.lastAvatarAt = now;
				try {
					this.avatars.players.setAvatar(entry.player.playerId, msg.slots);
				} catch (error) {
					console.warn('[avatar] rejected a guest avatar', error);
				}
				this.broadcastSnapshot();
				break;
			}
			case 'player-api-response': {
				const pending = this.pendingApi.get(msg.requestId);
				if (!pending || pending.guestId !== guestId) break; // only the guest that was asked can answer
				clearTimeout(pending.timer);
				this.pendingApi.delete(msg.requestId);
				pending.resolve(msg.result);
				break;
			}
			case 'pay-response': {
				const pending = this.pendingPay.get(msg.requestId);
				if (!pending || pending.guestId !== guestId) break; // only the guest that was asked can answer
				clearTimeout(pending.timer);
				this.pendingPay.delete(msg.requestId);
				pending.resolve(msg.result);
				break;
			}
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
			case 'hold-move': {
				if (!isEquipHand(msg.grabberId)) break;
				const grabberId = `${guestId}:${msg.grabberId}`;
				// Only what this guest is holding, and only a sane pose.
				if (this.grabSystem.getHeldSlot(grabberId) !== msg.slotId) break;
				if (!isFinitePose(msg.position, 3) || !isFinitePose(msg.rotation, 4)) break;
				this.grabSystem.setHeldWorldPose(grabberId, Vector3.FromArray(msg.position), Quaternion.FromArray(msg.rotation).normalize());
				break;
			}
			case 'release-request':
				this.grabSystem.release(`${guestId}:${msg.grabberId}`);
				this.broadcastSnapshot();
				break;
			case 'spawn-request': {
				const spawned = migrateSlotTree([msg.slot])[0];
				try {
					for (const portal of spawned.components.filter((component) => component.type === 'worldPortal')) validateWorldPackage(portal.world);
					if (JSON.stringify([...this.sceneGraph.serialize(), spawned]).length > MAX_SHARED_SCENE_BYTES) throw new Error('Shared scene is too large');
				} catch { this.sendSnapshotToGuest(guestId); break; }
				if (!this.sceneGraph.getLive(spawned.id)) this.sceneGraph.addSlot(spawned);
				this.broadcastSnapshot();
				break;
			}
			case 'delete-request':
				if (this.sceneGraph.getLive(msg.slotId)) this.sceneGraph.removeSlot(msg.slotId);
				this.broadcastSnapshot();
				break;
			case 'media-control-request':
				if (this.sceneGraph.controlMedia(msg.slotId, msg.action)) this.broadcastSnapshot();
				break;
			case 'ui-event-request':
				if (this.sceneGraph.dispatchUIEvent({ ...msg.event, remoteGuestId: guestId }) && msg.event.type !== 'change') this.broadcastSnapshot();
				break;
		}
	}

	private broadcastStateIfChanged(): void {
		if (this.guests.size === 0) return;
		const changed: SlotTransform[] = [];
		const seen = new Set<string>();
		for (const { id, position, rotation, scale, components } of this.sceneGraph.serialize()) {
			seen.add(id);
			// An avatar's body is posed locally by every peer from presence; streaming it as well would double the traffic.
			if (components.some((component) => component.type === 'avatar')) continue;
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
			equipped: this.equipment.registry.list(),
			publicationId: this.storageHooks?.getPublicationId() ?? null
		});
	}

	/** Tells every guest the whole world, soon: calls that come close together are sent as one. */
	broadcastSnapshot(): void {
		this.snapshotThrottle();
	}

	/**
	 * Tells every guest about a slot that comes and goes by itself (a sound, a spark: it has an `expires`), without sending the
	 * whole world. The guests' next snapshot carries it if it is still there.
	 */
	broadcastEphemeral(slot: Slot): void {
		for (const { link } of this.guests.values()) link.send({ kind: 'spawn-ephemeral', slot });
	}

	private sendSnapshotToAll(): void {
		const tree = this.sceneGraph.serialize();
		this.lastTransforms.clear();
		this.dirtyTransforms.clear();
		for (const { id, position, rotation, scale } of tree) this.lastTransforms.set(id, JSON.stringify({ id, position, rotation, scale }));
		this.revision++;
		for (const { link } of this.guests.values()) {
			link.send({ kind: 'scene-snapshot', revision: this.revision, tree, players: this.getPlayers(), equipped: this.equipment.registry.list(), publicationId: this.storageHooks?.getPublicationId() ?? null });
		}
	}

	dispose(): void {
		clearInterval(this.presenceTimer);
		clearInterval(this.stateTimer);
		clearInterval(this.correctionTimer);
		this.snapshotThrottle.cancel();
		for (const guestId of [...this.guests.keys()]) this.removeGuest(guestId);
		this.keyboards.dispose();
		this.signaling.close();
	}
}

function isFinitePose(value: unknown, length: number): value is number[] {
	return Array.isArray(value) && value.length === length && value.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e5);
}
