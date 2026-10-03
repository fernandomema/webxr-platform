import type { Slot, SlotTree } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { LEVEL_LOGIC_SOURCE } from './beatTurntableLogic.ts';
import { BEAT_TURNTABLE, BLUE, RED, box } from './beatTurntableParts.ts';
import { STAGE_FX_SOURCE, buildStageSlots } from './beatTurntableStage.ts';
import { buildDeckSlots } from './beatTurntableDesk.ts';
import { OPTION_BUTTONS, UI, buildConsole, buildHud, buildJudge, buildResults } from './beatTurntableUi.ts';

/**
 * Beat Turntable: a rhythm game in the spirit of Beat Saber that is started with a record. Put a disc on the turntable and the
 * world reads its song (`ctx.audio.analyze`), builds a level from where the music hits (see beatTurntableLogic.ts) and plays the
 * song (`ctx.audio.playTrack`) while blocks fly towards you: cut each one with the saber of its colour, in the direction of its
 * arrow. Scores go to a leaderboard per song and difficulty and to the player's saved stats (`ctx.leaderboards`, `ctx.storage`).
 *
 * The player stands at (0, 0, 2), facing +Z, as the desktop camera does. Blocks come from far +Z to the hit line at z = 2.75.
 * The turntable and the record rack are to the left; the leaderboard is to the right, with the sabers on a stand under it. The
 * score board floats above the lane, a result screen opens in front of the player when a song ends, and the stage around the
 * lane (beatTurntableStage.ts) moves only while the song plays.
 *
 * Everything game-specific lives in these files; the engine only provides the generic audio, storage, leaderboard and UI
 * APIs the script calls.
 */

export { BEAT_TURNTABLE };

const WHITE = '#f8fafc';

/** One block of a hand's pool. Parked out of sight and switched off until the script gives it a note. */
function buildNote(hand: 0 | 1, index: number): Slot[] {
	const id = `bt-note-${hand}-${index}`;
	const color = hand === 0 ? BLUE : RED;
	return [
		// The engine flies it: the script gives it a `velocity` when it enters the lane.
		box(id, `Note ${hand}-${index}`, [0, -50, 0], [0.28, 0.28, 0.28], color, { components: [{ type: 'velocity', linear: [0, 0, 0] }] }),
		// Children are in the cube's own units: the arrow is a bar on the front face pointing up, the dot is for any direction.
		box(`${id}-arrow`, 'Note Arrow', [0, 0.12, -0.52], [0.16, 0.5, 0.06], WHITE, { parentId: id }),
		box(`${id}-dot`, 'Note Dot', [0, 0, -0.52], [0.3, 0.3, 0.06], WHITE, { parentId: id }),
		box(`${id}-glow`, 'Note Glow', [0, 0, 0], [1.35, 1.35, 1.35], color, { parentId: id }, false, 0.22)
	];
}

function buildNotes(): Slot[] {
	const notes: Slot[] = [];
	for (const hand of [0, 1] as const) for (let index = 0; index < BEAT_TURNTABLE.poolSize; index++) notes.push(...buildNote(hand, index));
	return notes;
}

/** The leaderboard of the song on the turntable, on a framed board to the right of the lane. */
function buildBoard(): Slot[] {
	return [
		box('bt-board-frame', 'Leaderboard Frame', [1.9, 1.5, 3.63], [1.72, 1.05, 0.04], '#2a3a78'),
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
${STAGE_FX_SOURCE}
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
const TRACK_WIDTH = ${UI.trackWidth};
const ARM_PLAYING = 0.62;
const DISC_SPIN = 3.49;
const MULT_COLORS = { 1: '#ffffff', 2: '#60a5fa', 4: '#c084fc', 8: '#facc15' };
const RANK_COLORS = { S: '#facc15', A: '#4ade80', B: '#60a5fa', C: '#fb923c', D: '#f87171' };

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
let hudTimer = 0;
let shownScore = 0;
let judgeTimer = 0;
let songBest = 0;
let armAngle = 0;
let discAngle = 0;
const hudCache = {};
let cues = [];
let cueClock = 0;

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

const fmt = (n) => String(Math.round(n)).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');

/** Writes a uiElement field on this peer, only when it is not already what is shown (every write redraws the panel). */
function hud(id, field, value) {
  const key = id + '.' + field;
  if (hudCache[key] === value) return;
  hudCache[key] = value;
  set(id, 'uiElement', field, value, false);
}

function accuracyNow() {
  const judged = hits + bad + missed;
  return judged ? Math.min(1, score / maxScore(judged)) : 1;
}

/** The score board while a song is on: the score counts up to its value, the rest follows the game. */
function flushHud(dt, force) {
  hudTimer += dt;
  if (!force && hudTimer < 0.08) return;
  hudTimer = 0;
  if (score < shownScore) shownScore = score;
  else if (shownScore < score) shownScore += Math.max(1, Math.ceil((score - shownScore) * 0.35));
  const mult = multiplierFor(combo);
  const accuracy = accuracyNow();
  hud('bt-hud-score', 'text', fmt(shownScore));
  hud('bt-hud-combo', 'text', String(combo));
  hud('bt-hud-combo', 'color', MULT_COLORS[mult]);
  hud('bt-hud-mult', 'text', 'x' + mult);
  hud('bt-hud-mult', 'color', MULT_COLORS[mult]);
  hud('bt-hud-detail', 'text', Math.round(accuracy * 100) + '%');
  const rank = state === 'playing' && hits + bad + missed > 0 ? rankFor(accuracy) : '';
  hud('bt-hud-rank', 'text', rank ? 'RANK ' + rank : '');
  if (rank) hud('bt-hud-rank', 'color', RANK_COLORS[rank]);
  const length = analysis && analysis.duration ? analysis.duration : 0;
  const position = state === 'playing' && track && length ? Math.min(1, track.time() / length) : state === 'results' ? 1 : 0;
  hud('bt-hud-fill', 'width', Math.round(TRACK_WIDTH * position));
}

function showHud() {
  flushHud(0, true);
}

function resetHud() {
  shownScore = 0;
  songBest = 0;
  hud('bt-hud-best', 'text', '');
  hud('bt-hud-title', 'text', 'Beat Turntable');
  hud('bt-judge-text', 'text', '');
  showHud();
}

function judge(text, color) {
  hud('bt-judge-text', 'text', text);
  hud('bt-judge-text', 'color', color);
  judgeTimer = 0.55;
}

/** What the score board keeps showing once the song is over: the final numbers, with the full bar. */
function freezeHud(result, ratio) {
  const rank = rankFor(ratio);
  shownScore = result.score;
  hud('bt-hud-score', 'text', fmt(result.score));
  hud('bt-hud-detail', 'text', Math.round(ratio * 100) + '%');
  hud('bt-hud-rank', 'text', 'RANK ' + rank);
  hud('bt-hud-rank', 'color', RANK_COLORS[rank]);
  hud('bt-hud-fill', 'width', TRACK_WIDTH);
}

const RESULT_TITLES = { S: 'PERFECT RUN', A: 'SONG CLEARED', B: 'SONG CLEARED', C: 'SONG CLEARED', D: 'TRY AGAIN' };

function hideResults() {
  cues = [];
  ctx.world.setSlotEnabled('bt-results', false, false);
}

/** The result screen: the rank, the score, the numbers of the run, and the jingle that goes with them. */
function showResults(result, ratio) {
  const rank = rankFor(ratio);
  const colour = RANK_COLORS[rank];
  hud('bt-res-title', 'text', RESULT_TITLES[rank]);
  hud('bt-res-title', 'color', colour);
  hud('bt-res-song', 'text', disc.title + '   -   ' + DIFFICULTIES[difficulty].label);
  hud('bt-res-rank', 'text', rank);
  hud('bt-res-rank', 'color', colour);
  hud('bt-res-score', 'text', fmt(result.score));
  hud('bt-res-best', 'text', '');
  hud('bt-res-acc', 'text', Math.round(ratio * 100) + '%');
  hud('bt-res-combo', 'text', String(result.combo));
  hud('bt-res-cuts', 'text', hits + ' / ' + level.length);
  hud('bt-res-missed', 'text', String(missed + bad));
  hud('bt-res-missed', 'color', missed + bad === 0 ? '#4ade80' : '#f87171');
  hud('bt-res-footer', 'text', player && (ctx.leaderboards.available || ctx.storage.available) ? 'Saving your score...' : 'Scores are not saved here.');
  ctx.world.setSlotEnabled('bt-results', true, false);
  playJingle(rank);
}

/** The win sound, as notes of the synthesised percussive sound (a pluck each): a rising arpeggio and a chord, a sad slide for a poor run. */
function playJingle(rank) {
  const tone = (t, f, d, v) => cues.push({ t: t, kind: 'tone', f: f, d: d, v: v });
  const spark = (t, x, color) => cues.push({ t: t, kind: 'burst', x: x, color: color });
  cueClock = 0;
  if (rank === 'D') {
    tone(0, 392, 500, 0.5); tone(0.28, 349, 500, 0.5); tone(0.56, 311, 500, 0.5); tone(0.9, 262, 900, 0.5);
    return;
  }
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => tone(i * 0.13, f, 420, 0.5));
  [784, 1047, 1319].forEach((f) => tone(0.62, f, 1100, 0.55));
  if (rank === 'S' || rank === 'A') {
    [1319, 1568, 2093, 1568, 2093, 2637].forEach((f, i) => tone(0.95 + i * 0.09, f, 500, 0.35));
  }
  const colour = RANK_COLORS[rank];
  spark(0.62, -0.9, colour); spark(0.62, 0.9, colour);
  if (rank === 'S') { spark(0.95, -1.2, '#facc15'); spark(1.1, 1.2, '#facc15'); spark(1.25, 0, '#ffffff'); }
}

function runCues(dt) {
  if (!cues.length) return;
  cueClock += dt;
  while (cues.length && cues[0].t <= cueClock) {
    const cue = cues.shift();
    if (cue.kind === 'tone') soundAt([0, 1.6, 3.4], cue.f, cue.v, cue.d);
    else burstAt([cue.x, 2.3, 4.4], cue.color);
  }
}

async function loadBest(mine) {
  songBest = 0;
  if (!player) return;
  try {
    const songs = await ctx.storage.player(player).get('songs', {});
    const entry = songs[disc.key + '-' + difficulty];
    songBest = entry ? entry.best : 0;
  } catch (error) {
    ctx.log('storage: ' + (error && error.message ? error.message : error));
  }
  if (mine === session) hud('bt-hud-best', 'text', songBest ? 'BEST ' + fmt(songBest) : '');
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
  set(id, 'velocity', 'linear', [0, 0, 0], false);
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
  paintOptions();
  fxApplyEffects();
  hideResults();
}

function beginSession(id) {
  session += 1;
  const mine = session;
  stopPlay();
  fxRestart();
  hideResults();
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
  score = 0; combo = 0; hits = 0; bad = 0; missed = 0;
  hud('bt-hud-title', 'text', disc.title + '   -   ' + DIFFICULTIES[difficulty].label);
  hud('bt-judge-text', 'text', '');
  shownScore = 0;
  showHud();
  showBoard();
  loadBest(session);
}

function startPlay() {
  const mine = session;
  state = 'playing';
  clock = 0;
  nextSpawn = 0;
  score = 0; combo = 0; bestCombo = 0; hits = 0; bad = 0; missed = 0;
  sabers = [null, null];
  fxRestart();
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

/**
 * Puts a block on the lane and sets it flying: the engine moves it from here on (a \`velocity\`, towards the player at the
 * lane's speed), so the script only needs to know where it is, which it works out from the song's clock.
 */
function spawnNote(note, now, dt, speed) {
  const index = free[note.hand].pop();
  if (index === undefined) return;
  const id = noteSlot(note.hand, index);
  ctx.world.setSlotEnabled(id, true, false);
  // Enabling a slot switches its children on too: show the arrow or the dot, not both, and the glow only if it is wanted.
  ctx.world.setSlotEnabled(id + '-arrow', note.dir !== 8, false);
  ctx.world.setSlotEnabled(id + '-dot', note.dir === 8, false);
  ctx.world.setSlotEnabled(id + '-glow', !!fx.on.glow, false);
  const angle = note.dir === 8 ? 0 : noteAngle(note.dir);
  const x = COL_X[note.col], y = ROW_Y[note.row];
  // The engine moves it by one frame before it is drawn, so it starts one frame early.
  ctx.world.setWorldPose(id, { position: [x, y, HIT_Z + (note.t - now - dt) * speed], rotation: ctx.math.quatFromAxisAngle([0, 0, 1], angle) }, false);
  set(id, 'velocity', 'linear', [0, 0, -speed], false);
  active.push({ note: note, hand: note.hand, index: index, id: id, x: x, y: y });
}

function removeNote(entry) {
  parkNote(entry.hand, entry.index);
  free[entry.hand].push(entry.index);
  active.splice(active.indexOf(entry), 1);
}

function burstAt(position, color) {
  if (!fx.on.sparks) return;
  ctx.world.spawn({ name: 'Particle Burst', position: position, components: [{ type: 'particleBurst', color: color, count: 14, durationMs: 700 }, { type: 'expires', expiresAt: Date.now() + 700 }] });
}

function soundAt(position, frequency, volume, durationMs) {
  const length = durationMs || 140;
  ctx.world.spawn({ name: 'Impact Sound', position: position, components: [{ type: 'impactSound', frequency: frequency, pitchDrop: durationMs ? 0 : frequency * 0.4, noiseMix: durationMs ? 0.04 : 0.25, durationMs: length, volume: volume }, { type: 'expires', expiresAt: Date.now() + length + 600 }] });
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
  fxHit(entry.hand);
  if (combo % 25 === 0) judge('COMBO ' + combo, '#facc15');
  else if (accuracy >= 0.9) judge('PERFECT', '#facc15');
  else if (accuracy >= 0.7) judge('GREAT', '#4ade80');
  else judge('GOOD', '#60a5fa');
}

function fail(entry, position, wrongCut) {
  combo = 0;
  if (wrongCut) bad += 1; else missed += 1;
  soundAt(position, 130, 0.4);
  removeNote(entry);
  if (wrongCut) judge('BAD CUT', '#f87171');
  else judge('MISS', '#fb7185');
}

function play(dt) {
  clock += dt;
  const now = track ? track.time() : clock;
  const settings = DIFFICULTIES[difficulty];
  const speed = FIELD / settings.travel;
  while (nextSpawn < level.length && level[nextSpawn].t - now <= settings.travel) spawnNote(level[nextSpawn++], now, dt, speed);
  trackSabers(dt);
  for (let i = active.length - 1; i >= 0; i--) {
    const entry = active[i];
    const untilHit = entry.note.t - now;
    const position = [entry.x, entry.y, HIT_Z + untilHit * speed];
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
  if (!player) return { line: 'Scores are not saved here.' };
  if (!ctx.leaderboards.available && !ctx.storage.available) return { line: 'Scores are not saved: sign in and publish the world to keep them.' };
  await ctx.leaderboards.submit(board, player, result.score, { order: 'high' });
  if (mine !== session) return null;
  let rank = 0;
  try {
    const mineBest = await ctx.leaderboards.best(board, player);
    rank = mineBest ? mineBest.rank : 0;
  } catch (error) {
    ctx.log('rank: ' + (error && error.message ? error.message : error));
  }
  const handle = ctx.storage.player(player);
  const songs = await handle.get('songs', {});
  const key = disc.key + '-' + difficulty;
  const before = songs[key] || { best: 0, combo: 0, plays: 0 };
  const isBest = result.score > before.best;
  if (isBest) hud('bt-hud-best', 'text', 'NEW BEST!');
  songs[key] = { best: Math.max(before.best, result.score), combo: Math.max(before.combo, result.combo), plays: before.plays + 1, at: Date.now() };
  const keys = Object.keys(songs);
  if (keys.length > MAX_SONGS_SAVED) {
    keys.sort((a, b) => songs[a].at - songs[b].at);
    for (const old of keys.slice(0, keys.length - MAX_SONGS_SAVED)) delete songs[old];
  }
  await handle.set('songs', songs);
  if (mine === session) showBoard();
  return { line: isBest ? 'New personal best!' : 'Your best: ' + before.best, isBest: isBest, best: before.best, rank: rank, plays: before.plays + 1 };
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
  freezeHud(result, ratio);
  showResults(result, ratio);
  say('bt-info', hits + ' of ' + level.length + ' cut, ' + (missed + bad) + ' missed. Best combo ' + bestCombo + '. Take the record off to stop.');
  guard(saveResult(mine, result).then((info) => {
    if (mine !== session || !info) return;
    setStatus(summary + '\\n' + info.line);
    hud('bt-res-best', 'text', info.isBest ? 'NEW PERSONAL BEST!' : info.best ? 'Personal best: ' + fmt(info.best) : '');
    hud('bt-res-best', 'color', info.isBest ? '#facc15' : '#94a3b8');
    const place = info.rank ? 'Leaderboard rank #' + info.rank + '   -   ' : info.isBest === undefined ? info.line + '   -   ' : '';
    hud('bt-res-footer', 'text', place + 'Take the record off to pick another song');
  }), 'save');
}

function chooseDifficulty(id) {
  if (!BUTTONS[id] || state === 'playing') return;
  difficulty = id;
  paintDifficulty();
  if (player) guard(ctx.storage.player(player).set('difficulty', id), 'save difficulty');
  if (discId && state !== 'analyzing') beginSession(discId);
}

// The buttons of the control screen, in the order of the effects: button id and name.
const OPTIONS = {};
${JSON.stringify(OPTION_BUTTONS)}.forEach((button, index) => { OPTIONS[FX_EFFECTS[index]] = button; });
const LITE = { tunnel: true, grid: true, sun: true, towers: false, lasers: false, glow: false, sparks: false, lights: false };

function paintOptions() {
  for (const key of FX_EFFECTS) {
    const on = !!fx.on[key];
    hud(OPTIONS[key][0], 'text', OPTIONS[key][1] + (on ? '  ON' : '  OFF'));
    hud(OPTIONS[key][0], 'background', on ? '#2563eb' : '#1e293b');
    hud(OPTIONS[key][0], 'color', on ? '#ffffff' : '#64748b');
  }
}

/** Switches effects on or off (a map of name to boolean) and, from the buttons, remembers the choice for this player. */
function setEffects(next, save) {
  for (const key of FX_EFFECTS) if (typeof next[key] === 'boolean') fx.on[key] = next[key];
  fxApplyEffects();
  paintOptions();
  if (save && player) guard(ctx.storage.player(player).set('effects', Object.assign({}, fx.on)), 'save effects');
}

function pressOption(slotId) {
  for (const key of FX_EFFECTS) if (OPTIONS[key][0] === slotId) { setEffects({ [key]: !fx.on[key] }, true); return true; }
  if (slotId === 'bt-opt-all') { setEffects(Object.fromEntries(FX_EFFECTS.map((key) => [key, true])), true); return true; }
  if (slotId === 'bt-opt-lite') { setEffects(LITE, true); return true; }
  if (slotId === 'bt-opt-off') { setEffects(Object.fromEntries(FX_EFFECTS.map((key) => [key, false])), true); return true; }
  return false;
}

/** The turntable at work: the record spins, the arm comes down onto it and the light turns red while a song is on. */
function deckTick(dt) {
  const busy = state === 'analyzing' || state === 'countdown' || state === 'playing';
  const target = busy ? ARM_PLAYING : 0;
  if (Math.abs(target - armAngle) > 0.002) {
    armAngle += (target - armAngle) * Math.min(1, dt * 2.5);
    ctx.world.setWorldPose('bt-arm-pivot', { rotation: ctx.math.quatFromAxisAngle([0, 1, 0], armAngle) }, false);
  }
  if (busy && discId) {
    discAngle = (discAngle + dt * DISC_SPIN) % (Math.PI * 2);
    ctx.world.setWorldPose(discId, { rotation: ctx.math.quatFromAxisAngle([0, 1, 0], discAngle) }, false);
  }
  fxColor('bt-led', busy ? '#ef4444' : '#22c55e');
}

return {
  async onPlayerReady(who) {
    if (player) return;
    player = who;
    try {
      const saved = await ctx.storage.player(who).get('difficulty', 'normal');
      if (saved !== difficulty && DIFFICULTIES[saved] && state !== 'playing') { difficulty = saved; paintDifficulty(); }
      const effects = await ctx.storage.player(who).get('effects', null);
      if (effects && typeof effects === 'object') setEffects(effects, false);
    } catch (error) {
      ctx.log('storage: ' + (error && error.message ? error.message : error));
    }
  },
  onUIEvent(event) {
    if (event.type !== 'press') return;
    if (pressOption(event.slotId)) return;
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
        score = 0; combo = 0; hits = 0; bad = 0; missed = 0;
        analysis = null;
        hideResults();
        resetHud();
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
    fxTick(dt);
    deckTick(dt);
    runCues(dt);
    if (state !== 'results') flushHud(dt, false);
    if (judgeTimer > 0) {
      judgeTimer -= dt;
      if (judgeTimer <= 0) hud('bt-judge-text', 'text', '');
    }
  }
};
`;

/** The Beat Turntable world: the stage, the deck with the turntable, rack and sabers, the panels, and the script that plays it. */
export function buildBeatTurntable(): SlotTree {
	return [...buildStageSlots(), ...buildDeckSlots(), ...buildBoard(), ...buildConsole(BEAT_TURNTABLE_SCRIPT), ...buildHud(), ...buildJudge(), ...buildResults(), ...buildNotes()];
}
