import { test } from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../packages/engine/src/physics/shapes.ts';
import { CollisionWorld } from '../packages/engine/src/physics/world.ts';
import { CharacterBody, DEFAULT_CHARACTER } from '../packages/engine/src/physics/character.ts';

const DT = 1 / 60;
const turn = (deg) => [0, 0, Math.sin((deg * Math.PI) / 360), Math.cos((deg * Math.PI) / 360)];
const floor = () => box([0, -0.5, 0], [100, 0.5, 100]);
const make = (config = {}, ...solids) => {
	const world = new CollisionWorld();
	world.set('floor', floor());
	solids.forEach((shape, n) => world.set(`s${n}`, shape));
	const body = new CharacterBody({ ...DEFAULT_CHARACTER, ...config }, world);
	return { world, body };
};
/** Runs `seconds`, steering at `speed` m/s along x (and z), calling `each` every frame. */
function run(body, seconds, speed = [0, 0], each) {
	for (let t = 0; t < seconds; t += DT) {
		body.step([speed[0] * DT, 0, speed[1] * DT], DT);
		each?.(t);
	}
}
const near = (a, b, e, what) => assert.ok(Math.abs(a - b) <= e, `${what ?? ''}: ${a} is not ${b} ± ${e}`);

/** A ramp rising along +x from the origin at `deg` degrees, with the floor under the flat part. */
const ramp = (deg) => {
	const a = (deg * Math.PI) / 180;
	return box([0.5 * Math.sin(a), -0.5 * Math.cos(a), 0], [20, 0.5, 20], turn(deg));
};

test('a body falls onto the floor and stands on it, and walks at the speed it is steered', () => {
	const { body } = make();
	body.position = [0, 2, 0];
	run(body, 1);
	assert.equal(body.grounded, true);
	near(body.position[1], 0, 0.01, 'on the floor');
	const x = body.position[0];
	run(body, 1, [2, 0]);
	near(body.position[0] - x, 2, 0.05, 'walked 2 m in a second');
	assert.equal(body.grounded, true);
});

test('a wall stops a body, which then slides along it instead of sticking', () => {
	const { body } = make({}, box([3.5, 2, 0], [0.5, 2, 20]));
	body.position = [0, 0, 0];
	run(body, 3, [2, 0]);
	near(body.position[0], 3 - body.config.radius, 0.02, 'a radius from the wall');
	const z = body.position[2];
	run(body, 1, [2, 1]);
	near(body.position[0], 3 - body.config.radius, 0.02, 'still held off the wall');
	near(body.position[2] - z, 1, 0.05, 'and carried along it by what it steered across');
});

test('a jump reaches v²/2g and the body lands again', () => {
	const { body } = make({ jumpSpeed: 4.9, gravity: 9.8 });
	run(body, 0.5);
	let top = 0, lifted = false;
	body.jump();
	run(body, 1.5, [0, 0], () => { top = Math.max(top, body.position[1]); lifted ||= !body.grounded; });
	near(top, 1.225, 0.07, 'height');
	assert.ok(lifted);
	assert.equal(body.grounded, true, 'landed');
});

test('a slope within the limit is walked up at the pace it is steered along the floor, and stood on without sliding', () => {
	const { body } = make({ slopeLimit: 50 }, ramp(30));
	run(body, 0.5);
	run(body, 2, [1.5, 0]);
	near(body.position[0], 3, 0.1, 'across');
	near(body.position[1], 3 * Math.tan((30 * Math.PI) / 180), 0.12, 'and up the slope');
	assert.equal(body.grounded, true);
	const at = [...body.position];
	run(body, 1);
	near(body.position[0], at[0], 0.01, 'it does not slide down');
	run(body, 2, [-1.5, 0]);
	assert.ok(body.position[0] < 0.3 && body.grounded, 'and comes down again');
	near(body.position[1], 0, 0.15, 'to the floor');
});

test('a 45° slope can be walked up and jumped from', () => {
	const { body } = make({ slopeLimit: 50, jumpSpeed: 5 }, ramp(45));
	run(body, 0.5);
	run(body, 1.5, [2, 0]);
	assert.equal(body.grounded, true, 'standing on it');
	assert.ok(body.position[1] > 1.5, `it went up: ${body.position[1].toFixed(2)}`);
	const y = body.position[1];
	body.jump();
	let top = y;
	run(body, 0.6, [0, 0], () => { top = Math.max(top, body.position[1]); });
	assert.ok(top > y + 0.8, `and it jumped: ${(top - y).toFixed(2)}`);
});

test('a slope steeper than the limit is not walked up, and with sliding on it is slid down', () => {
	const steep = make({ slopeLimit: 50 }, ramp(65));
	run(steep.body, 0.5);
	run(steep.body, 2, [2, 0]);
	assert.ok(steep.body.position[1] < 1, `blocked at the foot of it: ${steep.body.position.map((n) => n.toFixed(2))}`);

	const sliding = make({ slopeLimit: 50, slideSteepSlopes: true }, ramp(65));
	sliding.body.position = [1.5, 3.2, 0]; // above the slope
	run(sliding.body, 0.6);
	const x = sliding.body.position[0];
	run(sliding.body, 1.5);
	assert.ok(sliding.body.position[0] < x - 0.3, `it slid back down: ${x.toFixed(2)} → ${sliding.body.position[0].toFixed(2)}`);
});

test('a low step is walked onto and a high one is not', () => {
	const low = make({ stepHeight: 0.4 }, box([2, 0.15, 0], [1, 0.15, 20]));
	run(low.body, 0.3);
	run(low.body, 2, [1.5, 0]);
	near(low.body.position[1], 0.3, 0.02, 'on the step');
	assert.ok(low.body.position[0] > 2.5 && low.body.grounded);

	const high = make({ stepHeight: 0.4 }, box([2, 0.3, 0], [1, 0.3, 20]));
	run(high.body, 0.3);
	run(high.body, 2, [1.5, 0]);
	assert.ok(high.body.position[0] < 1 - 0.2, `held at the foot of it: ${high.body.position[0].toFixed(2)}`);
	assert.ok(high.body.position[1] < 0.05);
});

test('a body walks off a ledge and falls, with a moment (coyote time) in which a jump still counts', () => {
	const ledge = [box([0, -0.5, 0], [3, 0.5, 20])];
	const withCoyote = (wait) => {
		const world = new CollisionWorld();
		world.set('ledge', ledge[0]);
		const body = new CharacterBody({ ...DEFAULT_CHARACTER, coyoteTime: 0.12, jumpSpeed: 5 }, world);
		body.position = [2, 0, 0];
		run(body, 0.3);
		run(body, 1, [2, 0], () => {});
		return { body, world, wait };
	};
	const a = withCoyote(0.05);
	assert.equal(a.body.grounded, false, 'off the ledge');
	// Walk off again and jump soon after leaving it.
	const make2 = () => {
		const world = new CollisionWorld();
		world.set('ledge', ledge[0]);
		const body = new CharacterBody({ ...DEFAULT_CHARACTER, coyoteTime: 0.12, jumpSpeed: 5 }, world);
		body.position = [2.8, 0, 0];
		run(body, 0.2);
		return body;
	};
	const soon = make2();
	let jumped = false;
	for (let t = 0; t < 1; t += DT) {
		soon.step([2 * DT, 0, 0], DT);
		if (!soon.grounded && soon.sinceGrounded > 0.04 && !jumped) { soon.jump(); jumped = true; }
	}
	const late = make2();
	let lateJumped = false;
	let lateTop = 0;
	for (let t = 0; t < 1; t += DT) {
		late.step([2 * DT, 0, 0], DT);
		if (!late.grounded && late.sinceGrounded > 0.3 && !lateJumped) { late.jump(); lateJumped = true; late.vyAtJump = late.velocity[1]; }
		lateTop = Math.min(lateTop, late.velocity[1]);
	}
	assert.equal(soon.lastJump, 'ground', 'a jump a moment after leaving the ledge still works');
	assert.equal(late.lastJump, null, 'a jump long after does not');
});

test('a jump asked for just before landing is not lost (jump buffer)', () => {
	const { body } = make({ jumpBuffer: 0.15, jumpSpeed: 5 });
	body.position = [0, 0.15, 0];
	body.jump();
	run(body, 0.5);
	assert.equal(body.lastJump, 'ground', 'it jumped as soon as it landed');
});

test('against a wall a jump can be repeated to climb it, and holding on slows the fall', () => {
	const walls = [box([1, 20, 0], [0.5, 20, 20]), box([-1.2, 20, 0], [0.5, 20, 20])];
	const { body } = make({ wallJump: true, jumpSpeed: 4, wallJumpOut: 0, wallSlideSpeed: 1.5, gravity: 12 }, ...walls);
	body.position = [0.3, 0, 0];
	run(body, 0.3);
	let top = 0;
	for (let i = 0; i < 6; i++) {
		body.jump();
		run(body, 0.45, [1, 0], () => { top = Math.max(top, body.position[1]); });
	}
	assert.ok(top > 2.5, `climbed to ${top.toFixed(2)} (one jump is ${(16 / 24).toFixed(2)})`);
	const high = box([0, 20, 5], [0.5, 20, 0.5]);
	void high;
	// Sliding: a fall along the wall is capped.
	let slowest = 0;
	body.position = [0.3, 30, 0];
	body.velocity = [0, 0, 0];
	run(body, 1.5, [1, 0], () => { slowest = Math.min(slowest, body.velocity[1]); });
	assert.ok(slowest >= -1.6, `held to ${slowest.toFixed(2)} m/s`);
});

test('a lane keeps the body between two limits across the way it goes, as in a 2.5D game', () => {
	const { body } = make({ lane: { axis: 'z', center: 0, halfWidth: 1.5 } });
	run(body, 0.3);
	run(body, 2, [0, 3]);
	near(body.position[2], 1.5 - body.config.radius, 0.01, 'stopped at the edge of the lane');
	run(body, 2, [0, -3]);
	near(body.position[2], -(1.5 - body.config.radius), 0.01);
});

test('a push throws the body and fades; a push up is a jump', () => {
	const { body } = make({ impulseDrag: 4 });
	run(body, 0.3);
	const x = body.position[0];
	body.addImpulse([6, 0, 0]);
	run(body, 2);
	const thrown = body.position[0] - x;
	near(thrown, 6 / 4, 0.15, 'it goes v/drag');
	assert.equal(Math.abs(body.velocity[0]) < 0.05, true, 'and stops');
	body.addImpulse([0, 4, 0]);
	run(body, 0.2);
	assert.ok(body.position[1] > 0.3 && !body.grounded, 'up in the air');
});

test('a ceiling stops a jump, and a fall is no faster than the terminal speed', () => {
	const { body } = make({ jumpSpeed: 8, gravity: 20 }, box([0, 3.5, 0], [5, 0.5, 5]));
	run(body, 0.3);
	body.jump();
	let top = 0;
	run(body, 0.8, [0, 0], () => { top = Math.max(top, body.position[1]); });
	assert.ok(top < 1.25 && top > 1.0, `the head met the ceiling: ${top.toFixed(2)}`);
	const free = make({ terminalSpeed: 15 });
	free.body.position = [10, 80, 0];
	let fastest = 0;
	run(free.body, 5, [0, 0], () => { fastest = Math.min(fastest, free.body.velocity[1]); });
	near(fastest, -15, 0.01, 'terminal');
});
