import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { registerHost, registerGuest, getRoom, removeSocket, connectionIdFor, guestSocket, isGuestOf } from './rooms.ts';

// Pure relay: this server never inspects world/scene content, only forwards
// WebRTC negotiation JSON so peers can establish a direct P2P connection
// (NAT traversal via STUN, see PUBLIC_STUN_URLS). A host may have several
// guests, each needing its own RTCPeerConnection, so negotiation messages
// carry `fromId` (added by the server) and, from the host, `targetId` (the
// guestId to route the answer to).
type SignalingMessage =
	/** `hostKey` lets the same host take its room back on a new socket (see rooms.ts). */
	| { type: 'host'; roomCode: string; hostKey?: string }
	/**
	 * `peerId`/`peerKey` keep a guest's place across new sockets. `restart` asks the host for a new direct link: the guest's
	 * one stopped working. It is sent again on the same socket for that.
	 */
	| { type: 'join'; roomCode: string; ticket?: string; peerId?: string; peerKey?: string; restart?: boolean }
	/** The client is ending its session: the other side is told now, not after the wait for a dropped socket. */
	| { type: 'leave' }
	/** Keeps the connection busy, so that proxies do not close it as idle. */
	| { type: 'ping' }
	| {
			type: 'offer' | 'answer' | 'ice-candidate';
			roomCode: string;
			targetId?: string; // required when sent by the host (which guest this is for)
			payload: unknown;
	  };

/** How often the server checks that a socket still answers (a WebSocket ping), and closes one that did not answer the last. */
const HEARTBEAT_MS = 25_000;

/**
 * Single reusable WebSocket handler for the `/signaling` route.
 * Wired into both `vite dev` (src/lib/server/wsDevPlugin.ts) and the
 * production entry (server.ts) — written once, used unchanged in both.
 */
export default function signalingHandler(ws: WebSocket, _req: IncomingMessage) {
	let alive = true;
	let left = false;
	ws.on('pong', () => { alive = true; });
	const heartbeat = setInterval(() => {
		if (!alive) {
			ws.terminate();
			return;
		}
		alive = false;
		try { ws.ping(); } catch { /* closing */ }
	}, HEARTBEAT_MS);

	ws.on('message', (raw) => {
		alive = true;
		let msg: SignalingMessage;
		try {
			msg = JSON.parse(raw.toString());
		} catch {
			return;
		}

		switch (msg.type) {
			case 'ping':
				break;
			case 'leave':
				left = true;
				ws.close();
				break;
			case 'host': {
				const result = registerHost(msg.roomCode, ws, msg.hostKey);
				if (!result) ws.send(JSON.stringify({ type: 'error', message: 'room-already-hosted' }));
				else ws.send(JSON.stringify({ type: 'registered', roomCode: msg.roomCode, resumed: result.resumed }));
				break;
			}
			case 'join': {
				// Sessions that only friends may enter need a pass the platform signed after checking the friendship (see joinTicket.ts).
				const { roomCode, ticket, peerId, peerKey, restart } = msg;
				void import('./joinAccess.ts')
					.then(({ mayJoin }) => mayJoin(roomCode, ticket))
					.then((allowed) => {
						if (!allowed) {
							ws.send(JSON.stringify({ type: 'error', message: 'friends-only' }));
							return;
						}
						const result = registerGuest(roomCode, ws, { id: peerId, key: peerKey });
						if (!result) {
							ws.send(JSON.stringify({ type: 'error', message: 'room-not-found' }));
							return;
						}
						ws.send(JSON.stringify({ type: 'registered', roomCode, guestId: result.guestId, resumed: result.resumed }));
						result.room.host?.send(JSON.stringify({ type: 'guest-joined', roomCode, guestId: result.guestId, resumed: result.resumed, restart: restart === true }));
					})
					.catch((err) => {
						console.error('Failed to check who may join a room', err);
						ws.send(JSON.stringify({ type: 'error', message: 'room-not-found' }));
					});
				break;
			}
			case 'offer':
			case 'answer':
			case 'ice-candidate': {
				const room = getRoom(msg.roomCode);
				if (!room) return;

				if (ws === room.host) {
					// host -> a specific guest
					const target = msg.targetId ? guestSocket(room, msg.targetId) : null;
					target?.send(JSON.stringify(msg));
				} else if (isGuestOf(room, ws)) {
					// guest -> host, tagged with this guest's id so the host can route its reply back
					room.host?.send(JSON.stringify({ ...msg, fromId: connectionIdFor(ws) }));
				}
				break;
			}
		}
	});

	ws.on('close', () => {
		clearInterval(heartbeat);
		removeSocket(ws, left, (hostedRoomCodes) => {
			void import('./sessionLifecycle.ts').then(({ endSessionsByRoomCodes }) =>
				endSessionsByRoomCodes(hostedRoomCodes)
			).catch((err) => {
				console.error('Failed to close disconnected world sessions', err);
			});
		});
	});
}
