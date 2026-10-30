import test from 'node:test';
import assert from 'node:assert/strict';

const fakeSocket = () => {
	const socket = { readyState: 1, OPEN: 1, sent: [], send(data) { this.sent.push(JSON.parse(data)); }, terminate() { this.readyState = 3; } };
	return socket;
};
const ended = [];
const onRoomsEnded = (codes) => ended.push(...codes);

test('the rooms the signaling handler knows are the ones the world list sees, whichever copy of the module asks', async () => {
	// Two copies of the module, as Vite's own process and its SSR runtime (or a bundle) each load one.
	const signaling = await import('../src/lib/server/rooms.ts?signaling');
	const app = await import('../src/lib/server/rooms.ts?app');
	const socket = fakeSocket();
	assert.ok(signaling.registerHost('ROOM42', socket));
	assert.ok(app.getActiveRoomCodes().has('ROOM42'));
	signaling.removeSocket(socket, true, onRoomsEnded);
	assert.equal(app.getActiveRoomCodes().has('ROOM42'), false);
});

test('a host whose socket drops keeps its room a while, and takes it back with its key', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const rooms = await import('../src/lib/server/rooms.ts');
	const host = fakeSocket();
	const hostKey = 'host-key-0001';
	assert.ok(rooms.registerHost('KEEP1', host, hostKey));
	const guest = fakeSocket();
	rooms.registerGuest('KEEP1', guest);

	rooms.removeSocket(host, false, onRoomsEnded);
	assert.ok(rooms.getActiveRoomCodes().has('KEEP1'), 'still live while it waits');
	assert.equal(guest.sent.length, 0, 'the guests are not told yet');
	assert.equal(rooms.registerHost('KEEP1', fakeSocket()), null, 'someone else cannot take it');
	const back = fakeSocket();
	assert.deepEqual(rooms.registerHost('KEEP1', back, hostKey)?.resumed, true);
	t.mock.timers.tick(rooms.RECONNECT_GRACE_MS + 1);
	assert.ok(rooms.getActiveRoomCodes().has('KEEP1'), 'the host came back in time');
	assert.equal(guest.sent.length, 0);
	rooms.removeSocket(back, true, onRoomsEnded);
});

test('a host that does not come back in time closes its room and the guests are told', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const rooms = await import('../src/lib/server/rooms.ts');
	const host = fakeSocket();
	rooms.registerHost('GONE1', host, 'host-key-0002');
	const guest = fakeSocket();
	rooms.registerGuest('GONE1', guest);
	rooms.removeSocket(host, false, onRoomsEnded);
	t.mock.timers.tick(rooms.RECONNECT_GRACE_MS + 1);
	assert.equal(rooms.getActiveRoomCodes().has('GONE1'), false);
	assert.deepEqual(guest.sent.map((m) => m.type), ['host-left']);
	assert.ok(ended.includes('GONE1'), 'its sessions are ended');
});

test('a guest keeps its id across sockets with its key, and the host hears of it only if it does not come back', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const rooms = await import('../src/lib/server/rooms.ts');
	const host = fakeSocket();
	rooms.registerHost('GUEST1', host, 'host-key-0003');
	const peer = { id: 'guest-id-0001', key: 'guest-key-0001' };
	const first = fakeSocket();
	const joined = rooms.registerGuest('GUEST1', first, peer);
	assert.equal(joined.guestId, peer.id);
	assert.equal(joined.resumed, false);

	rooms.removeSocket(first, false, onRoomsEnded);
	assert.equal(host.sent.length, 0, 'a dropped socket is waited for');
	const intruder = rooms.registerGuest('GUEST1', fakeSocket(), { id: peer.id, key: 'not-the-key-01' });
	assert.notEqual(intruder.guestId, peer.id, 'its id is not taken without its key');
	const second = fakeSocket();
	const back = rooms.registerGuest('GUEST1', second, peer);
	assert.equal(back.guestId, peer.id);
	assert.equal(back.resumed, true);
	assert.ok(rooms.isGuestOf(rooms.getRoom('GUEST1'), second));
	t.mock.timers.tick(rooms.RECONNECT_GRACE_MS + 1);
	assert.equal(host.sent.filter((m) => m.guestId === peer.id).length, 0);

	rooms.removeSocket(second, false, onRoomsEnded);
	t.mock.timers.tick(rooms.RECONNECT_GRACE_MS + 1);
	assert.deepEqual(host.sent.filter((m) => m.guestId === peer.id), [{ type: 'guest-left', roomCode: 'GUEST1', guestId: peer.id, reason: 'timeout' }]);
});

test('a guest that says goodbye is gone at once', async () => {
	const rooms = await import('../src/lib/server/rooms.ts');
	const host = fakeSocket();
	rooms.registerHost('BYE1', host, 'host-key-0004');
	const guest = fakeSocket();
	const { guestId } = rooms.registerGuest('BYE1', guest);
	rooms.removeSocket(guest, true, onRoomsEnded);
	assert.deepEqual(host.sent, [{ type: 'guest-left', roomCode: 'BYE1', guestId, reason: 'left' }]);
});
