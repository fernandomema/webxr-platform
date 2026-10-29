import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createTestWorld } from '../../packages/engine/src/testing.ts';
import { lintWorld } from '../../packages/engine/src/worlds/lint.ts';
import { scanPackAssets, syncPackAssets } from '../../src/lib/worldPacks/core.ts';

// The pack's `assets.ts` is generated (and not in git): make it before the world is loaded.
const packDir = new URL('.', import.meta.url).pathname;
syncPackAssets(packDir);
const { default: pack } = await import('./world.ts');
const { loadBowlingLogic } = await import('./bowlingLogic.ts');
const { BOWLING, LANE_COUNT, BALLS_PER_LANE, ballHome, laneIds, DIRECTOR_ID, JUKEBOX_ID } = await import('./bowlingLayout.ts');
const { ASSETS } = await import('./assets.ts');

const logic = loadBowlingLogic();
const tree = pack.build();
const byId = new Map(tree.map((slot) => [slot.id, slot]));
const find = (slot, type) => slot.components.find((c) => c.type === type);

/** A seeded random source, for throws that vary like people's. */
function seeded(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---------------------------------------------------------------- the scene

test('the world is a valid scene: unique ids, known parents, sensible size', () => {
	assert.ok(tree.length > 200 && tree.length < 700, `${tree.length} slots`);
	assert.equal(byId.size, tree.length, 'ids are unique');
	for (const slot of tree) {
		assert.equal(slot.position.length, 3);
		assert.equal(slot.rotation.length, 4);
		assert.equal(slot.scale.length, 3);
		assert.ok(slot.scale.every((v) => v > 0), `${slot.id} has a positive scale`);
		assert.ok(Math.abs(Math.hypot(...slot.rotation) - 1) < 1e-6, `${slot.id} has a unit rotation`);
		if (slot.parentId !== null) assert.ok(byId.has(slot.parentId), `${slot.id} has its parent`);
	}
});

test('every file the scene uses is in the pack, and the models are the two given ones', () => {
	const used = new Set();
	for (const slot of tree) {
		const mesh = find(slot, 'meshRenderer');
		if (mesh?.meshRef.kind === 'asset') used.add(mesh.meshRef.assetId);
		const material = find(slot, 'material');
		for (const key of ['albedo', 'normal', 'arm']) if (material?.[key]?.kind === 'asset') used.add(material[key].assetId);
	}
	const known = new Set(Object.values(ASSETS));
	for (const id of used) assert.ok(known.has(id), `${id} is not an asset of the pack`);
	for (const path of Object.keys(scanPackAssets(`${packDir}assets`))) assert.ok(existsSync(`${packDir}assets/${path}`));
	assert.ok(used.has(ASSETS['models/bowling-ball.glb']) && used.has(ASSETS['models/bowling-pin.glb']));
	const glb = (path) => readFileSync(`${packDir}assets/${path}`);
	for (const path of ['models/bowling-ball.glb', 'models/bowling-pin.glb']) assert.equal(glb(path).subarray(0, 4).toString(), 'glTF');
});

test('each lane has ten pins in the right places, balls on its return, and a desk', () => {
	const spots = logic.pinSpots();
	assert.equal(spots.length, 10);
	for (let lane = 0; lane < LANE_COUNT; lane++) {
		const ids = laneIds(lane);
		for (const spot of spots) {
			const pin = byId.get(ids.pin(spot.n));
			assert.ok(pin, `lane ${lane} pin ${spot.n}`);
			assert.equal(find(pin, 'meshRenderer').modelScale, 'native', 'the pin keeps its real size, with its origin at its base');
			assert.ok(!find(pin, 'grabbable') && !find(pin, 'collider'));
			assert.ok(Math.abs(pin.position[0] - (BOWLING.laneX[lane] + spot.u)) < 1e-9 && Math.abs(pin.position[2] - (BOWLING.foulZ + spot.w)) < 1e-9);
		}
		for (let k = 0; k < BALLS_PER_LANE; k++) {
			const ball = byId.get(ids.ball(k));
			assert.ok(find(ball, 'grabbable') && find(ball, 'collider'), 'a ball can be picked up');
			assert.deepEqual(ball.position, ballHome(lane, k));
			assert.ok(ball.scale.every((s) => Math.abs(s - 0.216) < 1e-9), 'a regulation ball is 21.6 cm across');
		}
		assert.deepEqual(find(byId.get(ids.board), 'scoreboard').columns.length, 10);
		for (const id of [ids.join, ids.leave, ids.bumpers, ids.assist, ids.newGame, ids.cheer]) assert.equal(find(byId.get(id), 'uiElement').kind, 'button');
	}
	const homes = [];
	for (let lane = 0; lane < LANE_COUNT; lane++) for (let k = 0; k < BALLS_PER_LANE; k++) homes.push(ballHome(lane, k));
	for (let i = 0; i < homes.length; i++) for (let j = i + 1; j < homes.length; j++) assert.ok(Math.hypot(homes[i][0] - homes[j][0], homes[i][2] - homes[j][2]) > 0.25, 'balls do not overlap on the return');
});

test('players arrive in front of the lanes, looking down them, with the floor under them', () => {
	const spawn = tree.find((slot) => find(slot, 'spawnPoint'));
	assert.deepEqual(spawn.position, [...BOWLING.spawn]);
	assert.deepEqual(spawn.rotation, [0, 0, 0, 1], 'it faces +Z, the way the lanes run');
	const floors = tree.filter((slot) => find(slot, 'collider') && find(slot, 'meshRenderer')?.meshRef.id === 'box' && slot.id.startsWith('bw-floor'));
	assert.ok(floors.some((f) => Math.abs(spawn.position[0] - f.position[0]) <= f.scale[0] / 2 && Math.abs(spawn.position[2] - f.position[2]) <= f.scale[2] / 2));
});

test('people cannot walk onto the lanes, but a ball can roll over the foul line', () => {
	for (const id of ['bw-barrier-front', 'bw-barrier-west', 'bw-barrier-east']) {
		const wall = byId.get(id);
		assert.ok(find(wall, 'collider') && find(wall, 'meshRenderer').opacity === 0, `${id} is a solid you cannot see`);
	}
	const script = find(byId.get(DIRECTOR_ID), 'codeBlock').code;
	for (const id of ['bw-barrier-front', 'bw-barrier-west', 'bw-barrier-east']) assert.ok(script.includes(`"${id}"`), `the balls pass through ${id}`);
});

test('every lamp is baked, so a headset draws none of them live once the volume is in the pack', () => {
	const lights = tree.filter((slot) => find(slot, 'pointLight') || find(slot, 'spotLight'));
	assert.ok(lights.length >= 6 && lights.length <= 9, `${lights.length} live lamps: a shader takes about ten`);
	for (const light of lights) assert.equal((find(light, 'pointLight') ?? find(light, 'spotLight')).baked, true, `${light.id} is baked`);
	const volume = tree.find((slot) => find(slot, 'lightVolume'));
	assert.ok(volume, 'the baked volume is in the scene (run `npm run bake -- bowling` after changing a light or the scenery)');
	assert.equal(find(volume, 'lightVolume').data.kind, 'asset');
});

test('the world has no layout or readability problems of the kind tools can find', () => {
	const findings = lintWorld(tree);
	assert.deepEqual(findings, [], findings.map((f) => `${f.rule} ${f.slotId}: ${f.message}`).join('\n'));
});

test('both scripts compile and the consoles hang from the director, which hears their presses', () => {
	for (const id of [DIRECTOR_ID, JUKEBOX_ID]) assert.doesNotThrow(() => new Function('ctx', find(byId.get(id), 'codeBlock').code));
	for (let lane = 0; lane < LANE_COUNT; lane++) {
		let at = byId.get(laneIds(lane).join);
		while (at.parentId && at.id !== DIRECTOR_ID) at = byId.get(at.parentId);
		assert.equal(at.id, DIRECTOR_ID);
	}
	// The ids the script names whole (the rest it builds from a lane number).
	for (const match of find(byId.get(DIRECTOR_ID), 'codeBlock').code.matchAll(/'(bw-[a-z0-9-]+)'/g)) if (!match[1].endsWith('-') && match[1] !== 'bw-l') assert.ok(byId.has(match[1]), `the script uses ${match[1]}`);
	for (const name of ['board', 'monitor', 'status', 'bumpers', 'assist', 'console', 'join', 'leave', 'newGame', 'cheer']) assert.ok(byId.has(laneIds(0)[name]), `lane ${name}`);
});

// ---------------------------------------------------------------- the scoring

const score = (rolls) => logic.scoreGame(rolls);

test('scoring: a perfect game is 300, all gutter games 0, five-and-spare 150, and the running totals wait for their bonus', () => {
	assert.equal(score(Array(12).fill(10)).total, 300);
	assert.equal(score(Array(20).fill(0)).total, 0);
	assert.equal(score(Array(21).fill(5)).total, 150);
	assert.equal(score(Array(10).fill([9, 0]).flat()).total, 90);
	const card = score([10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1]);
	assert.deepEqual(card.frames.map((f) => f.score), [20, 39, 48, 66, 74, 84, 90, 120, 148, 167]);
	assert.deepEqual(card.frames.map((f) => f.mark.join('')), ['X', '7/', '9-', 'X', '-8', '8/', '-6', 'X', 'X', 'X81']);
	const open = score([10, 10]);
	assert.deepEqual(open.frames.slice(0, 2).map((f) => f.score), [null, null], 'a strike scores when two more balls are known');
	assert.equal(score([10, 10, 5]).frames[0].score, 25);
});

test('scoring: the tenth frame gives a third ball only for a strike or a spare', () => {
	const next = (rolls) => logic.nextRoll(rolls);
	const nine = Array(18).fill(0);
	assert.deepEqual(next(nine), { frame: 9, roll: 0, standing: 10, done: false });
	assert.deepEqual(next([...nine, 3]), { frame: 9, roll: 1, standing: 7, done: false });
	assert.equal(next([...nine, 3, 4]).done, true, 'an open tenth is over after two balls');
	assert.deepEqual(next([...nine, 3, 7]), { frame: 9, roll: 2, standing: 10, done: false });
	assert.deepEqual(next([...nine, 10]), { frame: 9, roll: 1, standing: 10, done: false });
	assert.deepEqual(next([...nine, 10, 6]), { frame: 9, roll: 2, standing: 4, done: false });
	assert.equal(next([...nine, 10, 6, 4]).done, true);
	assert.equal(next([...nine, 10, 10, 10]).done, true);
});

test('a game goes round the players frame by frame, a strike ends a turn, and it is over when all have finished', () => {
	const game = logic.newGame([{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }]);
	assert.equal(logic.currentPlayer(game).name, 'Ann');
	let result = logic.recordRoll(game, 7);
	assert.equal(result.turnEnds, false);
	assert.equal(result.standing, 3);
	assert.equal(logic.currentPlayer(game).name, 'Ann', 'a second ball');
	result = logic.recordRoll(game, 3);
	assert.ok(result.spare && result.turnEnds);
	assert.equal(logic.currentPlayer(game).name, 'Bo');
	result = logic.recordRoll(game, 10);
	assert.ok(result.strike && result.turnEnds && result.standing === 10);
	assert.equal(logic.currentPlayer(game).name, 'Ann');
	// Play both out with strikes: 12 balls each.
	let guard = 0;
	while (!game.over && guard++ < 100) logic.recordRoll(game, 10);
	assert.ok(game.over && logic.currentPlayer(game) === null);
	assert.ok(game.players.every((p) => logic.isComplete(p.rolls)));
	// A player who joins late is added at the end and the game goes on until they are done.
	const late = logic.newGame([{ id: 'a', name: 'Ann' }]);
	logic.recordRoll(late, 4);
	assert.ok(logic.addPlayer(late, { id: 'c', name: 'Cy' }));
	assert.equal(logic.addPlayer(late, { id: 'c', name: 'Cy' }), false, 'nobody plays twice');
	assert.equal(logic.currentPlayer(late).name, 'Ann');
});

test('the scoreboard shows marks over running totals, two rows to a player, the one who is up highlighted', () => {
	const player = { id: 'a', name: 'Ann', rolls: [10, 7, 3, 4] };
	const [marks, totals] = logic.boardRows(player, true);
	assert.deepEqual(marks.cells.slice(0, 3), ['X', '7 /', '4']);
	assert.deepEqual(totals.cells.slice(0, 3), ['20', '34', '']);
	assert.ok(marks.highlight && totals.highlight && marks.name === 'Ann' && totals.name === '');
});

// ---------------------------------------------------------------- the physics

/** Rolls a ball down a lane from `u` at `angle` degrees (0 is straight at the head pin) and `speed`, and reports the pins left. */
function roll(pins, { u = 0, angle = 0, speed = 7.5, bumpers = false }) {
	const a = (angle * Math.PI) / 180;
	const ball = { u, w: 0, y: logic.BALL_R, vu: Math.sin(a) * speed, vw: Math.cos(a) * speed, vy: 0 };
	let gutter = false;
	for (let t = 0; t < 14; t += logic.STEP) {
		const out = logic.stepBall(ball, logic.STEP, bumpers, true);
		gutter ||= out.gutter;
		logic.stepPins(pins, ball.w > logic.HEAD - 0.6 ? ball : null, logic.STEP);
		if (out.pit && !logic.pinsBusy(pins)) break;
	}
	return { ball, gutter, down: logic.pinsDown(pins) };
}

test('the pins are laid out like a real rack: 30.5 cm apart, four rows, the head pin 18.29 m from the line', () => {
	const spots = logic.pinSpots();
	assert.deepEqual(spots.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	const at = (n) => spots.find((s) => s.n === n);
	assert.ok(Math.abs(at(1).w - 18.29) < 1e-9 && at(1).u === 0);
	assert.ok(Math.abs(at(7).u + 0.4575) < 1e-9 && Math.abs(at(10).u - 0.4575) < 1e-9, 'the corner pins are 45.75 cm either side');
	assert.ok(Math.abs(Math.hypot(at(2).u - at(3).u, at(2).w - at(3).w) - 0.305) < 1e-9);
	assert.ok(Math.abs(Math.hypot(at(1).u - at(2).u, at(1).w - at(2).w) - 0.305) < 1e-3, 'equilateral');
});

test('a ball thrown at the pocket knocks most pins down, one in the gutter none, and bumpers keep a wild ball on the lane', () => {
	const pocket = roll(logic.makePins(), { u: 0.05, angle: -0.1 });
	assert.ok(pocket.down >= 7, `${pocket.down} pins`);
	const gutterBall = roll(logic.makePins(), { u: 0.3, angle: 3 });
	assert.ok(gutterBall.gutter && gutterBall.down === 0, 'a ball that leaves the lane stays in the gutter');
	assert.ok(Math.abs(gutterBall.ball.u) > logic.BED_HALF);
	const wild = roll(logic.makePins(), { u: 0.3, angle: 3, bumpers: true });
	assert.ok(!wild.gutter && wild.down > 0, 'with bumpers it stays on and hits something');
});

test('the pins are a game, not a coin: skilled throws strike sometimes, careless ones less, and the rest leave pins standing', () => {
	const random = seeded(11);
	const normal = () => { let u = 0, v = 0; while (!u) u = random(); v = random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
	const trial = (aimError, n) => {
		const hist = Array(11).fill(0);
		for (let i = 0; i < n; i++) {
			const u = normal() * 0.1;
			const angle = (Math.atan2(0.05 - u, 18.29) * 180) / Math.PI + normal() * aimError;
			hist[roll(logic.makePins(), { u, angle, speed: Math.max(4.5, 7.5 + normal() * 0.8) }).down]++;
		}
		const total = hist.reduce((sum, count, down) => sum + count * down, 0);
		return { strikes: hist[10] / n, average: total / n };
	};
	const good = trial(0.25, 120);
	const careless = trial(0.9, 120);
	assert.ok(good.strikes > 0.1 && good.strikes < 0.6, `strikes ${good.strikes}`);
	assert.ok(good.average > careless.average, 'a better aim knocks more down');
	assert.ok(good.average > 7 && good.average < 9.7, `average ${good.average}`);
	assert.ok(careless.average > 4, 'a careless ball still hits pins');
});

test('a fallen pin is turned over about the right axis, and a standing one is not turned at all', () => {
	const pins = logic.makePins();
	const head = pins[0];
	assert.deepEqual(logic.pinPose(head).rotation, [0, 0, 0, 1]);
	// Knocked straight down the lane: its top should lean towards +Z, which turning about the X axis does.
	head.state = 'down'; head.tilt = Math.PI / 2; head.du = 0; head.dw = 1;
	const q = logic.pinPose(head).rotation;
	const turned = rotate(q, [0, 1, 0]);
	assert.ok(turned[2] > 0.99 && Math.abs(turned[1]) < 1e-9, `the pin's top points along the lane: ${turned}`);
	head.du = 1; head.dw = 0;
	const sideways = rotate(logic.pinPose(head).rotation, [0, 1, 0]);
	assert.ok(sideways[0] > 0.99);
});

function rotate(q, v) {
	const [x, y, z, w] = q;
	const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
	return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
}

test('a throw is helped towards the head pin as much as the aim help says, and a slow or sideways one still rolls down the lane', () => {
	const from = { u: 0.1, w: 0, y: 0.3 };
	const off = { vu: 2.5, vw: 7, vy: 0 };
	const [easy, normal, pro] = logic.ASSIST_LEVELS.map((level) => logic.launchBall(from, off, level.value));
	const heading = (b) => Math.abs(Math.atan2(b.vu, b.vw));
	assert.ok(heading(easy) < heading(normal) && heading(normal) < heading(pro));
	assert.ok(heading(easy) < 0.02, 'with the most help it goes at the pins');
	const soft = logic.launchBall(from, { vu: 0, vw: 0.5, vy: 0 }, 0.8);
	assert.ok(Math.hypot(soft.vu, soft.vw) >= 4.19, 'a gentle push still arrives');
	const backwards = logic.launchBall(from, { vu: 0, vw: -3, vy: 0 }, 0.8);
	assert.ok(backwards.vw > 0, 'it is not thrown away from the pins');
	const fast = logic.launchBall(from, { vu: 0, vw: 30, vy: 0 }, 0.8);
	assert.ok(fast.vw <= 9.5, 'a throw is capped');
});

// ---------------------------------------------------------------- the world running

function startWorld(options = {}) {
	const world = createTestWorld(tree);
	// Alice stands on her approach, with the balls within reach.
	world.addPlayer({ id: 'p1', name: 'Alice', head: [BOWLING.laneX[1], 1.6, 1.5] });
	if (options.second) world.addPlayer({ id: 'p2', name: 'Bob', head: [BOWLING.laneX[1] + 3, 1.6, 1.5] });
	const run = world.run(DIRECTOR_ID);
	world.tick(0.3);
	return { world, run, state: run.handlers.state };
}

/** Somebody swings a ball and lets go: the ball is held, moved along a path by the hand, and released. */
function throwBall(world, ballId, { from, speed = 7, angle = 0, by = 'p1', frames = 16 }) {
	const a = (angle * Math.PI) / 180;
	world.grabbers.set(ballId, [`${by}:right`]);
	let pos = [...from];
	world.setPosition(ballId, pos);
	world.tick(1 / 60, 1 / 60);
	for (let i = 0; i < frames; i++) {
		pos = [pos[0] + (Math.sin(a) * speed) / 60, pos[1], pos[2] + (Math.cos(a) * speed) / 60];
		world.setPosition(ballId, pos);
		world.tick(1 / 60, 1 / 60);
	}
	world.grabbers.delete(ballId);
	world.tick(1 / 60, 1 / 60);
}

const laneOne = laneIds(1);
const handAt = (lane, z = 1.2) => [BOWLING.laneX[lane], 1.0, z];

test('a ball thrown down a lane rolls to the pins, knocks some over, and comes back to its return', () => {
	const { world, state } = startWorld();
	const L = state.lanes[1];
	const ball = state.balls.find((b) => b.id === laneOne.ball(0));
	throwBall(world, ball.id, { from: handAt(1) });
	assert.equal(L.phase, 'ready', 'the roll starts at the foul line');
	world.tick(0.8);
	assert.equal(L.phase, 'rolling');
	assert.equal(L.game.players[0].name, 'Alice', 'a throw starts a game for whoever threw');
	const rolled = [];
	for (let i = 0; i < 12; i++) { world.tick(0.5); rolled.push(L.phase); }
	assert.ok(rolled.includes('settling') && rolled.includes('sweeping'), rolled.join());
	assert.equal(L.phase, 'ready');
	assert.deepEqual(L.game.players[0].rolls.length, 1);
	assert.ok(L.game.players[0].rolls[0] >= 1, 'it hit something');
	assert.equal(ball.phase, 'home');
	assert.deepEqual(world.slot(ball.id).position, ballHome(1, 0), 'the ball is back on its return');
	const board = world.component(laneOne.board, 'scoreboard');
	assert.equal(board.rows[0].name, 'Alice');
	assert.equal(board.rows[0].cells[0], String(L.game.players[0].rolls[0]));
	assert.match(world.component(laneOne.status, 'uiElement').text, /Alice is up/);
	assert.ok(world.spawned.some((s) => find(s, 'impactSound')), 'there was noise');
});

test('what fell stays down for the second ball and the standing pins stay put until the turn is over', () => {
	const { world, state } = startWorld();
	const L = state.lanes[1];
	const ball = state.balls.find((b) => b.id === laneOne.ball(0));
	throwBall(world, ball.id, { from: handAt(1), angle: -0.05 });
	world.tick(9);
	const first = L.game.players[0].rolls[0];
	if (first === 10) return; // A strike ends the turn: nothing to keep.
	const standing = L.pins.filter((p) => p.state === 'up');
	assert.equal(standing.length, 10 - first);
	const hidden = L.pins.filter((p) => p.state === 'gone').length;
	assert.equal(hidden, first, 'the fallen pins were swept away');
	for (const pin of L.pins) assert.equal(world.slot(laneOne.pin(pin.n)).disabled === true, pin.state === 'gone');
	throwBall(world, ball.id, { from: handAt(1) });
	world.tick(9);
	assert.equal(L.game.players[0].rolls.length, 2);
	assert.ok(L.pins.every((p) => p.state === 'up') && L.pins.length === 10, 'a new rack for the next frame');
	for (const pin of L.pins) assert.ok(!world.slot(laneOne.pin(pin.n)).disabled, 'every pin is back');
});

test('with two players on a lane the turn passes after the second ball, to the other, at a full rack', () => {
	const { world, run, state } = startWorld({ second: true });
	const L = state.lanes[1];
	world.press(run, laneOne.join);
	world.player('p1').head = [BOWLING.laneX[1] + 6, 1.6, 0];
	world.player('p2').head = [BOWLING.laneX[1], 1.6, BOWLING.deskZ - 0.6];
	world.press(run, laneOne.join);
	assert.deepEqual(L.game.players.map((p) => p.name), ['Alice', 'Bob']);
	assert.match(world.component(laneOne.status, 'uiElement').text, /Bob joined/);
	world.player('p1').head = [BOWLING.laneX[1], 1.6, 1.5];
	world.player('p2').head = [BOWLING.laneX[1] + 6, 1.6, 0];
	const ball = state.balls.find((b) => b.id === laneOne.ball(0));
	let throws = 0;
	while (logic.currentPlayer(L.game).name === 'Alice' && throws < 3) {
		throwBall(world, ball.id, { from: handAt(1), by: 'p1' });
		world.tick(9);
		throws++;
	}
	assert.ok(throws <= 2, 'Alice has at most two balls in a frame');
	assert.equal(logic.currentPlayer(L.game).name, 'Bob');
	assert.ok(L.pins.every((p) => p.state === 'up'), 'Bob starts at a full rack');
	assert.match(world.component(laneOne.status, 'uiElement').text, /Bob is up/);
	const rows = world.component(laneOne.board, 'scoreboard').rows;
	assert.equal(rows.length, 4, 'two rows a player');
	assert.ok(rows[2].name === 'Bob' && rows[2].highlight && !rows[0].highlight);
});

test('a lane takes four players and says so when it is full', () => {
	const { world, run, state } = startWorld();
	const L = state.lanes[1];
	for (let i = 0; i < 5; i++) {
		world.addPlayer({ id: `q${i}`, name: `Q${i}`, head: [BOWLING.laneX[1], 1.6, BOWLING.deskZ - 0.6] });
		for (const other of world.players.values()) if (other.id !== `q${i}`) other.head = [30, 1.6, 30];
		world.press(run, laneOne.join);
	}
	assert.equal(L.game.players.length, BOWLING.maxPlayers);
	assert.match(world.component(laneOne.status, 'uiElement').text, /full/);
});

test('leaving takes you off the card, and a lane with nobody left goes back to waiting', () => {
	const { world, run, state } = startWorld();
	const L = state.lanes[1];
	world.press(run, laneOne.join);
	assert.equal(L.game.players.length, 1);
	world.press(run, laneOne.leave);
	assert.equal(L.game, null);
	assert.match(world.component(laneOne.status, 'uiElement').text, /Press JOIN/);
});

test('bumpers come up in the gutters and make a gutter ball a normal one', () => {
	const { world, run, state } = startWorld();
	const L = state.lanes[1];
	world.press(run, laneOne.bumpers);
	assert.ok(L.bumpers);
	assert.ok(!world.slot(laneOne.bumperRail(0)).disabled && !world.slot(laneOne.bumperRail(1)).disabled, 'the rails are shown');
	assert.equal(world.component(laneOne.bumpers, 'uiElement').text, 'Bumpers: ON');
	world.press(run, laneOne.assist);
	assert.equal(world.component(laneOne.assist, 'uiElement').text, 'Aim help: Pro');
	const ball = state.balls.find((b) => b.id === laneOne.ball(0));
	// Pro help, thrown wide: without bumpers this would be a gutter ball.
	throwBall(world, ball.id, { from: handAt(1), angle: 7 });
	world.tick(10);
	assert.ok(L.game.players[0].rolls[0] > 0, `knocked ${L.game.players[0].rolls[0]}`);
	world.press(run, laneOne.bumpers);
	assert.ok(world.slot(laneOne.bumperRail(0)).disabled && world.slot(laneOne.bumperRail(1)).disabled);
});

test('a ball put back on a return goes home, and one dropped on the floor goes home after a while', () => {
	const { world, state } = startWorld();
	const ball = state.balls.find((b) => b.id === laneOne.ball(1));
	throwBall(world, ball.id, { from: [-3.2, 1.0, 2.5], speed: 0, frames: 4 });
	assert.equal(ball.phase, 'home', 'it was let go over the return');
	throwBall(world, ball.id, { from: [-8, 1.2, -3], speed: 0, frames: 4 });
	assert.equal(ball.phase, 'free');
	world.tick(1);
	assert.ok(ball.pos[1] < 0.2, 'it fell to the floor');
	world.tick(10);
	assert.equal(ball.phase, 'home');
});

test('a game is played to the end: ten frames, a winner, and the next throw starts a new game', () => {
	const { world, state } = startWorld();
	const L = state.lanes[1];
	const ball = state.balls.find((b) => b.id === laneOne.ball(0));
	let throws = 0;
	while (!L.game?.over && throws < 40) {
		throwBall(world, ball.id, { from: handAt(1), angle: throws % 3 === 0 ? 0.1 : 0 });
		world.tick(9);
		throws++;
	}
	assert.ok(L.game.over, `over after ${throws} throws`);
	const player = L.game.players[0];
	assert.ok(player.rolls.length >= 11 && player.rolls.length <= 21);
	assert.equal(logic.scoreGame(player.rolls).complete, true);
	assert.match(world.component(laneOne.status, 'uiElement').text, /Game over! Alice wins with \d+/);
	assert.ok(world.component(laneOne.monitor, 'textDisplay').title.includes('WINS'));
	throwBall(world, ball.id, { from: handAt(1) });
	world.tick(1);
	assert.equal(L.game.over, false);
	assert.equal(L.game.players[0].rolls.length, 0, 'a new game, same players');
});

test('only the host changes the world: on a guest nothing happens', () => {
	const world = createTestWorld(tree, { isHost: false });
	world.addPlayer({ id: 'p1', name: 'Alice', head: [BOWLING.laneX[1], 1.6, 0] });
	const run = world.run(DIRECTOR_ID);
	assert.doesNotThrow(() => world.tick(2));
	assert.equal(world.writes.length, 0);
	assert.equal(world.spawned.length, 0);
	void run;
});

test('the jukebox plays, can be switched off and changes tune', () => {
	const world = createTestWorld(tree);
	const run = world.run(JUKEBOX_ID);
	world.tick(6);
	const played = world.spawned.filter((s) => find(s, 'impactSound'));
	assert.ok(played.length > 5, `${played.length} notes in six seconds`);
	assert.ok(played.every((s) => find(s, 'impactSound').volume <= 0.2), 'it is background music');
	world.press(run, 'bw-juke-toggle');
	assert.equal(world.component('bw-juke-toggle', 'uiElement').text, 'Music: OFF');
	const count = world.spawned.length;
	world.tick(4);
	assert.equal(world.spawned.length, count, 'silent when off');
	world.press(run, 'bw-juke-toggle');
	world.press(run, 'bw-juke-next');
	assert.equal(world.component('bw-juke-next', 'uiElement').text, 'Neon');
	world.tick(3);
	assert.ok(world.spawned.length > count);
});

test('a ball only set down at the foul line is rolled down the lane (a desktop player has no swing)', () => {
	const { world, state } = startWorld();
	const L = state.lanes[1];
	const ball = state.balls.find((b) => b.id === laneOne.ball(0));
	throwBall(world, ball.id, { from: [BOWLING.laneX[1], 0.9, BOWLING.foulZ - 0.3], speed: 0, frames: 3 });
	world.tick(1);
	assert.equal(L.phase, 'rolling');
	assert.ok(ball.vel[2] >= 4, `it rolls at ${ball.vel[2].toFixed(1)} m/s`);
	world.tick(10);
	assert.ok(L.game.players[0].rolls[0] >= 0 && L.game.players[0].rolls.length === 1);
});

test('what cannot wait for a roll is held back: new game and leaving wait until the ball is done', () => {
	const { world, run, state } = startWorld();
	const L = state.lanes[1];
	world.press(run, laneOne.join);
	const ball = state.balls.find((b) => b.id === laneOne.ball(0));
	throwBall(world, ball.id, { from: handAt(1) });
	world.tick(1);
	assert.equal(L.phase, 'rolling');
	world.press(run, laneOne.newGame);
	assert.equal(L.phase, 'rolling', 'it was not restarted under the ball');
	assert.match(world.component(laneOne.status, 'uiElement').text, /Wait for the ball/);
	world.press(run, laneOne.leave);
	assert.equal(L.game.players.length, 1, 'still on the card until the roll is counted');
	world.tick(10);
	assert.equal(L.game, null, 'gone when it was over');
	assert.ok(L.pins.every((p) => p.state === 'up'));
});

test('a roll that is not counted does not leak into the next game: pins and game agree after every roll', () => {
	const { world, state } = startWorld();
	const L = state.lanes[1];
	const ball = state.balls.find((b) => b.id === laneOne.ball(0));
	for (let i = 0; i < 6; i++) {
		throwBall(world, ball.id, { from: handAt(1), angle: i % 2 ? 0.2 : -0.1 });
		world.tick(9);
		const rolls = L.game.players[0].rolls;
		// What the pins show is what the card says: the pins standing now are the rack minus what has fallen this frame.
		const next = logic.nextRoll(rolls);
		assert.equal(L.pins.filter((p) => p.state === 'up').length, next.standing, `after ${rolls.join(',')}`);
		for (const pin of L.pins) assert.equal(world.slot(laneOne.pin(pin.n)).disabled === true, pin.state === 'gone');
	}
});

test('after a strike the neon of the lane chases through colours, then goes back to its own', () => {
	const { world, state } = startWorld();
	const L = state.lanes[1];
	const color = (id) => world.component(id, 'meshRenderer').color;
	const own = [color('bw-l1-glow-0'), color('bw-l1-glow-1'), color('bw-l1-unit-neon')];
	L.flashUntil = 1e9;
	world.tick(0.5);
	assert.notDeepEqual([color('bw-l1-glow-0'), color('bw-l1-glow-1'), color('bw-l1-unit-neon')], own, 'the colours moved');
	const seen = new Set();
	for (let i = 0; i < 6; i++) { world.tick(0.2); seen.add(color('bw-l1-glow-0')); }
	assert.ok(seen.size >= 3, 'a chase, not one colour');
	L.flashUntil = 0;
	world.tick(0.3);
	assert.deepEqual([color('bw-l1-glow-0'), color('bw-l1-glow-1'), color('bw-l1-unit-neon')], own);
});
