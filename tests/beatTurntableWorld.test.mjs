import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { BEAT_TURNTABLE, BEAT_TURNTABLE_SCRIPT, buildBeatTurntable } from '../src/lib/xr/templates/beatTurntable.ts';
import { loadLevelLogic } from '../src/lib/xr/templates/beatTurntableLogic.ts';
import { isBuiltinMeshId } from '../src/lib/assets/ref.ts';
import { eulerToQuat } from '../src/lib/math/euler.ts';
import { DECK, deckIds } from '../src/lib/xr/templates/beatTurntableDesk.ts';
import { STAGE, stageIds } from '../src/lib/xr/templates/beatTurntableStage.ts';
import { OPTION_BUTTONS } from '../src/lib/xr/templates/beatTurntableUi.ts';

const logic = loadLevelLogic();
const find = (slot, type) => slot.components.find((c) => c.type === type);
const tree = buildBeatTurntable();
const byId = new Map(tree.map((slot) => [slot.id, slot]));

/** A song with a hit every half second, kicks and hats alternating, and every few seconds a kick and a hat together. */
function fakeAnalysis(duration = 40) {
	const onsets = [];
	for (let t = 2.5, i = 0; t < duration - 1; t += 0.5, i++) {
		onsets.push({ t: Math.round(t * 1000) / 1000, strength: 0.9, band: i % 2 === 0 ? 'low' : 'high' });
		if (i % 6 === 5) onsets.push({ t: Math.round((t + 0.01) * 1000) / 1000, strength: 0.9, band: i % 2 === 0 ? 'high' : 'low' });
	}
	return { duration, bpm: 120, bpmConfidence: 0.8, onsets, energy: { hop: 0.0232, low: [], mid: [], high: [] } };
}

test('the world is a valid scene with unique ids, known parents and built-in meshes', () => {
	assert.ok(tree.length > 50 && tree.length < 600);
	assert.equal(byId.size, tree.length, 'ids are unique');
	for (const slot of tree) {
		assert.equal(slot.position.length, 3);
		assert.equal(slot.rotation.length, 4);
		assert.equal(slot.scale.length, 3);
		if (slot.parentId !== null) assert.ok(byId.has(slot.parentId), `${slot.id} has its parent`);
		const mesh = find(slot, 'meshRenderer');
		if (mesh) assert.ok(mesh.meshRef.kind === 'builtin' && isBuiltinMeshId(mesh.meshRef.id), `${slot.id} uses a built-in mesh`);
	}
});

test('the turntable takes discs without playing them itself, and the discs fit it', () => {
	const socket = find(byId.get(BEAT_TURNTABLE.socketId), 'socket');
	assert.deepEqual(socket.accepts, ['disc']);
	assert.equal(socket.playMedia, false, 'the script plays the song on its own clock');
	assert.deepEqual(byId.get(BEAT_TURNTABLE.socketId).scale, [1, 1, 1], 'a scaled socket would squash its disc');
	const discs = tree.filter((slot) => find(slot, 'insertable'));
	assert.ok(discs.length >= 2);
	for (const disc of discs) {
		assert.ok(socket.accepts.includes(find(disc, 'insertable').tag));
		assert.ok(find(disc, 'grabbable'));
		const audio = find(disc, 'audioPlayer');
		assert.equal(audio.source.kind, 'url');
		assert.ok(!audio.playing, 'a disc is silent until the script plays it');
		assert.ok(existsSync(new URL(`../static${audio.source.url}`, import.meta.url)), `${audio.source.url} is missing`);
	}
});

test('there are two grabbable sabers and a pool of notes for each hand', () => {
	for (const hand of [0, 1]) {
		const saber = byId.get(`bt-saber-${hand}`);
		assert.ok(find(saber, 'grabbable') && find(saber, 'equippable'));
		assert.equal(byId.get(`bt-saber-${hand}-blade`).parentId, saber.id);
		assert.ok(tree.some((slot) => slot.parentId === saber.id && find(slot, 'collider')), 'the saber can be picked up');
		for (let index = 0; index < BEAT_TURNTABLE.poolSize; index++) {
			const note = byId.get(`bt-note-${hand}-${index}`);
			assert.ok(note, `note ${hand}-${index}`);
			assert.ok(!find(note, 'collider') && !find(note, 'grabbable'), 'notes cannot be touched or picked up');
			assert.equal(byId.get(`${note.id}-arrow`).parentId, note.id);
			assert.equal(byId.get(`${note.id}-dot`).parentId, note.id);
		}
	}
});

test('the leaderboard slot is a scoreboard with one score column, and the script drives real slots', () => {
	assert.deepEqual(find(byId.get(BEAT_TURNTABLE.boardId), 'scoreboard').columns, ['Score']);
	assert.ok(find(byId.get(BEAT_TURNTABLE.consoleId), 'codeBlock'));
	for (const id of ['bt-status', 'bt-info', 'bt-hud-score', 'bt-hud-combo', 'bt-hud-detail', ...BEAT_TURNTABLE.difficultyButtons]) assert.ok(byId.has(id), `${id} exists`);
	for (const id of BEAT_TURNTABLE.difficultyButtons) assert.equal(find(byId.get(id), 'uiElement').kind, 'button');
	assert.doesNotThrow(() => new Function('ctx', BEAT_TURNTABLE_SCRIPT));
	// Every slot id the script names exists in the tree.
	const named = new Set([...BEAT_TURNTABLE_SCRIPT.matchAll(/'(bt-[a-z0-9-]+)'/g)].map((match) => match[1]));
	for (const id of named) assert.ok(byId.has(id) || id.endsWith('-') || /^bt-(note|diff)/.test(id), `the script uses ${id}`);
});

test('the level of a song is deterministic and the same for the same difficulty', () => {
	const analysis = fakeAnalysis();
	for (const difficulty of logic.DIFFICULTY_IDS) {
		const a = logic.generateLevel(analysis, { seed: 42, difficulty });
		const b = logic.generateLevel(analysis, { seed: 42, difficulty });
		assert.deepEqual(a, b);
		assert.ok(a.length >= 8, `${difficulty} has notes`);
	}
	assert.notDeepEqual(logic.generateLevel(analysis, { seed: 1, difficulty: 'normal' }), logic.generateLevel(analysis, { seed: 2, difficulty: 'normal' }));
	assert.ok(logic.generateLevel(analysis, { seed: 1, difficulty: 'easy' }).length < logic.generateLevel(analysis, { seed: 1, difficulty: 'hard' }).length, 'harder means more notes');
});

test('every note can be played: in range, in time, on its own side, never the same cell twice at once', () => {
	const analysis = fakeAnalysis();
	for (const difficulty of logic.DIFFICULTY_IDS) {
		const settings = logic.DIFFICULTIES[difficulty];
		const notes = logic.generateLevel(analysis, { seed: 7, difficulty });
		let previous = null;
		const lastVertical = [null, null];
		for (const note of notes) {
			assert.ok(note.t >= logic.FIRST_NOTE_AT && note.t <= analysis.duration);
			assert.ok(note.col >= 0 && note.col <= 3 && note.row >= 0 && note.row <= 2);
			assert.ok(note.dir >= 0 && note.dir <= 8);
			assert.ok(note.hand === 0 ? note.col <= 1 : note.col >= 2, 'blue on the left, red on the right');
			if (previous && previous.t !== note.t) assert.ok(note.t - previous.t >= settings.minGap - 1e-9, `${difficulty}: notes are at least ${settings.minGap}s apart`);
			if (previous && previous.t === note.t) assert.notEqual(previous.hand, note.hand, 'a pair uses both sabers');
			const vertical = Math.sign(logic.cutVector(note.dir)[1]);
			if (vertical !== 0) {
				const last = lastVertical[note.hand];
				if (last !== null) assert.notEqual(last, vertical, `${difficulty}: a hand alternates between up and down swings`);
				lastVertical[note.hand] = vertical;
			}
			previous = note;
		}
		assert.deepEqual(notes.map((note) => note.id), notes.map((_, index) => index));
	}
});

test('a song without enough beats gives a small level, silence gives none', () => {
	assert.equal(logic.generateLevel({ duration: 30, onsets: [] }, { seed: 1, difficulty: 'easy' }).length, 0);
	const early = { duration: 30, onsets: [{ t: 0.5, strength: 1, band: 'low' }, { t: 29.9, strength: 1, band: 'low' }] };
	assert.equal(logic.generateLevel(early, { seed: 1, difficulty: 'hard' }).length, 0, 'nothing before the first note time or in the last half second');
});

test('scoring: multiplier tiers, accuracy bonus and the maximum a perfect run reaches', () => {
	assert.deepEqual([0, 1, 2, 5, 6, 13, 14, 99].map(logic.multiplierFor), [1, 1, 2, 2, 4, 4, 8, 8]);
	assert.equal(logic.cutPoints(1, 0), 115);
	assert.equal(logic.cutPoints(0, 0), 100);
	assert.equal(logic.cutPoints(5, 0), 115, 'accuracy is clamped');
	assert.equal(logic.cutPoints(1, 20), 115 * 8);
	assert.equal(logic.maxScore(0), 0);
	assert.equal(logic.maxScore(3), 115 + 115 + 230);
	let total = 0;
	for (let combo = 0; combo < 50; combo++) total += logic.cutPoints(1, combo);
	assert.equal(logic.maxScore(50), total);
	assert.deepEqual([1, 0.9, 0.75, 0.6, 0.1].map(logic.rankFor), ['S', 'A', 'B', 'C', 'D']);
});

test('cut directions: the arrow of a note points where the swing has to go', () => {
	for (let dir = 0; dir < 8; dir++) {
		const [vx, vy] = logic.cutVector(dir);
		const angle = logic.noteAngle(dir);
		// An arrow drawn pointing up, turned about the lane axis by `angle`, points to (-sin, cos).
		assert.ok(Math.abs(-Math.sin(angle) - vx) < 1e-9 && Math.abs(Math.cos(angle) - vy) < 1e-9, `direction ${dir}`);
		assert.ok(logic.cutAlignment([vx, vy], dir) > 0.999);
		assert.ok(logic.cutAlignment([-vx, -vy], dir) < -0.999);
		assert.ok(Math.abs(logic.cutAlignment([-vy, vx], dir)) < 1e-9);
	}
	assert.equal(logic.cutAlignment([0, 0], 1), 0, 'no swing, no cut');
	assert.equal(logic.cutAlignment([3, -2], 8), 1, 'any direction accepts every swing');
});

test('geometry: distance from a point to a saber', () => {
	assert.equal(logic.distanceToSegment([0, 1, 0], [-1, 0, 0], [1, 0, 0]), 1);
	assert.equal(logic.distanceToSegment([3, 0, 0], [-1, 0, 0], [1, 0, 0]), 2, 'beyond the tip, measured to the tip');
	assert.equal(logic.distanceToSegment([1, 1, 1], [0, 0, 0], [0, 0, 0]), Math.sqrt(3), 'a zero-length saber is a point');
});

test('board names are valid leaderboard names for any title', () => {
	const valid = /^[A-Za-z0-9_.:-]{1,64}$/;
	for (const title of ['Remembering a Heartbeat', 'Ünïcödé ♪ title', '', 'x'.repeat(500), 'a/b?c=d', '🎵']) {
		const key = logic.songKey('/audio/some song.mp3', title);
		for (const difficulty of logic.DIFFICULTY_IDS) assert.match(logic.boardName(key, difficulty), valid);
	}
	assert.equal(logic.songKey('a', 'b'), logic.songKey('a', 'b'));
	assert.notEqual(logic.songKey('a', 'b'), logic.songKey('a', 'c'));
	assert.notEqual(logic.boardName('k', 'easy'), logic.boardName('k', 'hard'));
});

// --- The script, run against a stand-in for the engine -------------------------------------------------------------------

const DT = 1 / 60;
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Runs the world's script on a fake `ctx`: a socket that can hold a disc, a track on a clock the test advances, in-memory
 * storage and boards, and sabers placed by `swing`. Returns what the script did.
 */
function runWorld({ analysis = fakeAnalysis(), swing = 'perfect', storage = true, withPlayer = true } = {}) {
	const slots = new Map(tree.map((slot) => [slot.id, structuredClone(slot)]));
	const enabled = new Map();
	const poses = new Map();
	const submitted = [];
	const saved = new Map();
	const logs = [];
	const spawned = [];
	const bladePoses = [{ position: [-1.6, 0.96, 1.55], forward: [1, 0, 0] }, { position: [-1.6, 0.96, 1.85], forward: [1, 0, 0] }];
	let trackTime = 0;
	let trackStopped = false;
	let trackStarted = 0;
	const handle = {
		time: () => trackTime,
		get ended() { return trackTime >= analysis.duration; },
		stop() { trackStopped = true; }
	};
	const ctx = {
		hierarchy: { getSlot: (id) => slots.get(id), getWorldPose: (id) => (id.startsWith('bt-saber-') ? bladePoses[Number(id[9])] : undefined) },
		world: {
			isHost: () => true,
			setComponentField(id, type, field, value) {
				const component = slots.get(id)?.components.find((c) => c.type === type);
				if (component) component[field] = value;
			},
			setSlotEnabled: (id, value) => { enabled.set(id, value); return true; },
			setWorldPose: (id, pose) => {
				poses.set(id, { ...(poses.get(id) ?? {}), ...pose });
				const slot = slots.get(id);
				if (slot && pose.position) slot.position = [...pose.position];
				if (slot && pose.rotation) slot.rotation = [...pose.rotation];
				return true;
			},
			spawn: (partial) => { spawned.push(partial); }
		},
		math: { quatFromAxisAngle: (axis, angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)], quatMultiply: (a) => a },
		audio: {
			analyze: async () => analysis,
			playTrack: async () => { trackStarted += 1; trackTime = 0; return handle; }
		},
		leaderboards: {
			available: storage,
			submit: async (name, who, score, options) => { submitted.push({ name, who, score, options }); return null; },
			best: async (name, who) => ({ score: submitted.filter((entry) => entry.name === name).reduce((max, entry) => Math.max(max, entry.score), 0), rank: 3 }),
			showOn: async () => []
		},
		storage: {
			available: storage,
			player: () => ({ get: async (key, fallback) => (saved.has(key) ? structuredClone(saved.get(key)) : fallback), set: async (key, value) => { saved.set(key, structuredClone(value)); } })
		},
		log: (message) => logs.push(message)
	};
	const handlers = new Function('ctx', BEAT_TURNTABLE_SCRIPT)(ctx);
	const text = (id) => find(slots.get(id), 'uiElement').text;
	const socket = find(slots.get(BEAT_TURNTABLE.socketId), 'socket');
	/** Where each block is: its slot's data, which the script sets once and the engine then moves. */
	const notePoses = () => [...slots.values()].filter((slot) => /^bt-note-\d-\d+$/.test(slot.id)).map((slot) => [slot.id, { position: slot.position, rotation: slot.rotation }]);
	const state = { notePoses, slots, enabled, poses, submitted, saved, logs, spawned, handlers, ctx, text, socket, handle, get trackStopped() { return trackStopped; }, get trackStarted() { return trackStarted; }, bladePoses };

	/** One frame: the sabers move (to cut every note, or to stay out of the way), then the script ticks. */
	state.frame = async (swingMode = swing) => {
		if (handle && trackStarted > 0 && !trackStopped) trackTime += DT;
		const idle = [[-1.6, 0.96, 1.55], [-1.6, 0.96, 1.85]];
		bladePoses[0].position = idle[0]; bladePoses[1].position = idle[1];
		bladePoses[0].forward = [1, 0, 0]; bladePoses[1].forward = [1, 0, 0];
		if (swingMode === 'perfect') {
			// The saber of each hand follows the nearest block of its colour and sweeps through it along its arrow, so its speed
			// and direction are those of a real swing and it never jumps.
			const nearest = [null, null];
			for (const [id, pose] of notePoses()) {
				const match = /^bt-note-(\d)-\d+$/.exec(id);
				if (!match || enabled.get(id) !== true) continue;
				const hand = Number(match[1]);
				const distance = Math.abs(pose.position[2] - BEAT_TURNTABLE.hitZ);
				if (distance <= 2.2 && (!nearest[hand] || distance < nearest[hand].distance)) nearest[hand] = { id, pose, distance };
			}
			nearest.forEach((found, hand) => {
				if (!found) return;
				const [x, y, z] = found.pose.position;
				const rotation = found.pose.rotation ?? slots.get(found.id).rotation;
				const angle = 2 * Math.atan2(rotation[2], rotation[3]);
				const along = Math.max(-0.7, Math.min(0.7, (BEAT_TURNTABLE.hitZ - z) * 0.5));
				bladePoses[hand].position = [x + -Math.sin(angle) * along, y + Math.cos(angle) * along, z];
				bladePoses[hand].forward = [0, 0, 1];
			});
		}
		handlers.tick(DT);
		// The engine's part: slots with a velocity move by it every frame.
		for (const slot of slots.values()) {
			const velocity = slot.components.find((c) => c.type === 'velocity');
			if (velocity && velocity.linear.some((v) => v !== 0)) slot.position = slot.position.map((v, i) => v + velocity.linear[i] * DT);
		}
		await tick();
	};
	return state;
}

const startGame = async (world) => {
	world.socket.occupantId = 'bt-disc-1';
	for (let i = 0; i < 5 && !world.text('bt-status').includes('Starting in'); i++) await world.frame();
	assert.ok(world.text('bt-status').includes('Starting in'), `counting down: ${world.text('bt-status')}`);
};

test('a disc on the turntable is read, counted in, and a game starts', async () => {
	const world = runWorld();
	assert.match(world.text('bt-status'), /Place a disc/);
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	world.socket.occupantId = 'bt-disc-1';
	await world.frame();
	assert.match(world.text('bt-status'), /Reading|Starting in/);
	await world.frame();
	assert.match(world.text('bt-status'), /Remembering a Heartbeat/);
	assert.match(world.text('bt-info'), /blocks - Normal/);
	assert.equal(world.trackStarted, 0, 'the song waits for the countdown');
	for (let i = 0; i < 60 * 6 + 5; i++) await world.frame();
	assert.equal(world.trackStarted, 1, 'the song starts after the countdown');
});

test('playing every block right gives a near-perfect score that is saved and ranked', async () => {
	const world = runWorld();
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	await startGame(world);
	let frames = 0;
	while (!/^Rank/.test(world.text('bt-status')) && frames < 60 * 70) { await world.frame(); frames++; }
	const [, cut, total] = /(\d+) of (\d+) cut/.exec(world.text('bt-info'));
	assert.ok(Number(total) >= 60, 'a whole song of blocks');
	assert.ok(Number(cut) >= Number(total) * 0.95, `${cut} of ${total} cut: ${world.text('bt-info')}`);
	assert.match(world.text('bt-status'), /^Rank [SA] - /);
	assert.equal(world.submitted.length, 1);
	const [entry] = world.submitted;
	assert.match(entry.name, /^song-[A-Za-z0-9]{1,12}-normal$/);
	assert.deepEqual(entry.options, { order: 'high' });
	assert.equal(entry.who.id, 'me');
	assert.ok(entry.score > logic.maxScore(Number(total)) * 0.7 && entry.score <= logic.maxScore(Number(total)), `${entry.score} of ${logic.maxScore(Number(total))}`);
	await tick(); await tick();
	const songs = world.saved.get('songs');
	assert.equal(Object.keys(songs).length, 1);
	const [stats] = Object.values(songs);
	assert.equal(stats.best, entry.score);
	assert.equal(stats.plays, 1);
	assert.match(world.text('bt-status'), /New personal best/);
	assert.ok(world.trackStopped, 'the track is stopped at the end');
	for (let hand = 0; hand < 2; hand++) for (let i = 0; i < BEAT_TURNTABLE.poolSize; i++) assert.equal(world.enabled.get(`bt-note-${hand}-${i}`), false, 'every block is put away');
	assert.deepEqual(world.logs, []);
});

test('never swinging misses everything, scores nothing and still finishes', async () => {
	const world = runWorld({ swing: 'none' });
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	await startGame(world);
	let frames = 0;
	while (!/^Rank/.test(world.text('bt-status')) && frames < 60 * 70) { await world.frame(); frames++; }
	assert.match(world.text('bt-status'), /^Rank D - 0 points/);
	assert.equal(world.submitted[0].score, 0);
	assert.equal(world.text('bt-hud-score'), '0');
	assert.deepEqual(world.logs, []);
});

test('taking the disc off in the middle of a song stops it and puts the blocks away', async () => {
	const world = runWorld();
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	await startGame(world);
	for (let i = 0; i < 60 * 6 + 60 * 12; i++) await world.frame();
	assert.ok([...world.enabled].some(([id, on]) => on && id.startsWith('bt-note-') && !id.endsWith('arrow') && !id.endsWith('dot')), 'blocks are flying');
	world.socket.occupantId = '';
	await world.frame();
	assert.ok(world.trackStopped);
	assert.match(world.text('bt-status'), /Place a disc/);
	for (let hand = 0; hand < 2; hand++) for (let i = 0; i < BEAT_TURNTABLE.poolSize; i++) assert.equal(world.enabled.get(`bt-note-${hand}-${i}`), false);
	for (let i = 0; i < 120; i++) await world.frame();
	assert.equal(world.submitted.length, 0, 'an abandoned song is not scored');
});

test('a bad cut with the wrong saber breaks the combo and is not a hit', async () => {
	const world = runWorld();
	await startGame(world);
	// Swing the red saber through every blue block (and the blue one through red): wrong colour on purpose.
	let frames = 0;
	while (!/^Rank/.test(world.text('bt-status')) && frames < 60 * 70) {
		await world.frame('none');
		for (const [id, pose] of world.notePoses()) {
			const match = /^bt-note-(\d)-\d+$/.exec(id);
			if (!match || world.enabled.get(id) !== true || Math.abs(pose.position[2] - BEAT_TURNTABLE.hitZ) > 0.3) continue;
			const wrong = 1 - Number(match[1]);
			const [x, y, z] = pose.position;
			world.bladePoses[wrong].position = [x, y + 0.2, z];
			world.bladePoses[wrong].forward = [0, 0, 1];
		}
		frames++;
	}
	assert.match(world.text('bt-status'), /^Rank D/);
});

test('without storage the game still plays and says scores are not saved', async () => {
	const world = runWorld({ storage: false });
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	await startGame(world);
	let frames = 0;
	while (!/Rank/.test(world.text('bt-status')) && frames < 60 * 70) { await world.frame(); frames++; }
	for (let i = 0; i < 5; i++) await tick();
	assert.match(world.text('bt-status'), /not saved/);
	assert.equal(world.submitted.length, 0);
});

test('choosing a difficulty starts the song again with that difficulty, and is remembered', async () => {
	const world = runWorld();
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	await tick();
	await startGame(world);
	world.handlers.onUIEvent({ type: 'press', slotId: 'bt-diff-hard' });
	assert.equal(find(slots(world, 'bt-diff-hard'), 'uiElement').background, '#7c3aed');
	assert.equal(find(slots(world, 'bt-diff-normal'), 'uiElement').background, '#374151');
	await world.frame(); await world.frame();
	assert.match(world.text('bt-info'), /Hard/);
	await tick();
	assert.equal(world.saved.get('difficulty'), 'hard');
});

function slots(world, id) {
	return world.slots.get(id);
}

test('a disc with no audio is refused instead of breaking the game', async () => {
	const world = runWorld();
	const disc = world.slots.get('bt-disc-1');
	disc.components = disc.components.filter((c) => c.type !== 'audioPlayer');
	world.socket.occupantId = 'bt-disc-1';
	await world.frame();
	assert.match(world.text('bt-status'), /cannot be played/);
	assert.equal(world.trackStarted, 0);
});

// --- The look of the world ------------------------------------------------------------------------------------------------

test('the stage has a sky and every animated part the script moves', () => {
	const sky = tree.filter((slot) => find(slot, 'skybox'));
	assert.equal(sky.length, 1, 'one skybox');
	assert.ok(find(sky[0], 'skybox').stars > 0.5, 'a starry sky');
	for (let i = 0; i < STAGE.frames; i++) for (const part of ['', '-l', '-r', '-t', '-b']) assert.ok(byId.has(`${stageIds.frame(i)}${part}`), `frame ${i}${part}`);
	for (const side of [0, 1]) for (let k = 0; k < STAGE.barsPerSide; k++) assert.ok(find(byId.get(stageIds.bar(side, k)), 'meshRenderer'));
	for (let i = 0; i < STAGE.lasers; i++) assert.equal(byId.get(`${stageIds.laser(i)}-beam`).parentId, stageIds.laser(i));
	for (let i = 0; i < STAGE.gridLines; i++) assert.ok(byId.has(stageIds.grid(i)));
	assert.ok(byId.has(stageIds.sun) && byId.has(stageIds.hitLine));
	assert.ok(tree.filter((slot) => find(slot, 'pointLight')).length >= 2, 'coloured lights on the lane');
	for (const slot of tree.filter((candidate) => candidate.id.startsWith('bt-fx-') && find(candidate, 'meshRenderer'))) assert.ok(!find(slot, 'collider'), `${slot.id} cannot be bumped into`);
});

test('the disc table is gone: a rack of sockets holds the records, and the turntable stands on a hi-fi stand', () => {
	assert.ok(!tree.some((slot) => /desk/i.test(slot.name)), 'no desk any more');
	assert.ok(byId.has('bt-stand-top') && byId.has('bt-platter') && byId.has(deckIds.armPivot));
	const sockets = [];
	for (let row = 0; row < DECK.rackRows; row++) for (let slot = 0; slot < DECK.rackSlots; slot++) sockets.push(byId.get(deckIds.rackSocket(row, slot)));
	assert.equal(sockets.length, 8);
	const seen = new Set();
	for (const socket of sockets) {
		const component = find(socket, 'socket');
		assert.deepEqual(component.accepts, ['disc']);
		assert.equal(component.playMedia, false, 'a disc on the rack stays silent');
		assert.deepEqual(component.snap.rotation, [...DECK.rackSnap]);
		assert.deepEqual(socket.scale, [1, 1, 1]);
		const key = socket.position.join(',');
		assert.ok(!seen.has(key), 'sockets do not share a spot');
		seen.add(key);
	}
	// A seated disc is already where its socket would put it, standing on its edge, and the socket knows it.
	const quat = eulerToQuat([...DECK.rackSnap]);
	for (let i = 0; i < 4; i++) assert.ok(Math.abs(quat[i] - DECK.rackQuat[i]) < 1e-9, 'the seated rotation is the snap rotation');
	const seated = sockets.filter((socket) => find(socket, 'socket').occupantId);
	assert.equal(seated.length, 2);
	for (const socket of seated) {
		const disc = byId.get(find(socket, 'socket').occupantId);
		assert.equal(disc.parentId, socket.id);
		assert.deepEqual(disc.position, [0, 0, 0]);
		assert.deepEqual(disc.rotation, [...DECK.rackQuat]);
	}
	// Nothing stands where a disc goes: every socket is clear of the stand and of the sabers.
	for (const socket of sockets) assert.ok(Math.hypot(socket.position[0] - DECK.x, socket.position[2] - DECK.z) > 1.2);
	// Neighbouring sockets are further apart than their radius, or a released disc could pick the wrong one.
	const radius = find(sockets[0], 'socket').radius;
	for (const a of sockets) for (const b of sockets) if (a !== b) assert.ok(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]) > radius, `${a.id} and ${b.id} overlap`);
	const turntable = byId.get(BEAT_TURNTABLE.socketId);
	for (const socket of sockets) assert.ok(Math.hypot(...socket.position.map((v, i) => v - turntable.position[i])) > radius + find(turntable, 'socket').radius, 'the rack does not compete with the turntable');
});

test('the score board is made of cards and uses the new element styling', () => {
	const hud = byId.get(BEAT_TURNTABLE.hudId);
	assert.ok(find(hud, 'uiPanel'));
	for (const id of ['bt-hud-card-score', 'bt-hud-card-combo', 'bt-hud-card-acc']) {
		const card = find(byId.get(id), 'uiElement');
		assert.equal(card.kind, 'container');
		assert.ok(card.cornerRadius > 0 && card.borderWidth > 0 && card.borderColor, `${id} is a rounded, outlined card`);
	}
	for (const id of ['bt-hud-score', 'bt-hud-combo', 'bt-hud-detail', 'bt-hud-mult', 'bt-hud-rank', 'bt-hud-best', 'bt-hud-title', 'bt-judge-text', 'bt-status']) assert.equal(find(byId.get(id), 'uiElement').textAlign, 'center', `${id} is centred`);
	assert.equal(find(byId.get('bt-hud-fill'), 'uiElement').width, 0, 'the progress bar starts empty');
	assert.equal(byId.get('bt-hud-fill-pad').parentId, 'bt-hud-fill', 'and keeps its height through an invisible child');
	assert.ok(tree.every((slot) => !find(slot, 'uiElement') || slot.id.startsWith('bt-')));
});

test('the stage only moves while the song plays', async () => {
	const analysis = fakeAnalysis();
	// A song that is silent for three seconds, then loud in every band.
	const hop = 0.0232;
	const loud = (from) => Array.from({ length: Math.ceil(40 / hop) }, (_, i) => (i * hop >= from ? 0.95 : 0.02));
	analysis.energy = { hop, low: loud(3), mid: loud(3), high: loud(3) };
	const world = runWorld({ analysis, swing: 'none' });
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	const colour = (id) => find(world.slots.get(id), 'meshRenderer').color;
	const fxPoses = () => [...world.poses.keys()].filter((id) => id.startsWith('bt-fx-'));
	const middle = stageIds.frame(4);
	// At rest nothing moves, and the script does not even touch the slots.
	for (let i = 0; i < 120; i++) await world.frame('none');
	assert.deepEqual(fxPoses(), [], 'the idle stage is still');
	assert.ok([...world.slots.values()].filter((slot) => slot.id.startsWith('bt-fx-')).every((slot) => !slot.components.some((c) => c.type === 'velocity' && c.linear.some((v) => v !== 0))), 'nothing is set flying');
	const restColour = colour(`${middle}-l`);
	assert.notEqual(restColour, '#0b1026', 'but it is lit, in resting colours');
	// Not during the analysis or the count-in either.
	world.socket.occupantId = 'bt-disc-1';
	for (let i = 0; i < 60 * 5; i++) await world.frame('none');
	assert.equal(world.trackStarted, 0);
	assert.deepEqual(fxPoses(), [], 'the stage waits for the music');
	// It starts with the song.
	for (let i = 0; i < 90; i++) await world.frame('none');
	assert.equal(world.trackStarted, 1);
	const start = world.slots.get(middle).position[2];
	for (let i = 0; i < 30; i++) await world.frame('none');
	assert.ok(world.slots.get(middle).position[2] < start, 'the frames come towards the player');
	const quiet = world.poses.get(stageIds.bar(0, 3)).position[1];
	// Frames wrap instead of passing through the player.
	let lowest = Infinity;
	for (let i = 0; i < 60 * 8; i++) { await world.frame('none'); lowest = Math.min(lowest, world.slots.get(stageIds.frame(0)).position[2]); }
	assert.ok(lowest >= STAGE.frameNear - 0.2, `a frame never gets closer than ${STAGE.frameNear} m, give or take the frame it takes to wrap (was ${lowest})`);
	const loudY = world.poses.get(stageIds.bar(0, 3)).position[1];
	assert.ok(loudY > quiet + 1, `the towers rise with the music: ${quiet} -> ${loudY}`);
	assert.notEqual(colour(`${middle}-l`), restColour, 'the frames change colour');
	assert.ok(world.poses.get(stageIds.laser(0)).rotation, 'the lasers sweep');
	// When the record comes off, the music stops and so does the stage: the towers sink and then it is still again.
	world.socket.occupantId = '';
	for (let i = 0; i < 60 * 3; i++) await world.frame('none');
	const frozen = world.slots.get(middle).position[2];
	const laser = world.poses.get(stageIds.laser(0)).rotation;
	for (let i = 0; i < 120; i++) await world.frame('none');
	assert.equal(world.slots.get(middle).position[2], frozen, 'the frames stop');
	assert.deepEqual(world.poses.get(stageIds.laser(0)).rotation, laser, 'the lasers stop');
	assert.ok(world.poses.get(stageIds.bar(0, 3)).position[1] < quiet + 0.2, 'the towers have sunk');
	assert.deepEqual(world.logs, []);
});

test('while the song plays the script does little per frame: the engine flies the blocks and the flow, the rest runs at 30 Hz', async () => {
	const world = runWorld({ swing: 'none' });
	await startGame(world);
	for (let i = 0; i < 60 * 6 + 120; i++) await world.frame('none');
	const calls = { pose: 0, field: 0, notePose: 0 };
	const field = world.ctx.world.setComponentField;
	world.ctx.world.setComponentField = (...args) => { calls.field += 1; return field(...args); };
	const pose = world.ctx.world.setWorldPose;
	world.ctx.world.setWorldPose = (id, ...rest) => { calls.pose += 1; if (id.startsWith('bt-note-')) calls.notePose += 1; return pose(id, ...rest); };
	const frames = 120;
	for (let i = 0; i < frames; i++) await world.frame('none');
	assert.ok(calls.pose / frames <= 12, `${calls.pose / frames} poses a frame`);
	assert.ok(calls.field / frames <= 25, `${calls.field / frames} field writes a frame`);
	// A block is placed once, when it enters the lane; after that only the engine moves it.
	assert.ok(calls.notePose <= 12, `${calls.notePose} block poses in ${frames} frames`);
	const flying = [...world.slots.values()].filter((slot) => /^bt-note-\d-\d+$/.test(slot.id) && slot.components.find((c) => c.type === 'velocity').linear[2] < 0);
	for (const note of flying) assert.ok(world.enabled.get(note.id) === true, 'only visible blocks have a velocity');
});

test('the blocks fly at the lane speed and arrive at the hit line on the beat', async () => {
	const world = runWorld({ swing: 'none' });
	await startGame(world);
	for (let i = 0; i < 60 * 6 + 5; i++) await world.frame('none');
	const settings = logic.DIFFICULTIES.normal;
	const speed = BEAT_TURNTABLE.field / settings.travel;
	const seen = new Map();
	for (let i = 0; i < 60 * 10; i++) {
		await world.frame('none');
		for (const [id, pose] of world.notePoses()) {
			if (world.enabled.get(id) !== true) continue;
			const velocity = world.slots.get(id).components.find((c) => c.type === 'velocity').linear;
			assert.ok(Math.abs(velocity[2] + speed) < 1e-9 && velocity[0] === 0 && velocity[1] === 0, 'towards the player at the lane speed');
			if (!seen.has(id)) seen.set(id, pose.position[2]);
		}
	}
	assert.ok(seen.size > 4, 'blocks came');
	for (const start of seen.values()) assert.ok(Math.abs(start - (BEAT_TURNTABLE.hitZ + settings.travel * speed)) < speed * 0.05, `a block enters the lane at the far end (${start})`);
});

test('every effect can be switched off from the screen, hides its slots and is remembered', async () => {
	const world = runWorld({ swing: 'none' });
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	await tick();
	await world.frame('none');
	const press = (id) => world.handlers.onUIEvent({ type: 'press', slotId: id });
	const text = (id) => world.text(id);
	const groups = {
		tunnel: Array.from({ length: STAGE.frames }, (_, i) => stageIds.frame(i)),
		towers: [0, 1].flatMap((side) => Array.from({ length: STAGE.barsPerSide }, (_, k) => stageIds.bar(side, k))),
		lasers: Array.from({ length: STAGE.lasers }, (_, i) => stageIds.laser(i)),
		grid: Array.from({ length: STAGE.gridLines }, (_, i) => stageIds.grid(i)),
		sun: [stageIds.sun],
		glow: ['bt-saber-0-halo', 'bt-saber-1-halo'],
		lights: ['bt-light-0', 'bt-light-1']
	};
	assert.equal(OPTION_BUTTONS.length, 8);
	for (const [id] of OPTION_BUTTONS) assert.equal(find(byId.get(id), 'uiElement').kind, 'button');
	for (const [id, label] of OPTION_BUTTONS) assert.equal(text(id), `${label}  ON`, 'everything starts on');
	for (const [effect, ids] of Object.entries(groups)) for (const id of ids) assert.equal(world.enabled.get(id), true, `${id} (${effect}) is shown`);
	// Each button turns its effect off and on again.
	const keys = ['tunnel', 'towers', 'lasers', 'grid', 'sun', 'glow', 'sparks', 'lights'];
	keys.forEach((key, index) => {
		const [button, label] = OPTION_BUTTONS[index];
		press(button);
		assert.equal(text(button), `${label}  OFF`, `${key} is off`);
		for (const id of groups[key] ?? []) assert.equal(world.enabled.get(id), false, `${id} is hidden`);
		for (const [other, ids] of Object.entries(groups)) if (other !== key) for (const id of ids) assert.equal(world.enabled.get(id), true, `${id} stays shown`);
		press(button);
		assert.equal(text(button), `${label}  ON`);
		for (const id of groups[key] ?? []) assert.equal(world.enabled.get(id), true, `${id} is back`);
	});
	await tick();
	// The choice is saved for the player, and the presets set several at once.
	press('bt-opt-towers');
	await tick();
	assert.equal(world.saved.get('effects').towers, false);
	assert.equal(world.saved.get('effects').tunnel, true);
	press('bt-opt-lite');
	assert.deepEqual(keys.map((key) => !!world.slots && text(OPTION_BUTTONS[keys.indexOf(key)][0]).endsWith('ON')), [true, false, false, true, true, false, false, false]);
	press('bt-opt-off');
	for (const [effect, ids] of Object.entries(groups)) for (const id of ids) assert.equal(world.enabled.get(id), false, `${id} (${effect}) is hidden with everything off`);
	press('bt-opt-all');
	for (const [effect, ids] of Object.entries(groups)) for (const id of ids) assert.equal(world.enabled.get(id), true, `${id} (${effect}) is back`);
	assert.deepEqual(world.logs, []);
});

test('a returning player gets the effects they chose, and a disabled effect costs the script nothing', async () => {
	const world = runWorld({ swing: 'none' });
	world.saved.set('effects', { tunnel: false, towers: false, lasers: false, grid: false, sun: false, glow: false, sparks: false, lights: false });
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	for (let i = 0; i < 5; i++) await tick();
	await world.frame('none');
	assert.equal(world.enabled.get(stageIds.frame(0)), false);
	assert.equal(world.enabled.get(stageIds.bar(0, 0)), false);
	assert.match(world.text('bt-opt-tunnel'), /OFF$/);
	await startGame(world);
	for (let i = 0; i < 60 * 6 + 5; i++) await world.frame('none');
	let writes = 0;
	const field = world.ctx.world.setComponentField;
	world.ctx.world.setComponentField = (id, ...rest) => { if (id.startsWith('bt-fx-')) writes += 1; return field(id, ...rest); };
	let moves = 0;
	const pose = world.ctx.world.setWorldPose;
	world.ctx.world.setWorldPose = (id, ...rest) => { if (id.startsWith('bt-fx-') && !id.startsWith('bt-fx-frame') && !id.startsWith('bt-fx-grid')) moves += 1; return pose(id, ...rest); };
	for (let i = 0; i < 120; i++) await world.frame('none');
	assert.equal(writes, 0, 'no colour written to a hidden effect');
	assert.equal(moves, 0, 'no tower or laser moved');
	// No sparks without the effect, and no glow on the blocks that fly.
	assert.ok(!world.spawned.some((entry) => entry.components[0].type === 'particleBurst'));
	for (const [id] of [...world.enabled].filter(([id, on]) => on && /^bt-note-\d-\d+$/.test(id))) assert.equal(world.enabled.get(`${id}-glow`), false);
});

test('sparks appear on a cut only while the effect is on', async () => {
	for (const sparks of [true, false]) {
		const world = runWorld();
		world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
		await tick();
		await world.frame();
		if (!sparks) world.handlers.onUIEvent({ type: 'press', slotId: 'bt-opt-sparks' });
		await startGame(world);
		for (let i = 0; i < 60 * 6 + 60 * 8; i++) await world.frame();
		const bursts = world.spawned.filter((entry) => entry.components[0].type === 'particleBurst');
		assert.equal(bursts.length > 0, sparks, `sparks ${sparks ? 'on' : 'off'}: ${bursts.length} bursts`);
		if (sparks) assert.ok(bursts.every((entry) => entry.components[0].count <= 14), 'small bursts');
	}
});

test('the turntable works while a song is on: the record spins, the arm comes down, the light turns red', async () => {
	const world = runWorld({ swing: 'none' });
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	for (let i = 0; i < 20; i++) await world.frame('none');
	assert.equal(find(world.slots.get(deckIds.led), 'meshRenderer').color, '#22c55e', 'green at rest');
	world.socket.occupantId = 'bt-disc-1';
	for (let i = 0; i < 90; i++) await world.frame('none');
	assert.equal(find(world.slots.get(deckIds.led), 'meshRenderer').color, '#ef4444');
	const spin = (id) => world.poses.get(id)?.rotation;
	const a = spin('bt-disc-1');
	for (let i = 0; i < 10; i++) await world.frame('none');
	assert.notDeepEqual(spin('bt-disc-1'), a, 'the record turns');
	assert.ok(spin(deckIds.armPivot), 'the arm moves onto the record');
	world.socket.occupantId = '';
	for (let i = 0; i < 20; i++) await world.frame('none');
	assert.equal(find(world.slots.get(deckIds.led), 'meshRenderer').color, '#22c55e');
});

test('the score board counts up, shows combo, multiplier and accuracy, flashes judgements and shows the result', async () => {
	const world = runWorld();
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	await startGame(world);
	assert.match(world.text('bt-hud-title'), /Remembering a Heartbeat\s+-\s+Normal/);
	for (let i = 0; i < 60 * 6 + 5; i++) await world.frame();
	const seen = { judgements: new Set(), scores: [], mults: new Set() };
	let frames = 0;
	while (!/^Rank/.test(world.text('bt-status')) && frames < 60 * 70) {
		await world.frame();
		frames++;
		seen.judgements.add(world.text('bt-judge-text'));
		seen.scores.push(Number(world.text('bt-hud-score').replaceAll(',', '')));
		seen.mults.add(world.text('bt-hud-mult'));
	}
	assert.ok(seen.judgements.has('PERFECT') || seen.judgements.has('GREAT'), `judgements: ${[...seen.judgements]}`);
	assert.ok(seen.scores.every((value, index) => index === 0 || value >= seen.scores[index - 1]), 'the score only goes up');
	assert.ok(new Set(seen.scores).size > 20, 'and counts up in steps rather than jumping');
	assert.ok(seen.mults.has('x8'), `the multiplier reaches x8: ${[...seen.mults]}`);
	for (let i = 0; i < 10; i++) await tick();
	assert.match(world.text('bt-hud-rank'), /^RANK [SA]$/, 'the board keeps the rank it ended on');
	assert.match(world.text('bt-hud-detail'), /^\d+%$/);
	assert.equal(find(world.slots.get('bt-hud-fill'), 'uiElement').width, 940, 'the bar is full at the end');
	// Taking the record off puts the board back as it was.
	world.socket.occupantId = '';
	await world.frame();
	assert.equal(world.text('bt-hud-score-label'), 'SCORE');
	assert.equal(world.text('bt-hud-score'), '0');
	assert.equal(find(world.slots.get('bt-hud-fill'), 'uiElement').width, 0);
	assert.equal(world.text('bt-judge-text'), '');
	assert.deepEqual(world.logs, []);
});

test('a bad cut and a miss are called out, and the judgement clears itself', async () => {
	const world = runWorld({ swing: 'none' });
	await startGame(world);
	for (let i = 0; i < 60 * 6 + 5; i++) await world.frame('none');
	const said = new Set();
	for (let i = 0; i < 60 * 20; i++) { await world.frame('none'); said.add(world.text('bt-judge-text')); }
	assert.ok(said.has('MISS'), `judgements: ${[...said]}`);
	assert.ok(said.has(''), 'the word fades after a moment');
});

// --- Results, sabers, sign, category ------------------------------------------------------------------------------------

const impactSounds = (world) => world.spawned.filter((entry) => entry.components[0].type === 'impactSound');

test('at the end of a song a result screen appears with the numbers of the run and a win sound', async () => {
	const world = runWorld();
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	await startGame(world);
	assert.equal(world.enabled.get(BEAT_TURNTABLE.resultsId), false, 'hidden while playing');
	for (let i = 0; i < 60 * 6 + 5; i++) await world.frame();
	assert.equal(world.enabled.get(BEAT_TURNTABLE.resultsId), false);
	let frames = 0;
	while (!/^Rank/.test(world.text('bt-status')) && frames < 60 * 70) { await world.frame(); frames++; }
	assert.equal(world.enabled.get(BEAT_TURNTABLE.resultsId), true, 'shown at the end');
	for (let i = 0; i < 60 * 4; i++) await world.frame();
	for (let i = 0; i < 10; i++) await tick();
	assert.match(world.text('bt-res-title'), /PERFECT RUN|SONG CLEARED/);
	assert.match(world.text('bt-res-song'), /Remembering a Heartbeat\s+-\s+Normal/);
	assert.match(world.text('bt-res-rank'), /^[SA]$/);
	assert.equal(find(world.slots.get('bt-res-rank'), 'uiElement').color, world.text('bt-res-rank') === 'S' ? '#facc15' : '#4ade80');
	const score = Number(world.text('bt-res-score').replaceAll(',', ''));
	assert.equal(score, world.submitted[0].score, 'the score on the screen is the one that was submitted');
	assert.match(world.text('bt-res-acc'), /^\d+%$/);
	assert.ok(Number(world.text('bt-res-combo')) > 30);
	assert.match(world.text('bt-res-cuts'), /^\d+ \/ \d+$/);
	assert.match(world.text('bt-res-best'), /NEW PERSONAL BEST/);
	assert.match(world.text('bt-res-footer'), /Leaderboard rank #3/);
	// The win sound: a rising arpeggio then a chord, as separate plucks over the first seconds.
	const jingle = impactSounds(world).map((sound) => sound.components[0]).filter((note) => note.durationMs >= 400);
	assert.ok(jingle.length >= 7, `${jingle.length} notes`);
	const freqs = jingle.map((note) => note.frequency);
	assert.deepEqual(freqs.slice(0, 4), [523, 659, 784, 1047], 'rising arpeggio');
	assert.ok(jingle.every((note) => note.durationMs >= 400 && note.volume > 0 && note.pitchDrop === 0), 'long, clean tones, not hit sounds');
	assert.ok(world.spawned.some((entry) => entry.components[0].type === 'particleBurst' && entry.position[2] > 4), 'and sparks over the screen');
	// Taking the record off hides it again and silences what was still to play.
	world.socket.occupantId = '';
	await world.frame();
	assert.equal(world.enabled.get(BEAT_TURNTABLE.resultsId), false);
	assert.deepEqual(world.logs, []);
});

test('a poor run gets a different headline and a falling jingle instead of the win sound', async () => {
	const world = runWorld({ swing: 'none' });
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	await startGame(world);
	let frames = 0;
	while (!/^Rank/.test(world.text('bt-status')) && frames < 60 * 70) { await world.frame('none'); frames++; }
	for (let i = 0; i < 60 * 3; i++) await world.frame('none');
	assert.equal(world.text('bt-res-title'), 'TRY AGAIN');
	assert.equal(world.text('bt-res-rank'), 'D');
	assert.equal(world.text('bt-res-score'), '0');
	const freqs = impactSounds(world).map((sound) => sound.components[0]).filter((note) => note.durationMs >= 400).map((note) => note.frequency);
	assert.deepEqual(freqs, [392, 349, 311, 262], 'descending, nothing to celebrate');
	assert.equal(world.text('bt-res-missed'), String(Number(world.text('bt-res-cuts').split(' / ')[1])));
});

test('the results screen says so when scores cannot be saved', async () => {
	const world = runWorld({ storage: false, swing: 'none' });
	world.handlers.onPlayerReady({ id: 'me', name: 'Me' });
	await startGame(world);
	let frames = 0;
	while (!/Rank/.test(world.text('bt-status')) && frames < 60 * 70) { await world.frame('none'); frames++; }
	for (let i = 0; i < 10; i++) await tick();
	assert.match(world.text('bt-res-footer'), /not saved/);
});

test('the results screen sits in front of the player, clear of the lane, the score board and the judgement', () => {
	const results = byId.get(BEAT_TURNTABLE.resultsId);
	const panel = find(results, 'uiPanel');
	assert.ok(panel.worldWidth >= 2 && panel.worldWidth <= 2.6);
	assert.ok(results.position[2] > BEAT_TURNTABLE.playerZ + 1.5 && results.position[2] < BEAT_TURNTABLE.hudZ - 1, 'between the player and the score board');
	const height = panel.worldWidth * (panel.height / panel.width);
	assert.ok(results.position[1] - height / 2 > 0.9 && results.position[1] + height / 2 < 3.2, 'at a comfortable height');
	assert.equal(results.parentId, null);
});

test('the sabers lie under the leaderboard, handles towards the player and blades towards the stage', () => {
	const board = byId.get(BEAT_TURNTABLE.boardId);
	const boardFrame = byId.get('bt-board-frame');
	const stand = byId.get('bt-saber-stand');
	const xs = [];
	for (const hand of [0, 1]) {
		const saber = byId.get(`bt-saber-${hand}`);
		assert.deepEqual(saber.rotation, [0, 0, 0, 1], 'blade along +Z, the way of the stage');
		const handle = byId.get(`bt-saber-${hand}-handle`);
		const blade = byId.get(`bt-saber-${hand}-blade`);
		assert.ok(handle.position[2] < blade.position[2], 'handle nearer the player than the blade');
		xs.push(saber.position[0]);
		const tipZ = saber.position[2] + blade.position[2] + blade.scale[2] / 2;
		const handleZ = saber.position[2] - handle.scale[2] / 2;
		assert.ok(handleZ > BEAT_TURNTABLE.playerZ, 'the handle is in front of where the player stands, not behind');
		assert.ok(handleZ - BEAT_TURNTABLE.playerZ < 0.5, 'and within reach of it');
		assert.ok(tipZ < boardFrame.position[2] - boardFrame.scale[2] / 2, 'the blade stops short of the board');
		assert.ok(saber.position[1] > stand.position[1] && saber.position[1] < board.position[1] - 0.4, 'above the stand, below the board');
		assert.ok(Math.abs(saber.position[0] - board.position[0]) < board.scale[0] / 2, 'under the board');
	}
	assert.ok(xs[1] - xs[0] >= 0.3, 'room for a hand between them');
	assert.ok(Math.abs(stand.position[0] - board.position[0]) < 0.1, 'the stand is centred under the board');
	// Nothing else is in the way: no hi-fi stand or rack part within reach of the sabers.
	for (const slot of tree) if (/^bt-(stand|rack)-/.test(slot.id)) assert.ok(Math.abs(slot.position[0] - xs[0]) > 2, `${slot.id} is far from the sabers`);
});

test('the rack sign faces the stand and reads the right way round', () => {
	const sign = byId.get('bt-rack-sign');
	// Rotate the sign's front (its -Z side) and its up by the sign's quaternion.
	const rotate = ([x, y, z, w], [vx, vy, vz]) => {
		const t = [2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)];
		return [vx + w * t[0] + (y * t[2] - z * t[1]), vy + w * t[1] + (z * t[0] - x * t[2]), vz + w * t[2] + (x * t[1] - y * t[0])].map((v) => Math.round(v * 1000) / 1000);
	};
	assert.deepEqual(rotate(sign.rotation, [0, 0, -1]).map((v) => v + 0), [1, 0, 0], 'the front looks towards +X');
	assert.deepEqual(rotate(sign.rotation, [0, 1, 0]), [0, 1, 0], 'upright');
	// Its viewer stands on that side: the sign is on the +X side of the rack's back, facing the hi-fi stand.
	assert.ok(DECK.x > sign.position[0]);
});

test('Beat Turntable is a development world, not an official one', async () => {
	const { readFile } = await import('node:fs/promises');
	const source = await readFile(new URL('../src/lib/xr/templates/builtinWorlds.ts', import.meta.url), 'utf8');
	const dev = /DEV_WORLD_IDS[^=]*=\s*\[([^\]]*)\]/.exec(source)[1];
	assert.ok(dev.includes('beat-turntable'), `dev worlds are ${dev}`);
	assert.ok(dev.includes('mirror-maze'), 'the others stay');
	assert.match(source, /id: 'beat-turntable'/);
});
