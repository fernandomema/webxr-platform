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
const { BOWLING, LANE_COUNT, BALLS_PER_LANE, ballHome, laneIds, DIRECTOR_ID, JUKEBOX_AT, JUKEBOX_LOADER_ID } = await import('./bowlingLayout.ts');
const { buildJukebox, JUKEBOX_SLOTS, jukeboxSlotId, jukeboxSlotAt } = await import('../../src/lib/content/templates/jukebox.ts');
const { instantiateExternal } = await import('../../packages/engine/src/inventory/external.ts');
const { ASSETS } = await import('./assets.ts');

const logic = loadBowlingLogic();
const tree = pack.build();
const byId = new Map(tree.map((slot) => [slot.id, slot]));

// The jukebox is not in the scene: a loader builds it from the starter kit. Here the loader's work is done by hand, the way the engine does it (ids
// `<loader>::<id>`, the roots put where the loader is), so that its script runs in the world as it would.
const jukeLoader = tree.find((slot) => slot.id === JUKEBOX_LOADER_ID);
const jukeboxTree = () => instantiateExternal(JUKEBOX_LOADER_ID, buildJukebox(), null, { position: jukeLoader.position, rotation: jukeLoader.rotation });
const J = (id) => `${JUKEBOX_LOADER_ID}::${id}`;
const JUKEBOX_PANEL = J('jukebox-panel');
const treeWithJukebox = [...tree, ...jukeboxTree()];
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
	assert.doesNotThrow(() => new Function('ctx', find(byId.get(DIRECTOR_ID), 'codeBlock').code));
	assert.doesNotThrow(() => new Function('ctx', find(treeWithJukebox.find((slot) => slot.id === JUKEBOX_PANEL), 'codeBlock').code));
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

test('a ball thrown out of turn goes on the thrower\'s own card and the turn passes to them', () => {
	const { world, run, state } = startWorld({ second: true });
	const L = state.lanes[1];
	world.press(run, laneOne.join);
	world.player('p1').head = [BOWLING.laneX[1] + 6, 1.6, 0];
	world.player('p2').head = [BOWLING.laneX[1], 1.6, BOWLING.deskZ - 0.6];
	world.press(run, laneOne.join);
	assert.deepEqual(L.game.players.map((p) => p.name), ['Alice', 'Bob']);
	assert.equal(logic.currentPlayer(L.game).name, 'Alice', 'it is Alice\'s turn');
	// Bob throws anyway.
	world.player('p1').head = [BOWLING.laneX[1] + 6, 1.6, 0];
	world.player('p2').head = [BOWLING.laneX[1], 1.6, 1.5];
	const ball = state.balls.find((b) => b.id === laneOne.ball(0));
	throwBall(world, ball.id, { from: handAt(1), by: 'p2' });
	world.tick(9);
	assert.equal(L.game.players[1].rolls.length, 1, 'the ball is Bob\'s');
	assert.equal(L.game.players[0].rolls.length, 0, 'and Alice\'s card is untouched');
	assert.deepEqual(L.game.players.map((p) => p.name), ['Alice', 'Bob'], 'nobody joined twice');
});

test('the scoreboard draws a player as one block of two rows: the name once, then marks over totals', () => {
	const { world, run, state } = startWorld();
	world.press(run, laneOne.join);
	const rows = world.component(laneOne.board, 'scoreboard').rows;
	assert.equal(rows.length, 2);
	assert.equal(rows[0].rowSpan, 2, 'the name covers both rows');
	assert.equal(rows[1].name, '');
	void state;
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
	assert.ok(byId.get(laneIds(1).bumperRail(0)).disabled && byId.get(laneIds(1).bumperRail(1)).disabled, 'they start down');
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
	const world = createTestWorld(treeWithJukebox);
	const run = world.run(JUKEBOX_PANEL);
	world.tick(6);
	const played = world.spawned.filter((s) => find(s, 'impactSound'));
	assert.ok(played.length > 5, `${played.length} notes in six seconds`);
	assert.ok(played.every((s) => find(s, 'impactSound').volume <= 0.2), 'it is background music');
	world.press(run, J('jukebox-toggle'));
	assert.equal(world.component(J('jukebox-toggle'), 'uiElement').text, 'Ambient: OFF');
	const count = world.spawned.length;
	world.tick(4);
	assert.equal(world.spawned.length, count, 'silent when off');
	world.press(run, J('jukebox-toggle'));
	world.press(run, J('jukebox-next'));
	world.tick(0.1);
	assert.equal(world.component(J('jukebox-next'), 'uiElement').text, 'Neon');
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

test('the sky carries a reflection probe made of the pack\'s own pictures, so glossy things reflect the same in the Studio and in play', () => {
	const sky = find(byId.get('bw-sky'), 'skybox');
	const known = new Set(Object.values(ASSETS));
	for (const face of ['Px', 'Nx', 'Py', 'Ny', 'Pz', 'Nz']) {
		assert.equal(sky[`reflection${face}`].kind, 'asset');
		assert.ok(known.has(sky[`reflection${face}`].assetId), `${face} is in the pack`);
	}
	assert.ok(!sky.reflectionCapture, 'no capture of the half-loaded scene');
});

// ---------------------------------------------------------------- the ball machine

const machine = await import('./bowlingMachine.ts');
const { MACHINE, CUSTOM_BALL_COUNT, customBallId, customBallHome } = await import('./bowlingLayout.ts');

test('the machine has a panel with a button for every material, a finish button, a make button, and balls waiting hidden', () => {
	assert.equal(machine.BALL_MATERIALS.length, 12);
	for (let i = 0; i < machine.BALL_MATERIALS.length; i++) {
		assert.equal(find(byId.get(machine.materialButtonId(i)), 'uiElement').kind, 'button');
		assert.ok(ASSETS[`balls/${machine.BALL_MATERIALS[i].id}.webp`], `${machine.BALL_MATERIALS[i].name} has its picture`);
	}
	for (const id of Object.values(machine.MACHINE_BUTTONS)) assert.ok(byId.has(id), id);
	assert.ok(find(byId.get(MACHINE.panelId), 'codeBlock') && find(byId.get(MACHINE.panelId), 'uiPanel'));
	assert.equal(CUSTOM_BALL_COUNT, 3);
	for (let k = 0; k < CUSTOM_BALL_COUNT; k++) {
		const ball = byId.get(customBallId(k));
		assert.ok(ball.disabled, 'hidden until it is made');
		assert.ok(find(ball, 'grabbable') && find(ball, 'collider') && find(ball, 'material'));
		assert.deepEqual(ball.position, customBallHome(k));
		assert.equal(tree.filter((slot) => slot.parentId === ball.id && /hole-\d$/.test(slot.id)).length, 3, 'three finger holes');
	}
	const tray = byId.get('bw-mach-tray');
	assert.ok(Math.abs(tray.position[1] + tray.scale[1] / 2 + 0.108 - customBallHome(0)[1]) < 0.01, 'the balls rest on the tray');
	for (let k = 1; k < CUSTOM_BALL_COUNT; k++) assert.ok(customBallHome(k)[2] - customBallHome(k - 1)[2] > 0.22, 'balls do not overlap');
});

test('the machine stands clear of the jukebox and the hall of fame, and inside the hall', () => {
	const boxes = tree.filter((slot) => slot.id.startsWith('bw-mach-') && find(slot, 'collider'));
	const extent = (slot) => ({ x: [slot.position[0] - slot.scale[0] / 2, slot.position[0] + slot.scale[0] / 2], z: [slot.position[2] - slot.scale[2] / 2, slot.position[2] + slot.scale[2] / 2] });
	const juke = { x: [JUKEBOX_AT.x - 0.35, JUKEBOX_AT.x + 0.35], z: [JUKEBOX_AT.z - 0.55, JUKEBOX_AT.z + 0.55] };
	for (const slot of boxes) {
		const e = extent(slot);
		assert.ok(e.x[1] <= 10 && e.x[0] >= 8, `${slot.id} is by the east wall`);
		assert.ok(e.z[1] <= juke.z[0] || e.x[1] <= juke.x[0] || e.z[0] >= juke.z[1], `${slot.id} does not touch the jukebox`);
	}
});

const near = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-3);

function startMachine() {
	const world = createTestWorld(tree);
	world.addPlayer({ id: 'p1', name: 'Alice', head: [8, 1.6, -3] });
	const run = world.run(MACHINE.panelId);
	world.tick(0.2);
	return { world, run };
}

test('picking a material and a finish shows it on the ball in the window, and the ball in the window turns', () => {
	const { world, run } = startMachine();
	assert.equal(world.component(machine.MACHINE_BUTTONS.name, 'uiElement').text, 'Midnight · Glossy');
	world.press(run, machine.materialButtonId(6));
	const preview = world.component(MACHINE.previewId, 'material');
	assert.equal(preview.albedo.assetId, ASSETS['balls/gold.webp']);
	assert.equal(preview.metallic, 1, 'gold comes metallic');
	assert.equal(world.component(machine.MACHINE_BUTTONS.finish, 'uiElement').text, 'Finish: Metallic');
	assert.match(world.component(machine.materialButtonId(6), 'uiElement').text, /^● Gold/);
	assert.equal(world.component(machine.materialButtonId(0), 'uiElement').text, 'Midnight');
	world.press(run, machine.MACHINE_BUTTONS.finish);
	assert.equal(world.component(MACHINE.previewId, 'material').metallic, 0);
	assert.equal(world.component(MACHINE.previewId, 'material').roughness, machine.BALL_FINISHES[0].roughness);
	const before = [...world.slot(MACHINE.previewId).rotation];
	world.tick(1);
	assert.notDeepEqual(world.slot(MACHINE.previewId).rotation, before, 'it turns');
});

test('making a ball puts one of the machine\'s balls on the tray with the picked material, and it takes turns', () => {
	const { world, run } = startMachine();
	world.press(run, machine.materialButtonId(1));
	world.press(run, machine.MACHINE_BUTTONS.make);
	const first = byId.get(customBallId(0)).id;
	assert.ok(!world.slot(first).disabled, 'it is out');
	assert.equal(world.component(first, 'material').albedo.assetId, ASSETS['balls/lava.webp']);
	assert.ok(near(world.position(first), customBallHome(0)));
	assert.match(world.component(machine.MACHINE_BUTTONS.name, 'uiElement').text, /Lava ball is on the tray/);
	world.press(run, machine.materialButtonId(4));
	world.press(run, machine.MACHINE_BUTTONS.make);
	assert.equal(world.component(customBallId(1), 'material').albedo.assetId, ASSETS['balls/candy.webp']);
	assert.equal(world.component(customBallId(0), 'material').albedo.assetId, ASSETS['balls/lava.webp'], 'the first keeps its look');
	// All three out and one in a hand: the machine does not take it away.
	world.press(run, machine.MACHINE_BUTTONS.make);
	world.grabbers.set(customBallId(0), ['p1:right']);
	world.grabbers.set(customBallId(1), ['p1:left']);
	world.setPosition(customBallId(2), [5, 1, 5]);
	world.press(run, machine.MACHINE_BUTTONS.make);
	assert.match(world.component(machine.MACHINE_BUTTONS.name, 'uiElement').text, /All the balls are out/);
	// Once they are back on the tray (nobody holds them) the next one in turn is remade.
	world.grabbers.clear();
	world.setPosition(customBallId(2), customBallHome(2));
	world.press(run, machine.materialButtonId(9));
	world.press(run, machine.MACHINE_BUTTONS.make);
	assert.equal(world.component(customBallId(0), 'material').albedo.assetId, ASSETS['balls/pearl.webp']);
});

test('a ball from the machine comes back from a lane to that lane\'s return, in the place of one of its own balls, which is put away', () => {
	const world = createTestWorld(tree);
	world.addPlayer({ id: 'p1', name: 'Alice', head: [BOWLING.laneX[1], 1.6, 1.5] });
	const director = world.run(DIRECTOR_ID);
	const panel = world.run(MACHINE.panelId);
	world.tick(0.3);
	world.press(panel, machine.MACHINE_BUTTONS.make);
	const id = customBallId(0);
	const lane = director.handlers.state.lanes[1];
	throwBall(world, id, { from: handAt(1) });
	world.tick(1);
	assert.equal(lane.phase, 'rolling');
	world.tick(10);
	assert.ok(lane.game.players[0].rolls.length === 1);
	assert.ok(near(world.position(id), ballHome(1, 0)), 'it is on lane 2\'s return');
	assert.ok(!world.slot(id).disabled);
	assert.ok(world.slot(laneIds(1).ball(0)).disabled, 'the own ball it replaced is put away');
	assert.ok(world.position(laneIds(1).ball(0))[1] < -10, 'and nowhere near the return: nothing of it is left under the machine\'s ball');
	assert.ok(!world.slot(laneIds(1).ball(1)).disabled, 'the lane\'s other ball stays');
	for (const other of [0, 2, 3]) for (let k = 0; k < 2; k++) assert.ok(!world.slot(laneIds(other).ball(k)).disabled, 'other lanes are untouched');
	// Taken off the return, the own ball is there again; bowled on another lane, that lane's return takes it.
	throwBall(world, id, { from: handAt(3), by: 'p1' });
	assert.ok(!world.slot(laneIds(1).ball(0)).disabled, 'the own ball is back as soon as the other leaves');
	assert.ok(near(world.position(laneIds(1).ball(0)), ballHome(1, 0)), 'in its place');
	world.player('p1').head = [BOWLING.laneX[3], 1.6, 1.5];
	world.tick(12);
	assert.ok(near(world.position(id), ballHome(3, 0)), 'now on lane 4\'s return');
	assert.ok(world.slot(laneIds(3).ball(0)).disabled && !world.slot(laneIds(1).ball(0)).disabled);
});

test('a ball from the machine put on a return stays there, and the machine can remake it, which gives the own ball back', () => {
	const { world, run } = startMachine();
	const director = world.run(DIRECTOR_ID);
	world.press(run, machine.MACHINE_BUTTONS.make);
	const id = customBallId(0);
	// Carried over to the first return and set down on it.
	throwBall(world, id, { from: [-3.2, 1.0, 2.5], speed: 0, frames: 4 });
	world.tick(1);
	assert.ok(near(world.position(id), ballHome(0, 0)), 'it took the place of lane 1\'s first ball');
	assert.ok(world.slot(laneIds(0).ball(0)).disabled);
	// The machine makes balls until it comes round to this one, which nobody holds.
	world.press(run, machine.materialButtonId(3));
	world.press(run, machine.MACHINE_BUTTONS.make);
	world.press(run, machine.MACHINE_BUTTONS.make);
	world.press(run, machine.MACHINE_BUTTONS.make);
	world.tick(1);
	assert.equal(world.component(id, 'material').albedo.assetId, ASSETS['balls/galaxy.webp'], 'remade');
	assert.ok(near(world.position(id), customBallHome(0)), 'back on the tray');
	assert.ok(!world.slot(laneIds(0).ball(0)).disabled, 'the own ball came back');
	void director;
});

// ---------------------------------------------------------------- the logo

test('the Kithin logo hangs once on each side wall as loaders of the app\'s own starter object, facing the room', () => {
	const loaders = tree.filter((slot) => find(slot, 'loader')?.id === 'kithin-logo');
	assert.equal(loaders.length, 2, 'one on each side');
	for (const slot of loaders) {
		const loader = find(slot, 'loader');
		assert.deepEqual([loader.adapter, loader.id], ['builtin', 'kithin-logo']);
		const west = slot.position[0] < 0;
		assert.ok(Math.abs(Math.abs(slot.position[0]) - 10) < 1e-9, 'on the wall');
		const forward = rotate(slot.rotation, [0, 0, 1]);
		assert.ok(west ? forward[0] < -0.99 : forward[0] > 0.99, 'its +Z points into the wall, so it is read from the room');
		assert.ok(slot.position[2] > BOWLING.foulZ && slot.position[1] > 2 && slot.position[1] < 3.2);
	}
	assert.ok(tree.length < 520, 'the logo is not copied into the scene');
});

test('the logo is a starter object of its own: only the mark, in relief, scenery (not grabbable), made of shapes alone', async () => {
	const { BUILTIN_ENTRIES } = await import('../../src/lib/content/starterKit/catalog.ts');
	const entry = BUILTIN_ENTRIES.find((candidate) => candidate.id === 'kithin-logo');
	assert.ok(entry && entry.grabbable === false);
	const logo = entry.build();
	assert.ok(!find(logo[0], 'grabbable'), 'it cannot be pulled off the wall');
	const ids = new Set(logo.map((slot) => slot.id));
	assert.equal(ids.size, logo.length);
	for (const slot of logo.slice(1)) {
		assert.ok(!find(slot, 'textDisplay') && !find(slot, 'collider'), 'no text and nothing solid');
		const mesh = find(slot, 'meshRenderer');
		assert.equal(mesh.meshRef.kind, 'builtin', 'no asset');
		assert.equal(mesh.meshRef.id, 'sphere', 'a dome');
		assert.ok(slot.scale[2] < slot.scale[0], 'flattened along the view');
		assert.equal(slot.parentId, logo[0].id);
	}
	const domes = logo.slice(1);
	assert.deepEqual(domes.map((slot) => slot.id), ['kithin-logo-disc-0', 'kithin-logo-disc-1', 'kithin-logo-disc-2', 'kithin-logo-rim', 'kithin-logo-hole']);
	assert.ok(domes[0].scale[0] >= 2.4, 'big: 2.4 m across');
	// Relief: every dome stands out further than the one under it and is smaller, so the front is stepped.
	for (let i = 1; i < domes.length; i++) {
		assert.ok(domes[i].scale[2] > domes[i - 1].scale[2], `${domes[i].id} stands out more`);
		assert.ok(domes[i].scale[0] < domes[i - 1].scale[0], `${domes[i].id} is smaller`);
	}
	assert.ok(domes.at(-1).scale[2] / 2 >= 0.4, 'a medallion some 40 cm deep');
});

test('the finger holes lie flush on the ball, one pair and a thumb, facing out, and nothing sticks out of it', () => {
	for (const ball of [customBallId(0), MACHINE.previewId]) {
		const parts = tree.filter((slot) => slot.parentId === ball && /hole-\d(-deep)?$/.test(slot.id));
		assert.equal(parts.length, 6, 'three holes of two discs');
		for (const slot of parts) {
			const radius = Math.hypot(...slot.position);
			assert.ok(radius > 0.5 && radius < 0.502, `${slot.id} is on the surface (${radius})`);
			assert.ok(slot.scale[1] <= 0.005, 'thin');
			const axis = rotate(slot.rotation, [0, 1, 0]);
			const out = slot.position.map((c) => c / radius);
			assert.ok(axis[0] * out[0] + axis[1] * out[1] + axis[2] * out[2] > 0.999, `${slot.id} faces out`);
		}
	}
});

// ---------------------------------------------------------------- the jukebox playlist

const { buildDisc } = await import('../../src/lib/content/templates/recordDisc.ts');

/** The sound of a record starts in a promise: let those run (the engine does, between frames). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function jukeboxWorld(discs = 3) {
	const records = Array.from({ length: discs }, (_, i) => buildDisc({ id: `disc-${i}`, title: `Song ${i}`, author: `Band ${i}`, labelColor: '#6366f1', source: { kind: 'url', url: `/song-${i}.mp3` } }));
	const world = createTestWorld([...treeWithJukebox, ...records.flat()]);
	const run = world.run(JUKEBOX_PANEL);
	const insert = (disc, socket) => { world.component(J(jukeboxSlotId(socket)), 'socket').occupantId = `disc-${disc}`; };
	// Takes a record out of whichever socket it is in now: the script moves the one that plays to the turntable.
	const remove = (disc) => { for (let i = 0; i < JUKEBOX_SLOTS; i++) { const socket = world.component(J(jukeboxSlotId(i)), 'socket'); if (socket.occupantId === `disc-${disc}`) delete socket.occupantId; } };
	const socketOf = (disc) => { for (let i = 0; i < JUKEBOX_SLOTS; i++) if (world.component(J(jukeboxSlotId(i)), 'socket').occupantId === `disc-${disc}`) return i; return -1; };
	const heard = () => world.audio.played.filter((p) => p.position && p.source.kind === 'url').map((p) => p.source.url);
	const finish = () => { for (const p of world.audio.played) if (p.source.kind === 'url' && !p.handle.ended) p.handle.ended = true; };
	return { world, run, insert, remove, socketOf, heard, finish };
}

test('the jukebox is not in this world: a loader builds it from the starter kit, turned so that its front faces the room', async () => {
	assert.ok(![...byId.keys()].some((id) => id.startsWith('bw-juke-')), 'no jukebox parts in the scene');
	const loader = find(jukeLoader, 'loader');
	assert.deepEqual([loader.adapter, loader.id], ['builtin', 'jukebox']);
	assert.deepEqual([jukeLoader.position[0], jukeLoader.position[2]], [JUKEBOX_AT.x, JUKEBOX_AT.z]);
	assert.equal(jukeLoader.position[1], 0, 'on the floor');
	const front = rotate(jukeLoader.rotation, [0, 0, -1]);
	assert.ok(front[0] < -0.99, `its front (local -Z) faces the room (-X): ${front}`);
	const { BUILTIN_ENTRIES } = await import('../../src/lib/content/starterKit/catalog.ts');
	const entry = BUILTIN_ENTRIES.find((candidate) => candidate.id === 'jukebox');
	assert.ok(entry && entry.folderId === 'music' && entry.grabbable === false, 'Starter Kit > Music, a fixture');
	assert.ok(tree.some((slot) => slot.id === 'bw-light-juke'), 'its lamp stays with the world (it is baked)');
});

test('the jukebox object has six places for records (five to wait in and the turntable), a tray to put them in by, and a panel with the script and the shared state', () => {
	const jukebox = buildJukebox();
	const ids = new Set(jukebox.map((slot) => slot.id));
	assert.equal(ids.size, jukebox.length);
	assert.equal(jukebox.filter((slot) => slot.parentId === null).length, 1);
	for (const slot of jukebox) if (slot.parentId) assert.ok(ids.has(slot.parentId));
	assert.equal(JUKEBOX_SLOTS, 6);
	for (let i = 0; i < JUKEBOX_SLOTS; i++) {
		const socket = jukebox.find((slot) => slot.id === jukeboxSlotId(i));
		assert.deepEqual(find(socket, 'socket').accepts, ['disc']);
		assert.equal(find(socket, 'socket').playMedia, false, 'the script plays it, in step for everyone');
		assert.deepEqual(socket.position, jukeboxSlotAt(i));
		assert.ok(Math.abs(socket.position[0]) <= 0.4, 'inside its width');
	}
	assert.ok(jukeboxSlotAt(0)[0] < jukeboxSlotAt(1)[0] && jukeboxSlotAt(1)[0] < jukeboxSlotAt(2)[0], 'left to right as seen from the front');
	assert.ok([0, 1, 2, 4, 5].every((i) => jukeboxSlotAt(3)[1] < jukeboxSlotAt(i)[1]), 'the turntable is the lowest place');
	const panel = jukebox.find((slot) => slot.id === 'jukebox-panel');
	assert.ok(find(panel, 'scriptState') && find(panel, 'codeBlock') && find(panel, 'uiPanel'));
	for (const id of ['jukebox-now', 'jukebox-toggle', 'jukebox-next', 'jukebox-add', 'jukebox-tray', 'jukebox-tray-socket']) assert.ok(ids.has(id), id);
	assert.equal(find(jukebox.find((slot) => slot.id === 'jukebox-tray-socket'), 'socket').radius < 0.01, true, 'closed, the tray reaches nothing');
	assert.ok(find(jukebox.find((slot) => slot.id === 'jukebox-model'), 'meshRenderer').meshRef.assetId, 'the cabinet is the bundled model');
	// Loaded under another id, the script still finds its parts.
	for (const slot of jukeboxTree()) assert.ok(slot.id.startsWith(`${JUKEBOX_LOADER_ID}::`));
});

test('records put in the slots are played one after the other, in order, and round again', async () => {
	const { world, run, insert, heard, finish } = jukeboxWorld(3);
	world.tick(1);
	assert.deepEqual(heard(), [], 'nothing to play but the ambient tune');
	assert.equal(world.component(J('jukebox-now'), 'uiElement').text.split('\n')[0], 'Add a record with the tray.');
	insert(2, 4); insert(0, 1);
	world.tick(0.5);
	await settle();
	assert.deepEqual(heard(), ['/song-0.mp3'], 'slot 2 comes before slot 5');
	const state = world.component(JUKEBOX_PANEL, 'scriptState').data;
	assert.ok(state.cur === 1 && state.discId === 'disc-0' && state.title === 'Song 0');
	assert.equal(world.component(J('jukebox-now'), 'uiElement').text, 'Song 0 - Band 0\nNext: Song 2 - Band 2');
	assert.equal(world.component(J('jukebox-next'), 'uiElement').text, 'Skip');
	const notes = world.spawned.length;
	world.tick(3);
	assert.equal(world.spawned.filter((s) => find(s, 'impactSound')).length, notes, 'the ambient tune is quiet while a record plays');
	finish(); world.tick(0.5); await settle();
	await settle();
	assert.deepEqual(heard(), ['/song-0.mp3', '/song-2.mp3']);
	finish(); world.tick(0.5); await settle();
	await settle();
	assert.deepEqual(heard(), ['/song-0.mp3', '/song-2.mp3', '/song-0.mp3'], 'and round again');
	void run;
});

test('skip moves on, taking out the record that plays moves on, and an empty jukebox goes back to its tune', async () => {
	const { world, run, insert, remove, heard } = jukeboxWorld(2);
	insert(0, 0); insert(1, 1);
	world.tick(0.5);
	world.press(run, J('jukebox-next'));
	world.tick(0.5);
	await settle();
	assert.deepEqual(heard(), ['/song-0.mp3', '/song-1.mp3'], 'skipped');
	remove(1);
	world.tick(0.5);
	await settle();
	assert.deepEqual(heard(), ['/song-0.mp3', '/song-1.mp3', '/song-0.mp3'], 'the one that was playing was taken out');
	remove(0);
	world.tick(0.5);
	assert.equal(world.component(JUKEBOX_PANEL, 'scriptState').data.cur, -1);
	const before = world.spawned.length;
	world.tick(4);
	assert.ok(world.spawned.length > before, 'the ambient tune is back');
	assert.equal(world.component(J('jukebox-next'), 'uiElement').text, 'Lounge');
});

test('a guest hears what the host decided, from where it is by then, and nothing else', async () => {
	const records = [buildDisc({ id: 'disc-0', title: 'Song 0', author: 'Band', labelColor: '#6366f1', source: { kind: 'url', url: '/song-0.mp3' } })].flat();
	const world = createTestWorld([...treeWithJukebox, ...records], { isHost: false });
	world.run(JUKEBOX_PANEL);
	world.component(J(jukeboxSlotId(0)), 'socket').occupantId = 'disc-0';
	world.tick(1);
	assert.equal(world.audio.played.length, 0, 'a guest decides nothing');
	// The host has written that the record started 12 seconds ago.
	world.component(JUKEBOX_PANEL, 'scriptState').data = { cur: 0, discId: 'disc-0', startedAt: Date.now() - 12000, key: '1:disc-0', title: 'Song 0', author: 'Band' };
	world.tick(0.5);
	await settle();
	assert.equal(world.audio.played.length, 1);
	const played = world.audio.played[0];
	assert.equal(played.source.url, '/song-0.mp3');
	assert.ok(played.options.offset > 11.5 && played.options.offset < 13, `it joins at ${played.options.offset}`);
	const panelAt = world.position(JUKEBOX_PANEL);
	assert.deepEqual(played.position.map((c) => +c.toFixed(3)), [panelAt[0], +(panelAt[1] + 0.7).toFixed(3), panelAt[2]].map((c) => +c.toFixed(3)), 'from the jukebox');
	world.tick(2);
	assert.equal(world.audio.played.length, 1, 'it does not start it again');
});

test('the record that plays is moved to the turntable and turns there, on its own axis, and goes back to its place when the next one starts', async () => {
	const { world, insert, remove, socketOf, finish } = jukeboxWorld(2);
	insert(0, 0); insert(1, 1);
	const seated = [0.5, 0.5, -0.5, 0.5];
	world.setPosition('disc-0', world.position(J(jukeboxSlotId(0))), seated);
	world.setPosition('disc-1', world.position(J(jukeboxSlotId(1))), seated);
	// A turn is the same turn with its quaternion negated.
	const sameTurn = (p, q) => Math.abs(p.reduce((sum, c, i) => sum + c * q[i], 0)) > 0.99999;
	const rotation = (id) => { const q = world.node(id).rotationQuaternion; return [q.x, q.y, q.z, q.w]; };
	const axis = (id) => rotate(rotation(id), [0, 1, 0]);
	world.tick(0.5);
	await settle();
	assert.equal(socketOf(0), 3, 'the record that plays is on the turntable');
	assert.equal(world.slot('disc-0').parentId, J(jukeboxSlotId(3)), 'and hangs from it');
	assert.equal(socketOf(1), 1, 'the one that waits stays in its place');
	assert.ok(sameTurn(rotation('disc-1'), seated), 'and does not turn');
	const turntable = world.position(J(jukeboxSlotId(3)));
	assert.ok(world.position('disc-0').every((c, i) => Math.abs(c - turntable[i]) < 1e-3), 'it is where the turntable is');
	const start = axis('disc-0');
	const a = rotation('disc-0');
	world.tick(0.3);
	const b = rotation('disc-0');
	assert.notDeepEqual(a, b, 'it turns');
	for (let i = 0; i < 3; i++) assert.ok(Math.abs(axis('disc-0')[i] - start[i]) < 1e-4, 'about its own axis: the face keeps pointing the same way');
	assert.ok(world.flushes > 0, 'the guests are sent the turn');
	// Next record: the first goes back to its place, the second goes to the turntable.
	finish(); world.tick(0.5); await settle();
	assert.equal(socketOf(0), 0, 'the one that stopped is back in its place');
	assert.equal(socketOf(1), 3, 'the next one is on the turntable');
	assert.equal(world.slot('disc-0').parentId, J(jukeboxSlotId(0)));
	remove(1); world.tick(0.5); await settle();
	const left = rotation('disc-1');
	world.tick(0.3);
	assert.deepEqual(rotation('disc-1'), left, 'taken out of the turntable, it does not turn any more');
});

test('the tray slides out when asked, takes a record let go on it, closes and the record is seated in a free place', async () => {
	const { world, run, socketOf, insert } = jukeboxWorld(2);
	insert(1, 0); // a record that waits in the first place, and plays
	const tray = J('jukebox-tray');
	const closed = world.slot(tray).position.slice();
	assert.equal(world.component(J('jukebox-tray-socket'), 'socket').radius < 0.01, true);
	world.tick(0.1);
	world.press(run, J('jukebox-add'));
	world.tick(0.5);
	assert.equal(world.component(J('jukebox-add'), 'uiElement').text, 'Close tray');
	assert.equal(world.component(J('jukebox-now'), 'uiElement').text, 'Lay a record on the tray.');
	for (let i = 0; i < 40; i++) world.tick(0.05);
	const open = world.slot(tray).position;
	assert.ok(open[2] < closed[2] - 0.3, 'it is out of the cabinet (towards the front, -Z)');
	assert.ok(world.component(J('jukebox-tray-socket'), 'socket').radius > 0.1, 'and reaches a record now');
	// A record is let go on it.
	world.component(J('jukebox-tray-socket'), 'socket').occupantId = 'disc-0';
	world.setPosition('disc-0', world.position(J('jukebox-tray-socket')));
	for (let i = 0; i < 80; i++) world.tick(0.05);
	await settle();
	assert.deepEqual(world.slot(tray).position, closed, 'the tray is shut again');
	assert.equal(socketOf(0), 1, 'the record is in the first free place (the second: the first is taken)');
	assert.ok(!world.component(J('jukebox-tray-socket'), 'socket').occupantId, 'and the tray is empty');
});

test('a full jukebox does not open its tray', () => {
	const { world, run, insert } = jukeboxWorld(5);
	[0, 1, 2, 4, 5].forEach((socket, i) => insert(i, socket));
	world.tick(0.1);
	world.press(run, J('jukebox-add'));
	world.tick(0.2);
	assert.equal(world.component(J('jukebox-now'), 'uiElement').text, 'The jukebox is full.');
	assert.equal(world.component(J('jukebox-tray-socket'), 'socket').radius < 0.01, true);
});
