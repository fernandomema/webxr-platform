import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';

/**
 * How long a room, or a guest's place in it, waits for a socket that dropped without saying goodbye (a network blip, a proxy
 * closing an idle connection, the server restarting) to come back. The players' direct link usually keeps working meanwhile,
 * so telling the other side "they left" straight away would split a session that is still fine.
 */
export const RECONNECT_GRACE_MS = 30_000;

interface Room {
	roomCode: string;
	/** Null while the host's socket is gone and the room waits for it to come back. */
	host: WebSocket | null;
	/** A secret only the host's client knows: what lets it take the room back after its socket dropped. */
	hostKey: string | null;
	hostGrace: ReturnType<typeof setTimeout> | null;
	guests: Map<string, GuestPlace>;
}

interface GuestPlace {
	/** Null while this guest's socket is gone and its place waits for it. */
	socket: WebSocket | null;
	/** Like `hostKey`, for a guest that chose its own id. */
	key: string | null;
	grace: ReturnType<typeof setTimeout> | null;
}

// Held on `globalThis`: the signaling handler and the app's server code can each load their own copy of this module (in
// `vite dev` the first runs in Vite's own process, the second in its SSR runtime; the production bundle has the same split),
// and the list of active worlds asks which rooms are live: with a map per copy it always found none and ended every session.
const shared = globalThis as typeof globalThis & { __webxrSignalingRooms?: Map<string, Room> };
const rooms = (shared.__webxrSignalingRooms ??= new Map<string, Room>());
const connectionIds = new WeakMap<WebSocket, string>();

function send(socket: WebSocket | null, data: unknown) {
	if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(data));
}

export function connectionIdFor(socket: WebSocket): string {
	let id = connectionIds.get(socket);
	if (!id) {
		id = randomUUID();
		connectionIds.set(socket, id);
	}
	return id;
}

/** An id or key a client chose for itself: a short token, nothing that could be confused with anything else. */
const isToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(value);

/**
 * Registers `socket` as the host of `roomCode`. A room that already has a host is refused, unless the one asking holds the
 * room's key: the same host coming back on a new socket. `resumed` says it was such a return.
 */
export function registerHost(roomCode: string, socket: WebSocket, hostKey?: unknown): { room: Room; resumed: boolean } | null {
	const key = isToken(hostKey) ? hostKey : null;
	const existing = rooms.get(roomCode);
	if (existing) {
		if (!key || existing.hostKey !== key) return null;
		if (existing.hostGrace) clearTimeout(existing.hostGrace);
		existing.hostGrace = null;
		if (existing.host && existing.host !== socket) existing.host.terminate();
		existing.host = socket;
		return { room: existing, resumed: true };
	}
	const room: Room = { roomCode, host: socket, hostKey: key, hostGrace: null, guests: new Map() };
	rooms.set(roomCode, room);
	return { room, resumed: false };
}

/**
 * Registers `socket` as a guest and returns the room, this guest's id, and whether it is a guest coming back. A guest may
 * name its own id (`peer`), so that it keeps its place, and everything the host knows about it, across a new socket.
 */
export function registerGuest(roomCode: string, socket: WebSocket, peer?: { id?: unknown; key?: unknown }): { room: Room; guestId: string; resumed: boolean } | null {
	const room = rooms.get(roomCode);
	if (!room) return null;
	let guestId = connectionIdFor(socket);
	let key: string | null = null;
	if (isToken(peer?.id) && isToken(peer?.key)) {
		const place = room.guests.get(peer.id);
		// Someone else's id is not taken over: without its key the guest gets a fresh one.
		if (!place || place.key === peer.key) {
			guestId = peer.id;
			key = peer.key;
			connectionIds.set(socket, guestId);
		}
	}
	const place = room.guests.get(guestId);
	if (place) {
		if (place.grace) clearTimeout(place.grace);
		place.grace = null;
		if (place.socket && place.socket !== socket) place.socket.terminate();
		place.socket = socket;
		return { room, guestId, resumed: true };
	}
	room.guests.set(guestId, { socket, key, grace: null });
	return { room, guestId, resumed: false };
}

export function getRoom(roomCode: string): Room | undefined {
	return rooms.get(roomCode);
}

/** The socket a guest of `room` is reached on, if it is connected now. */
export function guestSocket(room: Room, guestId: string): WebSocket | null {
	return room.guests.get(guestId)?.socket ?? null;
}

/** Whether `socket` is a guest of `room`, and so may send its host negotiation messages. */
export function isGuestOf(room: Room, socket: WebSocket): boolean {
	return room.guests.get(connectionIdFor(socket))?.socket === socket;
}

/** Rooms with a host, or waiting for theirs to come back: a session in that time is still live. */
export function getActiveRoomCodes(): Set<string> {
	return new Set(rooms.keys());
}

function closeRoom(code: string, room: Room): void {
	if (room.hostGrace) clearTimeout(room.hostGrace);
	for (const place of room.guests.values()) {
		if (place.grace) clearTimeout(place.grace);
		send(place.socket, { type: 'host-left', roomCode: code });
	}
	rooms.delete(code);
}

function dropGuest(room: Room, guestId: string, reason: 'left' | 'timeout'): void {
	const place = room.guests.get(guestId);
	if (!place) return;
	if (place.grace) clearTimeout(place.grace);
	room.guests.delete(guestId);
	send(room.host, { type: 'guest-left', roomCode: room.roomCode, guestId, reason });
}

/**
 * Called when a socket closes. `left` is a goodbye the client said (it ended the session): the other side is told at once.
 * Otherwise the room or the guest's place waits `RECONNECT_GRACE_MS` for it to come back first. `onRoomsEnded` gets the
 * codes of the rooms that close, now or once their wait is over.
 */
export function removeSocket(socket: WebSocket, left: boolean, onRoomsEnded: (roomCodes: string[]) => void): void {
	const id = connectionIdFor(socket);
	const endedNow: string[] = [];
	for (const [code, room] of rooms) {
		if (room.host === socket) {
			if (left) {
				closeRoom(code, room);
				endedNow.push(code);
			} else {
				room.host = null;
				room.hostGrace = setTimeout(() => {
					if (rooms.get(code) !== room || room.host) return;
					closeRoom(code, room);
					onRoomsEnded([code]);
				}, RECONNECT_GRACE_MS);
			}
			continue;
		}
		const place = room.guests.get(id);
		if (!place || place.socket !== socket) continue;
		if (left) dropGuest(room, id, 'left');
		else {
			place.socket = null;
			place.grace = setTimeout(() => {
				if (room.guests.get(id) === place && !place.socket) dropGuest(room, id, 'timeout');
			}, RECONNECT_GRACE_MS);
		}
	}
	if (endedNow.length > 0) onRoomsEnded(endedNow);
}
