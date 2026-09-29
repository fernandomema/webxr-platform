const RELIABLE_CHUNK_SIZE = 8_000;
const MAX_RELIABLE_MESSAGE_SIZE = 8_000_000;
/** The binary channel pauses sending above this much unsent data and resumes below the low mark. */
const ASSET_HIGH_WATER = 512_000;
const ASSET_LOW_WATER = 128_000;

export interface PeerLinkOptions {
	iceServers: RTCIceServer[];
	onData(data: unknown, channel: 'reliable' | 'state'): void;
	onOpen?(): void;
	/** A frame from the binary `asset-data` channel (model transfers). */
	onBinary?(data: Uint8Array): void;
	/** The binary channel finished opening; transfers can start. */
	onAssetChannelOpen?(): void;
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
	private assetChannel: RTCDataChannel | null = null;
	private pendingAsset: Array<{ data: Uint8Array; sent: () => void }> = [];
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
			this.wireChannel(this.pc.createDataChannel('asset-data', { ordered: true }));
		} else {
			this.pc.ondatachannel = (event) => this.wireChannel(event.channel);
		}
	}

	private wireAssetChannel(channel: RTCDataChannel): void {
		this.assetChannel = channel;
		channel.binaryType = 'arraybuffer';
		channel.bufferedAmountLowThreshold = ASSET_LOW_WATER;
		channel.onbufferedamountlow = () => this.flushAsset();
		channel.onopen = () => {
			this.flushAsset();
			this.opts.onAssetChannelOpen?.();
		};
		channel.onmessage = (event) => {
			if (event.data instanceof ArrayBuffer) this.opts.onBinary?.(new Uint8Array(event.data));
		};
	}

	private flushAsset(): void {
		const channel = this.assetChannel;
		if (channel?.readyState !== 'open') return;
		while (this.pendingAsset.length > 0 && channel.bufferedAmount < ASSET_HIGH_WATER) {
			const next = this.pendingAsset.shift()!;
			channel.send(next.data as unknown as ArrayBuffer);
			next.sent();
		}
	}

	get assetChannelOpen(): boolean {
		return this.assetChannel?.readyState === 'open';
	}

	/**
	 * Queues one binary frame. The promise resolves once the frame has been
	 * handed to the network, so a sender that awaits it never buffers more than
	 * the channel can drain (a model is hundreds of frames).
	 */
	sendBinary(data: Uint8Array): Promise<void> {
		return new Promise((resolve) => {
			this.pendingAsset.push({ data, sent: resolve });
			this.flushAsset();
		});
	}

	private wireChannel(channel: RTCDataChannel): void {
		// Channels are told apart by label; an unknown label must never replace the reliable channel.
		if (channel.label === 'asset-data') {
			this.wireAssetChannel(channel);
			return;
		}
		if (channel.label !== 'world-sync' && channel.label !== 'world-state') {
			channel.close(); // from a newer build than this one: ignore it rather than mistake it for the reliable channel
			return;
		}
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
		// Nobody is waiting for these frames any more; release anything awaiting them.
		for (const frame of this.pendingAsset.splice(0)) frame.sent();
		this.channel?.close();
		this.stateChannel?.close();
		this.assetChannel?.close();
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
