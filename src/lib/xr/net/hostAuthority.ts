import { TransformNode, Vector3, Quaternion, type Scene, type WebXRDefaultExperience } from '@babylonjs/core';
import type { SceneGraph } from '../sceneGraph';
import type { GrabSystem } from '../interaction/grabSystem';
import { SignalingClient, type SignalingMessage } from './signalingClient';
import { PeerLink } from './peerConnection';
import type { WorldSyncMessage } from './protocol';
import { createGhostRig, type GhostRig } from '../avatar/defaultAvatar';

interface GuestEntry {
	link: PeerLink;
	headProxy: TransformNode;
	handProxies: Map<'left' | 'right', TransformNode>;
	ghost: GhostRig;
}

/**
 * Runs on the hosting client. Holds one PeerLink per connected guest, is the
 * single authority over the scene's Slot tree, and re-broadcasts the
 * resulting state to every guest after applying a request. No CRDT/conflict
 * resolution — the host is the one arbiter (see plan).
 */
export class HostAuthority {
	private signaling: SignalingClient;
	private guests = new Map<string, GuestEntry>();
	private presenceTimer: ReturnType<typeof setInterval>;

	constructor(
		private scene: Scene,
		private xr: WebXRDefaultExperience,
		private sceneGraph: SceneGraph,
		private grabSystem: GrabSystem,
		private roomCode: string,
		private iceServers: RTCIceServer[],
		private voice?: {
			localTrack?: { track: MediaStreamTrack; stream: MediaStream };
			onRemoteStream?(guestId: string, stream: MediaStream, targetNode: TransformNode): void;
		}
	) {
		this.signaling = new SignalingClient(roomCode, 'host');
		this.signaling.onMessage((msg) => this.handleSignaling(msg));
		this.presenceTimer = setInterval(() => this.broadcastOwnPresence(), 100);
	}

	private broadcastOwnPresence(): void {
		const camera = this.xr.baseExperience.camera;
		const head = {
			position: camera.position.asArray() as [number, number, number],
			rotation: (camera.rotationQuaternion?.asArray() ?? [0, 0, 0, 1]) as [number, number, number, number]
		};
		for (const { link } of this.guests.values()) {
			link.send({ kind: 'presence', head, hands: {} } satisfies WorldSyncMessage);
		}
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

		const link = new PeerLink(
			{
				iceServers: this.iceServers,
				onData: (data) => this.handleData(guestId, data as WorldSyncMessage),
				onOpen: () =>
					link.send({ kind: 'scene-snapshot', tree: this.sceneGraph.serialize() } satisfies WorldSyncMessage),
				onRemoteTrack: (_track, streams) => {
					if (streams[0]) this.voice?.onRemoteStream?.(guestId, streams[0], headProxy);
				}
			},
			true
		);
		link.onIceCandidate((candidate) => {
			this.signaling.send({
				type: 'ice-candidate',
				roomCode: this.roomCode,
				targetId: guestId,
				payload: candidate
			});
		});
		if (this.voice?.localTrack) link.addLocalAudioTrack(this.voice.localTrack.track, this.voice.localTrack.stream);

		this.guests.set(guestId, { link, headProxy, handProxies: new Map(), ghost });

		const offer = await link.createOffer();
		this.signaling.send({ type: 'offer', roomCode: this.roomCode, targetId: guestId, payload: offer });
	}

	private removeGuest(guestId: string): void {
		const entry = this.guests.get(guestId);
		if (!entry) return;
		this.grabSystem.release(`${guestId}:left`);
		this.grabSystem.release(`${guestId}:right`);
		entry.link.close();
		entry.headProxy.dispose();
		for (const node of entry.handProxies.values()) node.dispose();
		entry.ghost.dispose();
		this.guests.delete(guestId);
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

	private handleData(guestId: string, msg: WorldSyncMessage): void {
		const entry = this.guests.get(guestId);
		if (!entry) return;

		switch (msg.kind) {
			case 'presence': {
				entry.headProxy.position = Vector3.FromArray(msg.head.position);
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
				break;
			}
			case 'grab-request': {
				const hand = msg.grabberId as 'left' | 'right';
				this.grabSystem.grab(`${guestId}:${hand}`, this.getHandProxy(guestId, hand), msg.slotId);
				this.broadcastSnapshot();
				break;
			}
			case 'release-request': {
				this.grabSystem.release(`${guestId}:${msg.grabberId}`);
				this.broadcastSnapshot();
				break;
			}
			case 'spawn-request': {
				this.sceneGraph.addSlot(msg.slot);
				this.broadcastSnapshot();
				break;
			}
		}
	}

	broadcastSnapshot(): void {
		const tree = this.sceneGraph.serialize();
		for (const { link } of this.guests.values()) {
			link.send({ kind: 'scene-snapshot', tree } satisfies WorldSyncMessage);
		}
	}

	dispose(): void {
		clearInterval(this.presenceTimer);
		for (const guestId of [...this.guests.keys()]) this.removeGuest(guestId);
		this.signaling.close();
	}
}
