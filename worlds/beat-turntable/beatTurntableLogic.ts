/**
 * The rules of the Beat Turntable world, as plain JavaScript that has no dependency on the engine: turning the onsets of
 * a song into a level, scoring, ranks and the leaderboard key of a song. A world's code block cannot import modules, so
 * the rules live in one source string that the world's script embeds, and `loadLevelLogic` evaluates the very same text for
 * tests and tools. Everything here is deterministic: the same song and difficulty always give the same level.
 *
 * Coordinates are the player's: x grows to their right, y up. A note is `{ id, t, hand, col, row, dir }`:
 *   hand 0 is the blue saber (left side of the lane), hand 1 the red one (right side);
 *   col 0-3 from left to right, row 0-2 from low to high;
 *   dir is the cut direction: 0 up, 1 down, 2 left, 3 right, 4 up-left, 5 up-right, 6 down-left, 7 down-right, 8 any.
 */
export const LEVEL_LOGIC_SOURCE = `
const DIFFICULTIES = {
  easy:   { label: 'Easy',   minGap: 0.45, minStrength: 0.55, bands: ['low', 'mid'],         pairs: false, travel: 1.9, dirs: [0, 1],            rows: [0.8, 1, 1] },
  normal: { label: 'Normal', minGap: 0.28, minStrength: 0.40, bands: ['low', 'mid', 'high'], pairs: true,  travel: 1.6, dirs: [0, 1, 4, 5, 6, 7], rows: [0.6, 0.95, 1] },
  hard:   { label: 'Hard',   minGap: 0.17, minStrength: 0.28, bands: ['low', 'mid', 'high'], pairs: true,  travel: 1.35, dirs: [0, 1, 2, 3, 4, 5, 6, 7], rows: [0.5, 0.85, 1] }
};
const DIFFICULTY_IDS = ['easy', 'normal', 'hard'];
const FIRST_NOTE_AT = 2;
const POINTS_BASE = 100;
const POINTS_ACCURACY = 15;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A short stable id of a song: from where its audio comes from and its title. */
function songKey(sourceKey, title) {
  return hashString(String(sourceKey) + '|' + String(title)).toString(36);
}

/** Leaderboard name of a song at a difficulty: letters, digits and dashes, always well under 64 characters. */
function boardName(key, difficulty) {
  return 'song-' + String(key).replace(/[^A-Za-z0-9]/g, '').slice(0, 12) + '-' + difficulty;
}

function cutVector(dir) {
  switch (dir) {
    case 0: return [0, 1];
    case 1: return [0, -1];
    case 2: return [-1, 0];
    case 3: return [1, 0];
    case 4: return [-Math.SQRT1_2, Math.SQRT1_2];
    case 5: return [Math.SQRT1_2, Math.SQRT1_2];
    case 6: return [-Math.SQRT1_2, -Math.SQRT1_2];
    case 7: return [Math.SQRT1_2, -Math.SQRT1_2];
    default: return [0, 0];
  }
}

/** Rotation about the lane axis that turns a note's arrow (drawn pointing up) towards its cut direction. */
function noteAngle(dir) {
  const v = cutVector(dir);
  return Math.atan2(-v[0], v[1]);
}

function generateLevel(analysis, options) {
  const settings = DIFFICULTIES[options && options.difficulty] || DIFFICULTIES.normal;
  const rand = mulberry32((options && options.seed) || 1);
  const duration = analysis.duration || 0;
  const onsets = (analysis.onsets || []).filter(function (o) {
    return settings.bands.indexOf(o.band) >= 0 && o.strength >= settings.minStrength && o.t >= FIRST_NOTE_AT && o.t <= duration - 0.5;
  });
  // Onsets of different bands within 50 ms are one musical event.
  const events = [];
  for (const o of onsets) {
    const last = events[events.length - 1];
    if (last && o.t - last.t < 0.05) last.items.push(o);
    else events.push({ t: o.t, items: [o] });
  }
  const notes = [];
  const lastVertical = [1, 1];
  let lastHand = 1;
  let lastT = -Infinity;
  const pick = function (list) { return list[Math.floor(rand() * list.length)]; };
  const direction = function (hand) {
    // A swing up is followed by a swing down and the other way round, so it can always be played.
    const wantUp = lastVertical[hand] === 1;
    const pool = settings.dirs.filter(function (d) {
      if (d === 2 || d === 3) return true;
      return wantUp ? (d === 0 || d === 4 || d === 5) : (d === 1 || d === 6 || d === 7);
    });
    const chosen = pick(pool.length ? pool : settings.dirs);
    const v = cutVector(chosen);
    if (v[1] !== 0) lastVertical[hand] = v[1] > 0 ? 0 : 1;
    return chosen;
  };
  const row = function () {
    const r = rand();
    return r < settings.rows[0] ? 0 : r < settings.rows[1] ? 1 : 2;
  };
  const place = function (t, hand) {
    const cols = hand === 0 ? [0, 1] : [2, 3];
    notes.push({ id: notes.length, t: t, hand: hand, col: pick(cols), row: row(), dir: direction(hand) });
  };
  for (const event of events) {
    if (event.t - lastT < settings.minGap) continue;
    const bands = event.items.map(function (o) { return o.band; });
    const hasLow = bands.indexOf('low') >= 0;
    const hasHigh = bands.indexOf('high') >= 0;
    if (settings.pairs && hasLow && hasHigh) {
      place(event.t, 0);
      place(event.t, 1);
      lastHand = 1;
    } else {
      const hand = hasLow ? 0 : hasHigh ? 1 : 1 - lastHand;
      place(event.t, hand);
      lastHand = hand;
    }
    lastT = event.t;
  }
  // Two notes in the same cell at the same moment cannot happen: pairs use different columns, and events are at least minGap apart.
  return notes;
}

function multiplierFor(combo) {
  return combo >= 14 ? 8 : combo >= 6 ? 4 : combo >= 2 ? 2 : 1;
}

/** Points of one cut: a base for the cut itself plus up to 15 for timing, times the combo multiplier. */
function cutPoints(accuracy, comboBefore) {
  return (POINTS_BASE + Math.round(POINTS_ACCURACY * Math.max(0, Math.min(1, accuracy)))) * multiplierFor(comboBefore);
}

/** The score of a perfect run of that many notes: what a player's score is measured against. */
function maxScore(count) {
  let total = 0;
  for (let combo = 0; combo < count; combo++) total += cutPoints(1, combo);
  return total;
}

function rankFor(ratio) {
  return ratio >= 0.95 ? 'S' : ratio >= 0.85 ? 'A' : ratio >= 0.7 ? 'B' : ratio >= 0.5 ? 'C' : 'D';
}

/** How well a swing matches a cut direction: 1 along it, 0 across it, negative against it. 'Any' accepts every direction. */
function cutAlignment(swing, dir) {
  if (dir === 8) return 1;
  const v = cutVector(dir);
  const length = Math.hypot(swing[0], swing[1]);
  if (length < 1e-6) return 0;
  return (swing[0] * v[0] + swing[1] * v[1]) / length;
}

/** Distance from a point to a segment, in 3D. */
function distanceToSegment(p, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const lengthSq = abx * abx + aby * aby + abz * abz;
  let s = lengthSq > 0 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / lengthSq : 0;
  s = Math.max(0, Math.min(1, s));
  return Math.hypot(a[0] + abx * s - p[0], a[1] + aby * s - p[1], a[2] + abz * s - p[2]);
}
`;

export interface Note {
	id: number;
	t: number;
	hand: 0 | 1;
	col: number;
	row: number;
	dir: number;
}

export interface LevelOnset {
	t: number;
	strength: number;
	band: 'low' | 'mid' | 'high';
}

export interface DifficultySettings {
	label: string;
	minGap: number;
	minStrength: number;
	bands: string[];
	pairs: boolean;
	/** Seconds a note takes from appearing to reaching the player. */
	travel: number;
	dirs: number[];
	rows: number[];
}

export interface LevelLogic {
	DIFFICULTIES: Record<string, DifficultySettings>;
	DIFFICULTY_IDS: string[];
	FIRST_NOTE_AT: number;
	generateLevel(analysis: { duration: number; onsets: LevelOnset[] }, options: { seed: number; difficulty: string }): Note[];
	multiplierFor(combo: number): number;
	cutPoints(accuracy: number, comboBefore: number): number;
	maxScore(count: number): number;
	rankFor(ratio: number): string;
	cutVector(dir: number): [number, number];
	noteAngle(dir: number): number;
	cutAlignment(swing: [number, number], dir: number): number;
	distanceToSegment(p: number[], a: number[], b: number[]): number;
	songKey(sourceKey: string, title: string): string;
	boardName(key: string, difficulty: string): string;
	hashString(text: string): number;
	mulberry32(seed: number): () => number;
}

const EXPORTS = 'DIFFICULTIES, DIFFICULTY_IDS, FIRST_NOTE_AT, generateLevel, multiplierFor, cutPoints, maxScore, rankFor, cutVector, noteAngle, cutAlignment, distanceToSegment, songKey, boardName, hashString, mulberry32';

/** Evaluates the rules: what the world's script does at load, for code that wants to call them directly. */
export function loadLevelLogic(): LevelLogic {
	// eslint-disable-next-line no-new-func -- the same source text that the world's code block runs.
	return new Function(`${LEVEL_LOGIC_SOURCE}\nreturn { ${EXPORTS} };`)() as LevelLogic;
}
