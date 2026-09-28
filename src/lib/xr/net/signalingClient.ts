export type SignalingMessage =
	| { type: 'guest-joined'; roomCode: string; guestId: string }
	| { type: 'guest-left'; roomCode: string; guestId: string }
	| { type: 'host-left'; roomCode: string }
	| { type: 'error'; message: string }
	| {
			type: 'offer' | 'answer' | 'ice-candidate';
			roomCode: string;
			targetId?: string;
			fromId?: string;
			payload: unknown;
	  };

/** Thin wrapper around the /signaling WebSocket, registering as 'host' or 'join' for a roomCode. */
export class SignalingClient {
	private ws: WebSocket;
	private listeners = new Set<(msg: SignalingMessage) => void>();

	constructor(
		private roomCode: string,
		role: 'host' | 'join'
	) {
		const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
		this.ws = new WebSocket(`${protocol}://${location.host}/signaling`);
		this.ws.addEventListener('open', () => this.send({ type: role, roomCode } as never));
		this.ws.addEventListener('message', (event) => {
			try {
				const msg = JSON.parse(event.data) as SignalingMessage;
				for (const listener of this.listeners) listener(msg);
			} catch {
				/* ignore malformed frames */
			}
		});
	}

	onMessage(listener: (msg: SignalingMessage) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	send(msg: Extract<SignalingMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>): void {
		const payload = JSON.stringify(msg);
		if (this.ws.readyState === WebSocket.OPEN) this.ws.send(payload);
		else this.ws.addEventListener('open', () => this.ws.send(payload), { once: true });
	}

	close(): void {
		this.ws.close();
	}
}
