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
	private pendingReliable: unknown[] = [];
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
			channel.onopen = () => {
				for (const data of this.pendingReliable.splice(0)) channel.send(JSON.stringify(data));
				this.opts.onOpen?.();
			};
		}
		channel.onmessage = (event) => {
			try {
				this.opts.onData(JSON.parse(event.data), isStateChannel ? 'state' : 'reliable');
			} catch {
				/* ignore malformed frames */
			}
		};
	}

	send(data: unknown): void {
		if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(data));
		else this.pendingReliable.push(data);
	}

	sendState(data: unknown): void {
		if (this.stateChannel?.readyState === 'open') this.stateChannel.send(JSON.stringify(data));
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
