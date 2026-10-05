import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

interface Room {
	roomCode: string;
	host: WebSocket;
	guests: Map<string, WebSocket>; // guestId -> socket
}

// Held on `globalThis`: the signaling handler and the app's server code can each load their own copy of this module (in
// `vite dev` the first runs in Vite's own process, the second in its SSR runtime; the production bundle has the same split),
// and the list of active worlds asks which rooms are live: with a map per copy it always found none and ended every session.
const shared = globalThis as typeof globalThis & { __webxrSignalingRooms?: Map<string, Room> };
const rooms = (shared.__webxrSignalingRooms ??= new Map<string, Room>());
const connectionIds = new WeakMap<WebSocket, string>();

function send(socket: WebSocket, data: unknown) {
	if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
}

export function connectionIdFor(socket: WebSocket): string {
	let id = connectionIds.get(socket);
	if (!id) {
		id = randomUUID();
		connectionIds.set(socket, id);
	}
	return id;
}

export function registerHost(roomCode: string, socket: WebSocket): Room | null {
	if (rooms.has(roomCode)) return null;

	const room: Room = { roomCode, host: socket, guests: new Map() };
	rooms.set(roomCode, room);
	return room;
}

/** Registers `socket` as a guest and returns both the room and this guest's assigned id. */
export function registerGuest(roomCode: string, socket: WebSocket): { room: Room; guestId: string } | null {
	const room = rooms.get(roomCode);
	if (!room) return null;
	const guestId = connectionIdFor(socket);
	room.guests.set(guestId, socket);
	return { room, guestId };
}

export function getRoom(roomCode: string): Room | undefined {
	return rooms.get(roomCode);
}

export function getActiveRoomCodes(): Set<string> {
	return new Set(rooms.keys());
}

/** Called on socket close: drops the room (if it was the host) or removes the guest, notifying the other side. */
export function removeSocket(socket: WebSocket): string[] {
	const id = connectionIdFor(socket);
	const hostedRoomCodes: string[] = [];
	for (const [code, room] of rooms) {
		if (room.host === socket) {
			for (const guest of room.guests.values()) send(guest, { type: 'host-left', roomCode: code });
			hostedRoomCodes.push(code);
			rooms.delete(code);
		} else if (room.guests.delete(id)) {
			send(room.host, { type: 'guest-left', roomCode: code, guestId: id });
		}
	}
	return hostedRoomCodes;
}
