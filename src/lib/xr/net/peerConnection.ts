export interface PeerLinkOptions {
	iceServers: RTCIceServer[];
	onData(data: unknown): void;
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

	constructor(
		private opts: PeerLinkOptions,
		isInitiator: boolean
	) {
		this.pc = new RTCPeerConnection({ iceServers: opts.iceServers });
		this.pc.onconnectionstatechange = () => opts.onConnectionStateChange?.(this.pc.connectionState);
		this.pc.ontrack = (event) => opts.onRemoteTrack?.(event.track, event.streams);

		if (isInitiator) {
			this.wireChannel(this.pc.createDataChannel('world-sync'));
		} else {
			this.pc.ondatachannel = (event) => this.wireChannel(event.channel);
		}
	}

	private wireChannel(channel: RTCDataChannel): void {
		this.channel = channel;
		channel.onopen = () => this.opts.onOpen?.();
		channel.onmessage = (event) => {
			try {
				this.opts.onData(JSON.parse(event.data));
			} catch {
				/* ignore malformed frames */
			}
		};
	}

	send(data: unknown): void {
		if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(data));
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
		const answer = await this.pc.createAnswer();
		await this.pc.setLocalDescription(answer);
		return answer;
	}

	async acceptAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
		await this.pc.setRemoteDescription(answer);
	}

	async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
		await this.pc.addIceCandidate(candidate);
	}

	onIceCandidate(cb: (candidate: RTCIceCandidate) => void): void {
		this.pc.onicecandidate = (event) => {
			if (event.candidate) cb(event.candidate);
		};
	}

	close(): void {
		this.channel?.close();
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
