import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { registerHost, registerGuest, getRoom, removeSocket, connectionIdFor } from './rooms.ts';

// Pure relay: this server never inspects world/scene content, only forwards
// WebRTC negotiation JSON so peers can establish a direct P2P connection
// (NAT traversal via STUN, see PUBLIC_STUN_URLS). A host may have several
// guests, each needing its own RTCPeerConnection, so negotiation messages
// carry `fromId` (added by the server) and, from the host, `targetId` (the
// guestId to route the answer to).
type SignalingMessage =
	| { type: 'host'; roomCode: string }
	| { type: 'join'; roomCode: string }
	| {
			type: 'offer' | 'answer' | 'ice-candidate';
			roomCode: string;
			targetId?: string; // required when sent by the host (which guest this is for)
			payload: unknown;
	  };

/**
 * Single reusable WebSocket handler for the `/signaling` route.
 * Wired into both `vite dev` (src/lib/server/wsDevPlugin.ts) and the
 * production entry (server.ts) — written once, used unchanged in both.
 */
export default function signalingHandler(ws: WebSocket, _req: IncomingMessage) {
	ws.on('message', (raw) => {
		let msg: SignalingMessage;
		try {
			msg = JSON.parse(raw.toString());
		} catch {
			return;
		}

		switch (msg.type) {
			case 'host': {
				registerHost(msg.roomCode, ws);
				break;
			}
			case 'join': {
				const result = registerGuest(msg.roomCode, ws);
				if (!result) {
					ws.send(JSON.stringify({ type: 'error', message: 'room-not-found' }));
					return;
				}
				result.room.host.send(
					JSON.stringify({ type: 'guest-joined', roomCode: msg.roomCode, guestId: result.guestId })
				);
				break;
			}
			case 'offer':
			case 'answer':
			case 'ice-candidate': {
				const room = getRoom(msg.roomCode);
				if (!room) return;

				if (ws === room.host) {
					// host -> a specific guest
					const target = msg.targetId ? room.guests.get(msg.targetId) : undefined;
					target?.send(JSON.stringify(msg));
				} else {
					// guest -> host, tagged with this guest's id so the host can route its reply back
					room.host.send(JSON.stringify({ ...msg, fromId: connectionIdFor(ws) }));
				}
				break;
			}
		}
	});

	ws.on('close', () => {
		removeSocket(ws);
	});
}
