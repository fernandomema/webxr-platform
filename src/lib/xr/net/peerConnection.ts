const RELIABLE_CHUNK_SIZE = 8_000;
const MAX_RELIABLE_MESSAGE_SIZE = 8_000_000;

export interface PeerLinkOptions {
	iceServers: RTCIceServer[];
	onData(data: unknown, channel: 'reliable' | 'state'): void;
	onOpen?(): void;
	onConnectionStateChange?(state: RTCPeerConnectionState): void;
	onRemoteTrack?(track: MediaStreamTrack, streams: readonly MediaStream[]): void;
}

/**
 * One RTCPeerConnection + its `world-sync` DataChannel + an optional audio
 * track (proximity voice). The host holds one PeerLink per connected guest;
 * a guest holds exactly one (to the host).
 */
export class PeerLink {
	readonly pc: RTCPeerConnection;
	private channel: RTCDataChannel | null = null;
	private stateChannel: RTCDataChannel | null = null;
	private pendingReliable: string[] = [];
	private receivedChunks = new Map<string, { parts: string[]; count: number; createdAt: number }>();
	private pendingIceCandidates: RTCIceCandidateInit[] = [];
	private remoteDescriptionReady = false;

	constructor(
		private opts: PeerLinkOptions,
		isInitiator: boolean
	) {
		this.pc = new RTCPeerConnection({ iceServers: opts.iceServers });
		this.pc.onconnectionstatechange = () => opts.onConnectionStateChange?.(this.pc.connectionState);
		this.pc.ontrack = (event) => opts.onRemoteTrack?.(event.track, event.streams);

		if (isInitiator) {
			this.wireChannel(this.pc.createDataChannel('world-sync', { ordered: true }));
			this.wireChannel(this.pc.createDataChannel('world-state', { ordered: false, maxRetransmits: 0 }));
		} else {
			this.pc.ondatachannel = (event) => this.wireChannel(event.channel);
		}
	}

	private wireChannel(channel: RTCDataChannel): void {
		const isStateChannel = channel.label === 'world-state';
		if (isStateChannel) this.stateChannel = channel;
		else this.channel = channel;
		if (!isStateChannel) {
			channel.bufferedAmountLowThreshold = 64_000;
			channel.onbufferedamountlow = () => this.flushReliable();
			channel.onopen = () => {
				this.flushReliable();
				this.opts.onOpen?.();
			};
		}
		channel.onmessage = (event) => {
			try {
				const frame = JSON.parse(event.data);
				if (!isStateChannel && frame?.__chunk === 1) this.receiveChunk(frame);
				else if (isStateChannel) this.opts.onData(frame, 'state');
				else this.deliverReliable(frame);
			} catch {
				/* ignore malformed frames */
			}
		};
	}

	private deliverReliable(frame: unknown): void {
		if (frame && typeof frame === 'object' && '__state' in frame && frame.__state === 1 && 'data' in frame) {
			this.opts.onData(frame.data, 'state');
		} else this.opts.onData(frame, 'reliable');
	}

	private flushReliable(): void {
		const channel = this.channel;
		if (channel?.readyState !== 'open') return;
		while (this.pendingReliable.length > 0 && channel.bufferedAmount < 128_000) {
			channel.send(this.pendingReliable.shift()!);
		}
	}

	private receiveChunk(frame: { id: string; index: number; total: number; data: string }): void {
		if (typeof frame.id !== 'string' || !Number.isInteger(frame.index) || !Number.isInteger(frame.total) ||
			frame.total < 1 || frame.total > Math.ceil(MAX_RELIABLE_MESSAGE_SIZE / RELIABLE_CHUNK_SIZE) ||
			frame.index < 0 || frame.index >= frame.total || typeof frame.data !== 'string' || frame.data.length > RELIABLE_CHUNK_SIZE) return;
		const now = Date.now();
		for (const [id, pending] of this.receivedChunks) if (now - pending.createdAt > 30_000) this.receivedChunks.delete(id);
		let pending = this.receivedChunks.get(frame.id);
		if (!pending) {
			if (this.receivedChunks.size >= 4) return;
			pending = { parts: Array(frame.total).fill(''), count: 0, createdAt: now };
			this.receivedChunks.set(frame.id, pending);
		}
		if (pending.parts.length !== frame.total || pending.parts[frame.index]) return;
		pending.parts[frame.index] = frame.data;
		pending.count++;
		if (pending.count !== frame.total) return;
		this.receivedChunks.delete(frame.id);
		try { this.deliverReliable(JSON.parse(pending.parts.join(''))); } catch { /* invalid payload */ }
	}

	send(data: unknown): void {
		const payload = JSON.stringify(data);
		if (payload.length > MAX_RELIABLE_MESSAGE_SIZE) throw new Error('Network message exceeds sharing limit');
		if (payload.length <= RELIABLE_CHUNK_SIZE) this.pendingReliable.push(payload);
		else {
			const id = crypto.randomUUID();
			const total = Math.ceil(payload.length / RELIABLE_CHUNK_SIZE);
			for (let index = 0; index < total; index++) {
				this.pendingReliable.push(JSON.stringify({ __chunk: 1, id, index, total, data: payload.slice(index * RELIABLE_CHUNK_SIZE, (index + 1) * RELIABLE_CHUNK_SIZE) }));
			}
		}
		this.flushReliable();
	}

	sendState(data: unknown): void {
		const payload = JSON.stringify(data);
		if (payload.length > 8_000) { this.send({ __state: 1, data }); return; }
		if (this.stateChannel?.readyState === 'open' && this.stateChannel.bufferedAmount < 128_000) this.stateChannel.send(payload);
	}

	addLocalAudioTrack(track: MediaStreamTrack, stream: MediaStream): void {
		this.pc.addTrack(track, stream);
	}

	async createOffer(): Promise<RTCSessionDescriptionInit> {
		const offer = await this.pc.createOffer();
		await this.pc.setLocalDescription(offer);
		return offer;
	}

	async createAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
		await this.pc.setRemoteDescription(offer);
		this.remoteDescriptionReady = true;
		await this.flushIceCandidates();
		const answer = await this.pc.createAnswer();
		await this.pc.setLocalDescription(answer);
		return answer;
	}

	async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
		await this.pc.setRemoteDescription(answer);
		this.remoteDescriptionReady = true;
		await this.flushIceCandidates();
	}

	async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
		if (!this.remoteDescriptionReady) {
			this.pendingIceCandidates.push(candidate);
			return;
		}
		await this.pc.addIceCandidate(candidate);
	}

	private async flushIceCandidates(): Promise<void> {
		for (const candidate of this.pendingIceCandidates.splice(0)) await this.pc.addIceCandidate(candidate);
	}

	onIceCandidate(cb: (candidate: RTCIceCandidate) => void): void {
		this.pc.onicecandidate = (event) => {
			if (event.candidate) cb(event.candidate);
		};
	}

	close(): void {
		this.pendingReliable = [];
		this.receivedChunks.clear();
		this.channel?.close();
		this.stateChannel?.close();
		this.pc.close();
	}
}

export function parseIceServers(csv: string): RTCIceServer[] {
	return csv
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map((urls) => ({ urls }));
}
