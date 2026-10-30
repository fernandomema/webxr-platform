import { platformFetch, signalingAddress } from '../platform/config.ts';

export type SignalingMessage =
	/** The server took this client's registration. `resumed`: it came back to a place it held before its socket dropped. */
	| { type: 'registered'; roomCode: string; guestId?: string; resumed?: boolean }
	/** `resumed`: a guest the host may already know, back on a new socket. `restart`: it asks for a new direct link. */
	| { type: 'guest-joined'; roomCode: string; guestId: string; resumed?: boolean; restart?: boolean }
	/** `reason` 'timeout': its socket dropped and did not come back in time (its direct link may still work). */
	| { type: 'guest-left'; roomCode: string; guestId: string; reason?: 'left' | 'timeout' }
	| { type: 'host-left'; roomCode: string }
	| { type: 'error'; message: string }
	| {
			type: 'offer' | 'answer' | 'ice-candidate';
			roomCode: string;
			targetId?: string;
			fromId?: string;
			payload: unknown;
	  };

/** How this client's connection to the signaling server is doing. */
export type SignalingStatus = 'connecting' | 'connected' | 'reconnecting';

export interface SignalingOptions {
	/** The host's secret for its room: what lets it take the room back after its socket dropped. */
	hostKey?: string;
	/** A guest's own id and secret, so that it keeps its place in the room across new sockets. */
	peer?: { id: string; key: string };
}

/** Busy every this often, so that a proxy never closes the socket as idle. */
const KEEPALIVE_MS = 20_000;
/** Waits between tries to reconnect: growing, up to the last. */
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];

/**
 * The /signaling WebSocket, registering as 'host' or 'join' for a roomCode. A socket that drops is opened again and the
 * registration repeated, so a blip on the network does not end a session (the server keeps the place a while, see rooms.ts).
 */
export class SignalingClient {
	private ws: WebSocket | null = null;
	private listeners = new Set<(msg: SignalingMessage) => void>();
	private statusListeners = new Set<(status: SignalingStatus) => void>();
	/** Negotiation sent while the socket was not registered yet: it goes out once it is. */
	private queue: string[] = [];
	private registered = false;
	private closed = false;
	private attempt = 0;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private keepalive: ReturnType<typeof setInterval>;
	status: SignalingStatus = 'connecting';

	constructor(
		private roomCode: string,
		private role: 'host' | 'join',
		private options: SignalingOptions = {}
	) {
		this.connect();
		this.keepalive = setInterval(() => this.raw({ type: 'ping' }), KEEPALIVE_MS);
	}

	private connect(): void {
		if (this.closed) return;
		this.registered = false;
		const ws = new WebSocket(signalingAddress());
		this.ws = ws;
		ws.addEventListener('open', () => {
			if (this.ws !== ws) return;
			void this.register(false);
		});
		ws.addEventListener('message', (event) => {
			if (this.ws !== ws) return;
			let msg: SignalingMessage;
			try {
				msg = JSON.parse(event.data) as SignalingMessage;
			} catch {
				return; // ignore malformed frames
			}
			if (msg.type === 'registered') {
				this.registered = true;
				this.attempt = 0;
				this.setStatus('connected');
				for (const payload of this.queue.splice(0)) ws.send(payload);
			}
			for (const listener of this.listeners) listener(msg);
		});
		ws.addEventListener('close', () => {
			if (this.ws !== ws || this.closed) return;
			this.ws = null;
			this.registered = false;
			this.setStatus('reconnecting');
			const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
			this.attempt++;
			this.retryTimer = setTimeout(() => this.connect(), delay);
		});
	}

	private async register(restart: boolean): Promise<void> {
		if (this.role === 'host') {
			this.raw({ type: 'host', roomCode: this.roomCode, ...(this.options.hostKey ? { hostKey: this.options.hostKey } : {}) });
			return;
		}
		// A session that only friends may enter wants a pass from the platform; for any other the answer is none.
		const ticket = await joinTicket(this.roomCode);
		const peer = this.options.peer;
		this.raw({ type: 'join', roomCode: this.roomCode, ...(ticket ? { ticket } : {}), ...(peer ? { peerId: peer.id, peerKey: peer.key } : {}), ...(restart ? { restart: true } : {}) });
	}

	/** A guest whose direct link to the host stopped working: asks the host, through the server, for a new one. */
	requestRestart(): void {
		if (this.role !== 'join' || !this.registered) return;
		void this.register(true);
	}

	private setStatus(status: SignalingStatus): void {
		if (this.status === status) return;
		this.status = status;
		for (const listener of this.statusListeners) listener(status);
	}

	private raw(msg: object): void {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
	}

	onMessage(listener: (msg: SignalingMessage) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onStatus(listener: (status: SignalingStatus) => void): () => void {
		this.statusListeners.add(listener);
		return () => this.statusListeners.delete(listener);
	}

	send(msg: Extract<SignalingMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>): void {
		const payload = JSON.stringify(msg);
		if (this.registered && this.ws?.readyState === WebSocket.OPEN) this.ws.send(payload);
		else if (this.queue.length < 200) this.queue.push(payload);
	}

	/** Ends this client's part in the room: the server tells the other side at once. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		clearInterval(this.keepalive);
		if (this.retryTimer) clearTimeout(this.retryTimer);
		this.queue = [];
		const ws = this.ws;
		this.ws = null;
		if (!ws) return;
		const leave = () => {
			ws.send(JSON.stringify({ type: 'leave' }));
			ws.close();
		};
		if (ws.readyState === WebSocket.OPEN) leave();
		else if (ws.readyState === WebSocket.CONNECTING) ws.addEventListener('open', leave, { once: true });
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
