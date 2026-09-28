import { TransformNode, type Scene, type WebXRDefaultExperience } from '@babylonjs/core';
import type { SceneGraph } from '../sceneGraph';
import type { GrabSystem } from '../interaction/grabSystem';
import type { Slot } from '$lib/ecs/types';
import { SignalingClient, type SignalingMessage } from './signalingClient';
import { PeerLink } from './peerConnection';
import type { WorldSyncMessage } from './protocol';

const PRESENCE_INTERVAL_MS = 100;

/**
 * Runs on a joining client. Applies the host's scene-snapshot broadcasts
 * locally, sends its own grab/release/spawn requests and periodic hand/head
 * presence, and renders nothing authoritative — the host has final say.
 * Local grabs are still applied optimistically via the shared GrabSystem for
 * responsiveness; the next snapshot reconciles anything that drifted.
 */
export class GuestSync {
	private signaling: SignalingClient;
	private link: PeerLink | null = null;
	private locallyGrabbed = new Set<string>();
	private presenceTimer: ReturnType<typeof setInterval> | null = null;
	readonly hostProxy: TransformNode;

	constructor(
		private scene: Scene,
		private xr: WebXRDefaultExperience,
		private sceneGraph: SceneGraph,
		private grabSystem: GrabSystem,
		private roomCode: string,
		private iceServers: RTCIceServer[],
		private voice?: {
			localTrack?: { track: MediaStreamTrack; stream: MediaStream };
			onRemoteStream?(stream: MediaStream, targetNode: TransformNode): void;
		}
	) {
		this.hostProxy = new TransformNode('host-proxy', scene);
		this.signaling = new SignalingClient(roomCode, 'join');
		this.signaling.onMessage((msg) => this.handleSignaling(msg));
		this.presenceTimer = setInterval(() => this.sendPresence(), PRESENCE_INTERVAL_MS);
	}

	private handleSignaling(msg: SignalingMessage): void {
		if (msg.type === 'offer') void this.acceptOffer(msg.payload as RTCSessionDescriptionInit);
		else if (msg.type === 'ice-candidate') void this.link?.addIceCandidate(msg.payload as RTCIceCandidateInit);
		else if (msg.type === 'host-left') this.dispose();
	}

	private async acceptOffer(offer: RTCSessionDescriptionInit): Promise<void> {
		this.link = new PeerLink(
			{
				iceServers: this.iceServers,
				onData: (data) => this.handleData(data as WorldSyncMessage),
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

		const answer = await this.link.createAnswer(offer);
		this.signaling.send({ type: 'answer', roomCode: this.roomCode, payload: answer });
	}

	private handleData(msg: WorldSyncMessage): void {
		if (msg.kind === 'scene-snapshot') {
			this.sceneGraph.reconcile(msg.tree, this.locallyGrabbed);
		} else if (msg.kind === 'presence') {
			// any presence a guest *receives* is, by construction, the host's own (its one peer)
			this.hostProxy.position.set(...msg.head.position);
		}
	}

	private sendPresence(): void {
		if (!this.link) return;
		const camera = this.xr.baseExperience.camera;
		const head = { position: camera.position.asArray() as [number, number, number], rotation: (camera.rotationQuaternion?.asArray() ?? [0, 0, 0, 1]) as [number, number, number, number] };
		const hands: Partial<Record<'left' | 'right', { position: [number, number, number]; rotation: [number, number, number, number] }>> = {};
		for (const controller of this.xr.input.controllers) {
			if (controller.inputSource.handedness === 'none') continue;
			const node = controller.grip ?? controller.pointer;
			hands[controller.inputSource.handedness] = {
				position: node.absolutePosition.asArray() as [number, number, number],
				rotation: (node.rotationQuaternion?.asArray() ?? [0, 0, 0, 1]) as [number, number, number, number]
			};
		}
		this.link.send({ kind: 'presence', head, hands } satisfies WorldSyncMessage);
	}

	requestGrab(grabberId: string, slotId: string): void {
		this.locallyGrabbed.add(slotId);
		this.link?.send({ kind: 'grab-request', slotId, grabberId } satisfies WorldSyncMessage);
	}

	requestRelease(grabberId: string, slotId?: string): void {
		if (slotId) this.locallyGrabbed.delete(slotId);
		this.link?.send({ kind: 'release-request', grabberId } satisfies WorldSyncMessage);
	}

	requestSpawn(slot: Slot): void {
		this.link?.send({ kind: 'spawn-request', slot } satisfies WorldSyncMessage);
	}

	dispose(): void {
		if (this.presenceTimer) clearInterval(this.presenceTimer);
		this.link?.close();
		this.signaling.close();
	}
}
