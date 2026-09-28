import type { TransformNode } from '@babylonjs/core';

/**
 * Proximity voice chat: each remote peer's WebRTC audio track is routed
 * through a Web Audio PannerNode positioned at that peer's avatar transform,
 * updated every frame, with distance-based falloff — no chat text, this is
 * the real end-to-end proof that the P2P pipe works (see plan).
 */
export class ProximityVoice {
	private ctx: AudioContext | null = null;
	private peers = new Map<
		string,
		{ panner: PannerNode; source: MediaStreamAudioSourceNode; targetNode: TransformNode }
	>();

	private getContext(): AudioContext {
		if (!this.ctx) this.ctx = new AudioContext();
		return this.ctx;
	}

	async getLocalMicTrack(): Promise<{ track: MediaStreamTrack; stream: MediaStream } | null> {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const track = stream.getAudioTracks()[0];
			return track ? { track, stream } : null;
		} catch {
			return null; // mic denied/unavailable — voice is best-effort, never blocks joining
		}
	}

	addPeer(id: string, stream: MediaStream, targetNode: TransformNode): void {
		const ctx = this.getContext();
		const source = ctx.createMediaStreamSource(stream);
		const panner = ctx.createPanner();
		panner.panningModel = 'HRTF';
		panner.distanceModel = 'inverse';
		panner.refDistance = 1;
		panner.maxDistance = 20;
		source.connect(panner).connect(ctx.destination);
		this.peers.set(id, { panner, source, targetNode });
	}

	removePeer(id: string): void {
		const entry = this.peers.get(id);
		if (!entry) return;
		entry.source.disconnect();
		entry.panner.disconnect();
		this.peers.delete(id);
	}

	update(listener: { position: [number, number, number]; forward: [number, number, number] }): void {
		if (!this.ctx) return;
		for (const { panner, targetNode } of this.peers.values()) {
			const p = targetNode.absolutePosition;
			panner.positionX.value = p.x;
			panner.positionY.value = p.y;
			panner.positionZ.value = p.z;
		}
		this.ctx.listener.positionX.value = listener.position[0];
		this.ctx.listener.positionY.value = listener.position[1];
		this.ctx.listener.positionZ.value = listener.position[2];
		this.ctx.listener.forwardX.value = listener.forward[0];
		this.ctx.listener.forwardY.value = listener.forward[1];
		this.ctx.listener.forwardZ.value = listener.forward[2];
	}

	dispose(): void {
		for (const id of [...this.peers.keys()]) this.removePeer(id);
		void this.ctx?.close();
		this.ctx = null;
	}
}
