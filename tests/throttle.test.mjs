import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThrottle } from '../src/lib/xr/net/throttle.ts';

/** A clock the test moves by hand, with timers that fire when it passes them. */
function fakeClock() {
	let now = 1000;
	let nextId = 1;
	const timers = new Map();
	return {
		now: () => now,
		setTimer: (callback, ms) => { const id = nextId++; timers.set(id, { at: now + ms, callback }); return id; },
		clearTimer: (id) => timers.delete(id),
		advance(ms) {
			const end = now + ms;
			for (;;) {
				const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				timers.delete(due[0]);
				now = due[1].at;
				due[1].callback();
			}
			now = end;
		},
		pending: () => timers.size
	};
}

test('the first call runs at once', () => {
	const clock = fakeClock();
	let runs = 0;
	createThrottle(() => runs++, 100, clock)();
	assert.equal(runs, 1);
});

test('calls that come too soon are folded into one run when the interval is over', () => {
	const clock = fakeClock();
	let runs = 0;
	const call = createThrottle(() => runs++, 100, clock);
	call();
	clock.advance(10);
	call(); call(); call();
	assert.equal(runs, 1, 'nothing yet');
	assert.equal(clock.pending(), 1, 'a single run is waiting');
	clock.advance(89);
	assert.equal(runs, 1);
	clock.advance(1);
	assert.equal(runs, 2, 'one run for the three calls, at the end of the interval');
	assert.equal(clock.pending(), 0);
});

test('after a quiet spell the next call goes straight through again', () => {
	const clock = fakeClock();
	let runs = 0;
	const call = createThrottle(() => runs++, 100, clock);
	call();
	clock.advance(500);
	call();
	assert.equal(runs, 2);
});

test('a steady stream of calls runs once per interval, and the last call always gets a run', () => {
	const clock = fakeClock();
	let runs = 0;
	const call = createThrottle(() => runs++, 100, clock);
	for (let t = 0; t < 1000; t += 10) { call(); clock.advance(10); }
	assert.ok(runs >= 9 && runs <= 11, `${runs} runs in a second`);
	const before = runs;
	call();
	clock.advance(150);
	assert.ok(runs > before, 'the call made last was not lost');
});

test('cancel drops the run that was waiting', () => {
	const clock = fakeClock();
	let runs = 0;
	const call = createThrottle(() => runs++, 100, clock);
	call(); call();
	call.cancel();
	clock.advance(500);
	assert.equal(runs, 1);
	assert.equal(clock.pending(), 0);
});
