import type { Slot, SlotTree } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { buildDisc } from './recordDisc.ts';
import { LEVEL_LOGIC_SOURCE } from './beatTurntableLogic.ts';

/**
 * Beat Turntable: a rhythm game in the spirit of Beat Saber that is started with a record. Put a disc on the turntable and the
 * world reads its song (`ctx.audio.analyze`), builds a level from where the music hits (see beatTurntableLogic.ts) and plays the
 * song (`ctx.audio.playTrack`) while blocks fly towards you: cut each one with the saber of its colour, in the direction of its
 * arrow. Scores go to a leaderboard per song and difficulty and to the player's saved stats (`ctx.leaderboards`, `ctx.storage`).
 *
 * The player stands at (0, 0, 2), facing +Z, as the desktop camera does. Blocks come from far +Z to the hit line at z = 2.75.
 * The control desk (turntable, sabers, console) is to the left and the leaderboard to the right.
 *
 * Everything game-specific lives here and in the logic file; the engine only provides the generic audio, storage and
 * leaderboard APIs the script calls.
 */

export const BEAT_TURNTABLE = {
	socketId: 'bt-socket',
	boardId: 'bt-board',
	hudId: 'bt-hud',
	consoleId: 'bt-console',
	/** Notes in each hand's pool: enough for the densest level to have every block on screen. */
	poolSize: 14,
	playerZ: 2,
	hitZ: 2.75,
	/** Distance the blocks travel, from where they appear to the hit line. */
	field: 11,
	colX: [-0.6, -0.2, 0.2, 0.6],
	rowY: [0.85, 1.2, 1.55],
	difficultyButtons: ['bt-diff-easy', 'bt-diff-normal', 'bt-diff-hard']
} as const;

const BLUE = '#2563eb';
const RED = '#dc2626';
const DESK = { x: -1.6, z: 2.6, top: 0.8 };

const noteId = (hand: number, index: number) => `bt-note-${hand}-${index}`;

const box = (id: string, name: string, position: [number, number, number], scale: [number, number, number], color: string, extra: Partial<Slot> = {}, collider = false): Slot =>
	createSlot({
		id,
		name,
		position,
		scale,
		...extra,
		components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color }, ...(collider ? [{ type: 'collider' as const, shape: 'box' as const }] : []), ...(extra.components ?? [])]
	});

const cylinder = (id: string, name: string, position: [number, number, number], diameter: number, height: number, color: string): Slot =>
	createSlot({ id, name, position, scale: [diameter, height, diameter], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color }] });

function buildSaber(hand: 0 | 1): Slot[] {
	const id = `bt-saber-${hand}`;
	const color = hand === 0 ? BLUE : RED;
	const pose = { position: [0, 0, 0.04] as [number, number, number], rotation: [15, 0, 0] as [number, number, number] };
	return [
		createSlot({
			id,
			name: hand === 0 ? 'Blue Saber' : 'Red Saber',
			// Lying on the rack with the blade pointing towards the player.
			position: [DESK.x, 0.955, 1.55 + hand * 0.3],
			rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
			components: [{ type: 'container' }, { type: 'grabbable', scalable: false }, { type: 'equippable', left: pose, right: pose }]
		}),
		box(`${id}-handle`, 'Saber Handle', [0, 0, 0], [0.03, 0.03, 0.2], '#27272a', { parentId: id }, true),
		box(`${id}-guard`, 'Saber Guard', [0, 0, 0.11], [0.075, 0.016, 0.016], '#a1a1aa', { parentId: id }),
		box(`${id}-blade`, 'Saber Blade', [0, 0, 0.56], [0.03, 0.03, 0.9], color, { parentId: id })
	];
}

/** One block of a hand's pool. Parked out of sight and switched off until the script gives it a note. */
function buildNote(hand: 0 | 1, index: number): Slot[] {
	const id = noteId(hand, index);
	const white = '#f8fafc';
	return [
		box(id, `Note ${hand}-${index}`, [0, -50, 0], [0.28, 0.28, 0.28], hand === 0 ? BLUE : RED),
		// Children are in the cube's own units: the arrow is a bar on the front face pointing up, the dot is for any direction.
		box(`${id}-arrow`, 'Note Arrow', [0, 0.12, -0.52], [0.16, 0.5, 0.06], white, { parentId: id }),
		box(`${id}-dot`, 'Note Dot', [0, 0, -0.52], [0.3, 0.3, 0.06], white, { parentId: id })
	];
}

const uiPanel = (id: string, name: string, position: [number, number, number], width: number, height: number, worldWidth: number, extra: Slot['components'] = []): Slot =>
	createSlot({ id, name, position, components: [{ type: 'uiPanel', width, height, worldWidth, background: '#0b1020' }, ...extra] });

const uiText = (id: string, parentId: string, text: string, width: number, height: number, fontSize: number, color = '#f4f4f5'): Slot =>
	createSlot({ id, parentId, name: id, components: [{ type: 'uiElement', kind: 'text', width, height, text, fontSize, color }] });

function buildConsole(code: string): Slot[] {
	const root = BEAT_TURNTABLE.consoleId;
	const buttons: [string, string][] = [['bt-diff-easy', 'Easy'], ['bt-diff-normal', 'Normal'], ['bt-diff-hard', 'Hard']];
	return [
		uiPanel(root, 'Beat Turntable Console', [DESK.x, 1.5, DESK.z + 0.5], 640, 420, 1.1, [
			{ type: 'uiElement', kind: 'container', flexDirection: 'column', gap: 6, padding: 12, width: 620, height: 400 },
			{ type: 'codeBlock', code }
		]),
		uiText('bt-title', root, 'Beat Turntable', 600, 48, 34, '#a78bfa'),
		uiText('bt-status', root, 'Place a disc on the turntable to play its song.', 600, 130, 24),
		uiText('bt-info', root, 'Blue saber: left side. Red saber: right side.', 600, 60, 20, '#a1a1aa'),
		createSlot({ id: 'bt-difficulty-row', parentId: root, name: 'Difficulty', components: [{ type: 'uiElement', kind: 'container', flexDirection: 'row', gap: 10, width: 600, height: 64 }] }),
		...buttons.map(([id, label]) =>
			createSlot({ id, parentId: 'bt-difficulty-row', name: label, components: [{ type: 'uiElement', kind: 'button', width: 190, height: 60, text: label, fontSize: 26, background: id === 'bt-diff-normal' ? '#7c3aed' : '#374151' }] })
		)
	];
}

function buildHud(): Slot[] {
	const root = BEAT_TURNTABLE.hudId;
	return [
		uiPanel(root, 'Score', [0, 2.35, 6.5], 800, 240, 2.2, [{ type: 'uiElement', kind: 'container', flexDirection: 'column', gap: 4, padding: 10, width: 780, height: 220 }]),
		uiText('bt-hud-score', root, '0', 760, 110, 84, '#f4f4f5'),
		uiText('bt-hud-combo', root, '', 760, 60, 40, '#facc15'),
		uiText('bt-hud-detail', root, '', 760, 40, 24, '#a1a1aa')
	];
}

function buildTurntable(): Slot[] {
	const { x, z, top } = DESK;
	const y = (above: number) => top + above;
	return [
		box('bt-desk', 'Desk', [x, top / 2 - 0.025, z], [1.3, top - 0.05, 0.8], '#1f2937', {}, true),
		box('bt-desk-top', 'Desk Top', [x, top - 0.025, z], [1.4, 0.05, 0.9], '#374151', {}, true),
		box('bt-plinth', 'Turntable Plinth', [x, y(0.04), z], [0.78, 0.08, 0.58], '#111827', {}, true),
		cylinder('bt-platter', 'Turntable Platter', [x, y(0.087), z], 0.36, 0.014, '#9ca3af'),
		cylinder('bt-mat', 'Turntable Mat', [x, y(0.096), z], 0.33, 0.004, '#171717'),
		box('bt-arm-base', 'Tonearm Base', [x + 0.27, y(0.1), z + 0.17], [0.05, 0.035, 0.05], '#d4d4d8'),
		box('bt-arm', 'Tonearm', [x + 0.17, y(0.12), z + 0.095], [0.01, 0.01, 0.25], '#e5e7eb', { rotation: [0, 0.4472, 0, 0.8944] }),
		cylinder('bt-led', 'Status LED', [x - 0.3, y(0.085), z - 0.2], 0.02, 0.01, '#22c55e'),
		// The socket is what makes the turntable a turntable: the disc sits at its origin, on the mat. The song is played by the
		// script (with a clock it can read), so the disc must not also play itself.
		createSlot({
			id: BEAT_TURNTABLE.socketId,
			name: 'Turntable Socket',
			position: [x, y(0.107), z],
			components: [{ type: 'socket', accepts: ['disc'], radius: 0.25, snap: { position: [0, 0, 0], rotation: [0, 0, 0] }, playMedia: false }]
		})
	];
}

/** The records on the shelf next to the turntable. Both are bundled songs, so the world needs no account or upload. */
function buildDiscs(): Slot[] {
	const { x, z, top } = DESK;
	const base = { y: top + 0.0065 };
	return [
		...buildDisc(
			{ id: 'bt-disc-1', title: 'Remembering a Heartbeat', author: 'Hampus Naeselius', labelColor: '#9f1239', source: { kind: 'url', url: '/audio/hampus-naeselius-remembering-a-heartbeat-epidemic-fantasy.mp3' } },
			{ position: [x - 0.45, base.y + 0.003, z + 0.25] }
		),
		...buildDisc(
			{ id: 'bt-disc-2', title: 'Ambient', author: 'Ambient 1', labelColor: '#0f766e', source: { kind: 'url', url: '/audio/ambient1.mp3' } },
			{ position: [x - 0.45, base.y + 0.003, z - 0.2] }
		)
	];
}

function buildStage(): Slot[] {
	const centre = BEAT_TURNTABLE.playerZ + BEAT_TURNTABLE.field / 2 + 1;
	return [
		createSlot({ id: 'bt-floor', name: 'Floor', position: [0, -0.05, 0], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#0b0f1a' }, { type: 'collider', shape: 'box' }] }),
		box('bt-rail-0', 'Lane Rail Left', [-0.9, 0.02, centre], [0.03, 0.03, 14], BLUE),
		box('bt-rail-1', 'Lane Rail Right', [0.9, 0.02, centre], [0.03, 0.03, 14], RED),
		box('bt-hit-line', 'Hit Line', [0, 0.02, BEAT_TURNTABLE.hitZ], [1.9, 0.01, 0.03], '#e5e7eb'),
		createSlot({ id: 'bt-back-wall', name: 'Back Wall', position: [0, 3, 17], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0a0a18' }], scale: [16, 6, 1] }),
		createSlot({
			id: BEAT_TURNTABLE.boardId,
			name: 'Leaderboard',
			position: [1.9, 1.5, 3.6],
			scale: [1.6, 0.933, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#081029' },
				{ type: 'scoreboard', title: 'Leaderboard', status: 'Insert a disc to see its best scores', columns: ['Score'], rows: [] }
			]
		})
	];
}

/** The script that runs the game, as the body of a code block: the shared rules first, then the game loop. */
export const BEAT_TURNTABLE_SCRIPT = `${LEVEL_LOGIC_SOURCE}
const SOCKET = '${BEAT_TURNTABLE.socketId}';
const BOARD = '${BEAT_TURNTABLE.boardId}';
const SABERS = ['bt-saber-0-blade', 'bt-saber-1-blade'];
const BUTTONS = { easy: 'bt-diff-easy', normal: 'bt-diff-normal', hard: 'bt-diff-hard' };
const BLADE_LENGTH = 0.9;
const HIT_Z = ${BEAT_TURNTABLE.hitZ};
const FIELD = ${BEAT_TURNTABLE.field};
const COL_X = ${JSON.stringify(BEAT_TURNTABLE.colX)};
const ROW_Y = ${JSON.stringify(BEAT_TURNTABLE.rowY)};
const POOL = ${BEAT_TURNTABLE.poolSize};
const HIT_WINDOW = 0.2;
const HIT_RADIUS = 0.2;
const MIN_SPEED = 1.1;
const MIN_ALIGNMENT = 0.3;
const COUNTDOWN = 6;
const COLORS = ['#2563eb', '#dc2626'];
const MAX_SONGS_SAVED = 60;

const set = (id, type, field, value, broadcast) => ctx.world.setComponentField(id, type, field, value, broadcast !== false);
const say = (id, value, broadcast) => set(id, 'uiElement', 'text', value, broadcast);
const noteSlot = (hand, index) => 'bt-note-' + hand + '-' + index;
const guard = (promise, label) => Promise.resolve(promise).catch((error) => ctx.log(label + ': ' + (error && error.message ? error.message : error)));

let ready = false;
let state = 'idle';
let session = 0;
let discId = '';
let player = null;
let difficulty = 'normal';
let disc = null;
let analysis = null;
let level = [];
let board = '';
let countdown = 0;
let lastShown = -1;
let clock = 0;
let track = null;
let nextSpawn = 0;
let active = [];
let free = [[], []];
let score = 0;
let combo = 0;
let bestCombo = 0;
let hits = 0;
let bad = 0;
let missed = 0;
let sabers = [null, null];

function readDisc(id) {
  const slot = id ? ctx.hierarchy.getSlot(id) : null;
  const audio = slot && slot.components.find((c) => c.type === 'audioPlayer');
  if (!slot || !audio || !audio.source) return null;
  const info = slot.components.find((c) => c.type === 'recordDisc');
  const title = info && info.title ? info.title : slot.name;
  const sourceKey = audio.source.kind === 'asset' ? audio.source.assetId : audio.source.url;
  return { id: id, title: title, source: audio.source, key: songKey(sourceKey, title) };
}

function socketOccupant() {
  const slot = ctx.hierarchy.getSlot(SOCKET);
  const socket = slot && slot.components.find((c) => c.type === 'socket');
  return (socket && socket.occupantId) || '';
}

function setStatus(text) { say('bt-status', text); }

function paintDifficulty() {
  for (const id of DIFFICULTY_IDS) set(BUTTONS[id], 'uiElement', 'background', id === difficulty ? '#7c3aed' : '#374151');
}

function showHud() {
  say('bt-hud-score', String(score), false);
  say('bt-hud-combo', combo > 1 ? 'x' + multiplierFor(combo) + '   combo ' + combo : '', false);
}

function showBoard() {
  if (!board || !ctx.leaderboards.available) return;
  set(BOARD, 'scoreboard', 'title', disc.title + ' - ' + DIFFICULTIES[difficulty].label);
  set(BOARD, 'scoreboard', 'status', '');
  guard(ctx.leaderboards.showOn(BOARD, board, { limit: 8 }), 'leaderboard');
}

function parkNote(hand, index) {
  const id = noteSlot(hand, index);
  ctx.world.setSlotEnabled(id, false, false);
}

function releaseNotes() {
  for (const entry of active) {
    parkNote(entry.hand, entry.index);
    free[entry.hand].push(entry.index);
  }
  active = [];
}

function stopPlay() {
  if (track) { track.stop(); track = null; }
  releaseNotes();
}

function init() {
  ready = true;
  for (let hand = 0; hand < 2; hand++) {
    for (let index = 0; index < POOL; index++) {
      parkNote(hand, index);
      free[hand].push(index);
    }
  }
  paintDifficulty();
}

function beginSession(id) {
  session += 1;
  const mine = session;
  stopPlay();
  disc = readDisc(id);
  if (!disc) { state = 'idle'; setStatus('This record cannot be played here.'); return; }
  state = 'analyzing';
  setStatus('Reading "' + disc.title + '"...');
  say('bt-info', 'Listening for the beat.');
  guard(ctx.audio.analyze(disc.source).then((result) => {
    if (mine !== session) return;
    analysis = result;
    buildLevel();
  }, (error) => {
    if (mine !== session) return;
    state = 'failed';
    ctx.log('analysis failed: ' + (error && error.message ? error.message : error));
    setStatus('Could not read this record. Take it off and try another.');
  }), 'session');
}

function buildLevel() {
  level = generateLevel(analysis, { seed: hashString(disc.key + difficulty), difficulty: difficulty });
  if (level.length < 8) {
    state = 'failed';
    setStatus('There are not enough beats in "' + disc.title + '" for this difficulty. Try a harder one.');
    return;
  }
  board = boardName(disc.key, difficulty);
  state = 'countdown';
  countdown = COUNTDOWN;
  lastShown = -1;
  const tempo = analysis.bpm ? Math.round(analysis.bpm) + ' BPM, ' : '';
  say('bt-info', tempo + level.length + ' blocks - ' + DIFFICULTIES[difficulty].label + '. Grab both sabers!');
  score = 0; combo = 0;
  showHud();
  showBoard();
}

function startPlay() {
  const mine = session;
  state = 'playing';
  clock = 0;
  nextSpawn = 0;
  score = 0; combo = 0; bestCombo = 0; hits = 0; bad = 0; missed = 0;
  sabers = [null, null];
  setStatus('"' + disc.title + '"');
  showHud();
  guard(ctx.audio.playTrack(disc.source, { volume: 0.9 }).then((handle) => {
    if (mine !== session || state !== 'playing') { handle.stop(); return; }
    track = handle;
  }, (error) => {
    if (mine !== session) return;
    state = 'failed';
    ctx.log('playback failed: ' + (error && error.message ? error.message : error));
    setStatus('The song could not be played.');
  }), 'playback');
}

function spawnNote(note) {
  const index = free[note.hand].pop();
  if (index === undefined) return;
  const id = noteSlot(note.hand, index);
  ctx.world.setSlotEnabled(id, true, false);
  // Enabling a slot switches its children on too: show the arrow or the dot, not both.
  ctx.world.setSlotEnabled(id + '-arrow', note.dir !== 8, false);
  ctx.world.setSlotEnabled(id + '-dot', note.dir === 8, false);
  const angle = note.dir === 8 ? 0 : noteAngle(note.dir);
  active.push({ note: note, hand: note.hand, index: index, id: id, x: COL_X[note.col], y: ROW_Y[note.row], rotation: ctx.math.quatFromAxisAngle([0, 0, 1], angle), placed: false });
}

function removeNote(entry) {
  parkNote(entry.hand, entry.index);
  free[entry.hand].push(entry.index);
  active.splice(active.indexOf(entry), 1);
}

function burstAt(position, color) {
  ctx.world.spawn({ name: 'Particle Burst', position: position, components: [{ type: 'particleBurst', color: color, count: 24, durationMs: 700 }, { type: 'expires', expiresAt: Date.now() + 700 }] });
}

function soundAt(position, frequency, volume) {
  ctx.world.spawn({ name: 'Impact Sound', position: position, components: [{ type: 'impactSound', frequency: frequency, pitchDrop: frequency * 0.4, noiseMix: 0.25, durationMs: 140, volume: volume }, { type: 'expires', expiresAt: Date.now() + 700 }] });
}

function trackSabers(dt) {
  for (let hand = 0; hand < 2; hand++) {
    const pose = ctx.hierarchy.getWorldPose(SABERS[hand]);
    if (!pose) { sabers[hand] = null; continue; }
    const half = BLADE_LENGTH / 2;
    const f = pose.forward;
    const base = [pose.position[0] - f[0] * half, pose.position[1] - f[1] * half, pose.position[2] - f[2] * half];
    const tip = [pose.position[0] + f[0] * half, pose.position[1] + f[1] * half, pose.position[2] + f[2] * half];
    const before = sabers[hand];
    let velocity = [0, 0, 0];
    if (before && dt > 0.0005) velocity = [(tip[0] - before.tip[0]) / dt, (tip[1] - before.tip[1]) / dt, (tip[2] - before.tip[2]) / dt];
    // A little smoothing: one frame's jitter must not decide a cut.
    if (before) velocity = velocity.map((v, i) => v * 0.6 + before.velocity[i] * 0.4);
    sabers[hand] = { base: base, tip: tip, velocity: velocity, speed: Math.hypot(velocity[0], velocity[1], velocity[2]) };
  }
}

function cut(entry, position, accuracy) {
  const points = cutPoints(accuracy, combo);
  score += points;
  combo += 1;
  hits += 1;
  if (combo > bestCombo) bestCombo = combo;
  burstAt(position, COLORS[entry.hand]);
  soundAt(position, 480 + Math.min(combo, 20) * 14, 0.5);
  removeNote(entry);
  showHud();
}

function fail(entry, position, wrongCut) {
  combo = 0;
  if (wrongCut) bad += 1; else missed += 1;
  soundAt(position, 130, 0.4);
  removeNote(entry);
  showHud();
}

function play(dt) {
  clock += dt;
  const now = track ? track.time() : clock;
  const settings = DIFFICULTIES[difficulty];
  while (nextSpawn < level.length && level[nextSpawn].t - now <= settings.travel) spawnNote(level[nextSpawn++]);
  trackSabers(dt);
  const speed = FIELD / settings.travel;
  for (let i = active.length - 1; i >= 0; i--) {
    const entry = active[i];
    const untilHit = entry.note.t - now;
    const position = [entry.x, entry.y, HIT_Z + untilHit * speed];
    ctx.world.setWorldPose(entry.id, entry.placed ? { position: position } : { position: position, rotation: entry.rotation }, false);
    entry.placed = true;
    if (untilHit < -HIT_WINDOW) { fail(entry, position, false); continue; }
    if (Math.abs(untilHit) > HIT_WINDOW) continue;
    for (let hand = 0; hand < 2; hand++) {
      const saber = sabers[hand];
      if (!saber || saber.speed < MIN_SPEED) continue;
      if (distanceToSegment(position, saber.base, saber.tip) > HIT_RADIUS) continue;
      const alignment = cutAlignment([saber.velocity[0], saber.velocity[1]], entry.note.dir);
      if (hand === entry.note.hand && alignment >= MIN_ALIGNMENT) {
        const timing = Math.max(0, 1 - Math.abs(untilHit) / HIT_WINDOW);
        cut(entry, position, timing * 0.6 + Math.max(0, alignment) * 0.4);
      } else {
        fail(entry, position, true);
      }
      break;
    }
  }
  const finished = nextSpawn >= level.length && active.length === 0;
  if (finished && (now > level[level.length - 1].t + 1 || (track && track.ended))) finish();
}

async function saveResult(mine, result) {
  if (!player) return 'Scores are not saved here.';
  if (!ctx.leaderboards.available && !ctx.storage.available) return 'Scores are not saved: sign in and publish the world to keep them.';
  let line = '';
  await ctx.leaderboards.submit(board, player, result.score, { order: 'high' });
  if (mine !== session) return '';
  const handle = ctx.storage.player(player);
  const songs = await handle.get('songs', {});
  const key = disc.key + '-' + difficulty;
  const before = songs[key] || { best: 0, combo: 0, plays: 0 };
  line = result.score > before.best ? 'New personal best!' : 'Your best: ' + before.best;
  songs[key] = { best: Math.max(before.best, result.score), combo: Math.max(before.combo, result.combo), plays: before.plays + 1, at: Date.now() };
  const keys = Object.keys(songs);
  if (keys.length > MAX_SONGS_SAVED) {
    keys.sort((a, b) => songs[a].at - songs[b].at);
    for (const old of keys.slice(0, keys.length - MAX_SONGS_SAVED)) delete songs[old];
  }
  await handle.set('songs', songs);
  if (mine === session) showBoard();
  return line;
}

function finish() {
  const mine = session;
  state = 'results';
  stopPlay();
  const perfect = maxScore(level.length);
  const result = { score: Math.min(score, perfect), combo: bestCombo };
  const ratio = perfect > 0 ? result.score / perfect : 0;
  const summary = 'Rank ' + rankFor(ratio) + ' - ' + result.score + ' points';
  setStatus(summary);
  say('bt-info', hits + ' of ' + level.length + ' cut, ' + (missed + bad) + ' missed. Best combo ' + bestCombo + '. Take the record off to stop.');
  say('bt-hud-detail', Math.round(ratio * 100) + '% of a perfect run', false);
  guard(saveResult(mine, result).then((line) => { if (mine === session && line) setStatus(summary + '\\n' + line); }), 'save');
}

function chooseDifficulty(id) {
  if (!BUTTONS[id] || state === 'playing') return;
  difficulty = id;
  paintDifficulty();
  if (player) guard(ctx.storage.player(player).set('difficulty', id), 'save difficulty');
  if (discId && state !== 'analyzing') beginSession(discId);
}

return {
  async onPlayerReady(who) {
    if (player) return;
    player = who;
    try {
      const saved = await ctx.storage.player(who).get('difficulty', 'normal');
      if (saved !== difficulty && DIFFICULTIES[saved] && state !== 'playing') { difficulty = saved; paintDifficulty(); }
    } catch (error) {
      ctx.log('storage: ' + (error && error.message ? error.message : error));
    }
  },
  onUIEvent(event) {
    if (event.type !== 'press') return;
    for (const id of DIFFICULTY_IDS) if (event.slotId === BUTTONS[id]) chooseDifficulty(id);
  },
  tick(dt) {
    if (!ready) init();
    const occupant = socketOccupant();
    if (occupant !== discId) {
      discId = occupant;
      if (occupant) beginSession(occupant);
      else {
        session += 1;
        stopPlay();
        state = 'idle';
        disc = null;
        setStatus('Place a disc on the turntable to play its song.');
        say('bt-info', 'Blue saber: left side. Red saber: right side.');
        say('bt-hud-detail', '', false);
        score = 0; combo = 0;
        showHud();
      }
    }
    if (state === 'countdown') {
      countdown -= dt;
      const shown = Math.ceil(countdown);
      if (shown !== lastShown) { lastShown = shown; if (shown > 0) setStatus('"' + disc.title + '"\\nStarting in ' + shown); }
      if (countdown <= 0) startPlay();
    } else if (state === 'playing') {
      play(dt);
    }
  }
};
`;

/** The Beat Turntable world: a stage, a control desk with the turntable and sabers, and the script that plays it. */
export function buildBeatTurntable(): SlotTree {
	return [
		...buildStage(),
		...buildTurntable(),
		...buildDiscs(),
		...buildSaberRack(),
		...buildConsole(BEAT_TURNTABLE_SCRIPT),
		...buildHud(),
		...buildNotes()
	];
}

function buildNotes(): Slot[] {
	const notes: Slot[] = [];
	for (const hand of [0, 1] as const) for (let index = 0; index < BEAT_TURNTABLE.poolSize; index++) notes.push(...buildNote(hand, index));
	return notes;
}

function buildSaberRack(): Slot[] {
	return [
		box('bt-rack', 'Saber Rack', [DESK.x, 0.92, 1.7], [0.7, 0.03, 0.7], '#1f2937', {}, true),
		...buildSaber(0),
		...buildSaber(1)
	];
}
