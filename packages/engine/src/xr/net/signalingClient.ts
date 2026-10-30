import { platformFetch, signalingAddress } from '../platform/config.ts';

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
		this.ws = new WebSocket(signalingAddress());
		this.ws.addEventListener('open', () => {
			if (role === 'host') return this.send({ type: role, roomCode } as never);
			// A session that only friends may enter wants a pass from the platform; for any other the answer is none.
			void joinTicket(roomCode).then((ticket) => this.send({ type: role, roomCode, ...(ticket ? { ticket } : {}) } as never));
		});
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

/** The pass to join `roomCode`, or null when it needs none, the player is not signed in, or the platform cannot be reached. */
async function joinTicket(roomCode: string): Promise<string | null> {
	try {
		const response = await platformFetch(`/api/sessions/${encodeURIComponent(roomCode)}/ticket`, { method: 'POST' });
		if (!response.ok) return null;
		return ((await response.json()) as { ticket?: string | null }).ticket ?? null;
	} catch {
		return null;
	}
}
