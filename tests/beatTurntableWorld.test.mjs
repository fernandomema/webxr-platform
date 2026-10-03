import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { BEAT_TURNTABLE, BEAT_TURNTABLE_SCRIPT, buildBeatTurntable } from '../src/lib/xr/templates/beatTurntable.ts';
import { loadLevelLogic } from '../src/lib/xr/templates/beatTurntableLogic.ts';
import { isBuiltinMeshId } from '../src/lib/assets/ref.ts';

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
	assert.ok(tree.length > 50 && tree.length < 400);
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
	for (const id of named) assert.ok(byId.has(id) || /^bt-(note|diff)/.test(id), `the script uses ${id}`);
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
			setWorldPose: (id, pose) => { poses.set(id, { ...(poses.get(id) ?? {}), ...pose }); return true; },
			spawn: (partial) => { spawned.push(partial); }
		},
		math: { quatFromAxisAngle: (axis, angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)] },
		audio: {
			analyze: async () => analysis,
			playTrack: async () => { trackStarted += 1; trackTime = 0; return handle; }
		},
		leaderboards: {
			available: storage,
			submit: async (name, who, score, options) => { submitted.push({ name, who, score, options }); return null; },
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
	const state = { slots, enabled, poses, submitted, saved, logs, spawned, handlers, ctx, text, socket, handle, get trackStopped() { return trackStopped; }, get trackStarted() { return trackStarted; }, bladePoses };

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
			for (const [id, pose] of poses) {
				const match = /^bt-note-(\d)-\d+$/.exec(id);
				if (!match || enabled.get(id) === false || !pose.position) continue;
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
		for (const [id, pose] of world.poses) {
			const match = /^bt-note-(\d)-\d+$/.exec(id);
			if (!match || world.enabled.get(id) === false || !pose.position || Math.abs(pose.position[2] - BEAT_TURNTABLE.hitZ) > 0.3) continue;
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
