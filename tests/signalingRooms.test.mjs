import test from 'node:test';
import assert from 'node:assert/strict';

test('the rooms the signaling handler knows are the ones the world list sees, whichever copy of the module asks', async () => {
	// Two copies of the module, as Vite's own process and its SSR runtime (or a bundle) each load one.
	const signaling = await import('../src/lib/server/rooms.ts?signaling');
	const app = await import('../src/lib/server/rooms.ts?app');
	const socket = { readyState: 1, OPEN: 1, send() {} };
	assert.ok(signaling.registerHost('ROOM42', socket));
	assert.ok(app.getActiveRoomCodes().has('ROOM42'));
	signaling.removeSocket(socket);
	assert.equal(app.getActiveRoomCodes().has('ROOM42'), false);
});
