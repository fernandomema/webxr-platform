/**
 * The rules of the bowling world as plain JavaScript with no dependency on the engine: scoring, the turn order of a game, the pin deck
 * and the way a ball and the pins move. A world's code block cannot import modules, so the rules live in one source string that the
 * world's script embeds, and `loadBowlingLogic` evaluates the very same text for tests and tools.
 *
 * A lane has its own frame: `u` runs across the lane (0 is the middle, the bowler's right is positive) and `w` along it, from the foul
 * line (0) towards the pins (the head pin is at `HEAD`). Metres and seconds. A ball is `{ u, w, y, vu, vw, vy }` with `y` the height of its
 * centre; a pin is `{ n, u, w, vu, vw, state, tilt, du, dw, y }` where (u, w) is where it stands (its base) and `tilt` is how far it has fallen.
 */
export const BOWLING_LOGIC_SOURCE = `
const BED_HALF = 0.5265;
const GUTTER_WIDTH = 0.235;
const GUTTER_DEPTH = 0.07;
const HEAD = 18.29;
const DECK_END = HEAD + 0.9;
const PIT_END = DECK_END + 0.55;
const BALL_R = 0.108;
const PIN_SPACING = 0.305;
const PIN_ROW = 0.2642;
const PIN_H = 0.381;
const PIN_R = 0.07;
const GRAVITY = 9.81;
const STEP = 1 / 120;
const BALL_MASS = 6.5;
const PIN_MASS = 1.55;
const ASSIST_LEVELS = [{ label: 'Easy', value: 0.93 }, { label: 'Normal', value: 0.82 }, { label: 'Pro', value: 0.45 }];

// ---------------------------------------------------------------- scoring

/** The score of one player's rolls (pins knocked down by each ball, in order): ten frames, with the strike and spare bonuses. */
function scoreGame(rolls) {
  const frames = [];
  let at = 0;
  let total = 0;
  for (let f = 0; f < 10; f++) {
    const frame = { rolls: [], score: null, mark: [] };
    frames.push(frame);
    const a = rolls[at];
    if (a === undefined) continue;
    if (f < 9) {
      if (a === 10) {
        frame.rolls = [10];
        frame.mark = ['X'];
        if (rolls[at + 1] !== undefined && rolls[at + 2] !== undefined) { total += 10 + rolls[at + 1] + rolls[at + 2]; frame.score = total; }
        at += 1;
      } else {
        const b = rolls[at + 1];
        frame.rolls = b === undefined ? [a] : [a, b];
        frame.mark = b === undefined ? [a === 0 ? '-' : String(a)] : [a === 0 ? '-' : String(a), a + b === 10 ? '/' : b === 0 ? '-' : String(b)];
        if (b !== undefined && a + b === 10) {
          if (rolls[at + 2] !== undefined) { total += 10 + rolls[at + 2]; frame.score = total; }
        } else if (b !== undefined) { total += a + b; frame.score = total; }
        at += b === undefined ? 1 : 2;
      }
    } else {
      const tenth = rolls.slice(at, at + 3);
      frame.rolls = tenth;
      // Each ball is on a rack: a new one after a strike or a spare, else what was left.
      let standing = 10;
      frame.mark = tenth.map((pins) => {
        const mark = pins === standing ? (standing === 10 ? 'X' : '/') : pins === 0 ? '-' : String(pins);
        standing = pins === standing ? 10 : standing - pins;
        return mark;
      });
      const done = tenth.length === 3 || (tenth.length === 2 && tenth[0] !== 10 && tenth[0] + tenth[1] < 10);
      if (done) { total += tenth.reduce((sum, pins) => sum + pins, 0); frame.score = total; }
    }
  }
  return { frames: frames, total: total, complete: isComplete(rolls) };
}

/** The state of a player's game: which frame comes next, which roll of it, and how many pins stand for it (10 for a new rack). 'done' once the tenth is over. */
function nextRoll(rolls) {
  let at = 0;
  for (let f = 0; f < 9; f++) {
    if (rolls[at] === undefined) return { frame: f, roll: 0, standing: 10, done: false };
    if (rolls[at] === 10) { at += 1; continue; }
    if (rolls[at + 1] === undefined) return { frame: f, roll: 1, standing: 10 - rolls[at], done: false };
    at += 2;
  }
  const t = rolls.slice(at);
  if (t.length === 0) return { frame: 9, roll: 0, standing: 10, done: false };
  if (t.length === 1) return { frame: 9, roll: 1, standing: t[0] === 10 ? 10 : 10 - t[0], done: false };
  if (t.length === 2) {
    if (t[0] === 10) return { frame: 9, roll: 2, standing: t[1] === 10 ? 10 : 10 - t[1], done: false };
    if (t[0] + t[1] === 10) return { frame: 9, roll: 2, standing: 10, done: false };
    return { frame: 9, roll: 2, standing: 0, done: true };
  }
  return { frame: 9, roll: 3, standing: 0, done: true };
}
function isComplete(rolls) { return nextRoll(rolls).done; }

/** A game for some players: everyone's rolls and whose turn it is. Turns go frame by frame, the tenth played through by each in turn. */
function newGame(players) { return { players: players.map((p) => ({ id: p.id, name: p.name, rolls: [] })), turn: 0, over: false }; }

function currentPlayer(game) { return game.over || game.players.length === 0 ? null : game.players[game.turn % game.players.length]; }

/** Records a roll for whoever is up and says what comes next: the rack (10 for new pins, else how many stand) and who throws. */
function recordRoll(game, pins) {
  const player = currentPlayer(game);
  if (!player) return null;
  player.rolls.push(pins);
  const before = nextRoll(player.rolls.slice(0, player.rolls.length - 1)).standing;
  const after = nextRoll(player.rolls);
  const sameTurn = !after.done && after.roll > 0;
  const result = { player: player, pins: pins, standing: after.standing, frame: after.frame, strike: pins === before && before === 10, spare: pins === before && before < 10, turnEnds: !sameTurn, gameOver: false };
  if (!sameTurn) {
    game.turn = (game.turn + 1) % game.players.length;
    if (game.players.every((p) => isComplete(p.rolls))) { game.over = true; result.gameOver = true; }
    else while (isComplete(game.players[game.turn].rolls)) game.turn = (game.turn + 1) % game.players.length;
  }
  return result;
}

/** Adds a player to a game that is not over; a game already started gives them an empty card (they start with the next round of turns). */
function addPlayer(game, player) {
  if (game.players.some((p) => p.id === player.id)) return false;
  game.players.push({ id: player.id, name: player.name, rolls: [] });
  return true;
}

// ---------------------------------------------------------------- the pins

function pinSpots() {
  const spots = [];
  for (let row = 0; row < 4; row++) for (let k = 0; k <= row; k++) spots.push({ n: row * (row + 1) / 2 + k + 1, u: (k - row / 2) * PIN_SPACING, w: HEAD + row * PIN_ROW });
  return spots;
}

function makePins() {
  return pinSpots().map((s) => ({ n: s.n, home: { u: s.u, w: s.w }, u: s.u, w: s.w, vu: 0, vw: 0, state: 'up', tilt: 0, du: 0, dw: 1, y: 0, fall: 0 }));
}

/** Pins that are no longer standing (fallen, in the gutter or in the pit). */
function pinsDown(pins) { return pins.filter((p) => p.state !== 'up').length; }

/** Whether anything is still moving: a pin sliding or falling. */
function pinsBusy(pins) { return pins.some((p) => (p.state !== 'gone' && (Math.abs(p.vu) + Math.abs(p.vw) > 0.04 || (p.state === 'tipping') || p.state === 'falling'))); }

function topple(pin, vu, vw) {
  const speed = Math.hypot(vu, vw);
  pin.vu = vu; pin.vw = vw;
  if (pin.state !== 'up' || speed < 0.9) return;
  pin.state = 'tipping';
  pin.du = vu / speed; pin.dw = vw / speed;
}

/** Two round bodies of radii ra and rb at (a, b) meet: pushes them apart and trades speed along the line between them. */
function collide(a, ra, ma, b, rb, mb, e) {
  const du = b.u - a.u, dw = b.w - a.w;
  const dist = Math.hypot(du, dw);
  const min = ra + rb;
  if (dist >= min || dist < 1e-6) return 0;
  const nu = du / dist, nw = dw / dist;
  const rel = (a.vu - b.vu) * nu + (a.vw - b.vw) * nw;
  const push = min - dist;
  const total = ma + mb;
  a.u -= nu * push * (mb / total); a.w -= nw * push * (mb / total);
  b.u += nu * push * (ma / total); b.w += nw * push * (ma / total);
  if (rel <= 0) return 0;
  const j = (1 + e) * rel / total;
  a.vu -= nu * j * mb; a.vw -= nw * j * mb;
  b.vu += nu * j * ma; b.vw += nw * j * ma;
  return rel;
}

/**
 * Moves the pins one step and lets the ball push them. Returns what happened, for sound and effects: \`hits\` is the loudest meeting this step
 * (0 for none) and \`fell\` how many pins went down.
 */
function stepPins(pins, ball, dt) {
  const out = { hits: 0, ballHit: false, fell: 0 };
  const radius = (p) => (p.state === 'up' ? PIN_R : p.state === 'tipping' ? PIN_R * 1.3 : PIN_R * 1.15);
  if (ball && ball.y < PIN_H * 0.6) {
    for (const pin of pins) {
      if (pin.state === 'gone' || pin.state === 'falling') continue;
      const before = { vu: pin.vu, vw: pin.vw, up: pin.state === 'up' };
      const body = { u: pin.u, w: pin.w, vu: pin.vu, vw: pin.vw };
      const rel = collide(ball, BALL_R, BALL_MASS, body, radius(pin), PIN_MASS, 0.55);
      if (rel > 0) {
        pin.u = body.u; pin.w = body.w;
        topple(pin, body.vu, body.vw);
        if (before.up && pin.state === 'tipping') out.fell += 1;
        out.hits = Math.max(out.hits, rel);
        out.ballHit = true;
      } else { pin.u = body.u; pin.w = body.w; }
    }
  }
  for (let i = 0; i < pins.length; i++) {
    const a = pins[i];
    if (a.state === 'gone' || a.state === 'falling') continue;
    for (let j = i + 1; j < pins.length; j++) {
      const b = pins[j];
      if (b.state === 'gone' || b.state === 'falling') continue;
      const moving = Math.abs(a.vu) + Math.abs(a.vw) + Math.abs(b.vu) + Math.abs(b.vw) > 0.05;
      if (!moving) continue;
      const wasA = a.state, wasB = b.state;
      const rel = collide(a, radius(a), PIN_MASS, b, radius(b), PIN_MASS, 0.7);
      if (rel > 0) {
        topple(a, a.vu, a.vw); topple(b, b.vu, b.vw);
        if (wasA === 'up' && a.state === 'tipping') out.fell += 1;
        if (wasB === 'up' && b.state === 'tipping') out.fell += 1;
        out.hits = Math.max(out.hits, rel);
      }
    }
  }
  for (const pin of pins) {
    if (pin.state === 'gone') continue;
    if (pin.state === 'falling') {
      pin.fall += dt;
      pin.y -= 3 * dt + pin.fall * 6 * dt;
      pin.w += pin.vw * dt; pin.u += pin.vu * dt;
      if (pin.y < -0.7) { pin.state = 'gone'; pin.vu = 0; pin.vw = 0; }
      continue;
    }
    pin.u += pin.vu * dt; pin.w += pin.vw * dt;
    const speed = Math.hypot(pin.vu, pin.vw);
    if (speed > 0) {
      const slow = Math.max(0, speed - (pin.state === 'up' ? 7 : 3.2) * dt);
      pin.vu *= slow / speed; pin.vw *= slow / speed;
      if (slow < 0.03) { pin.vu = 0; pin.vw = 0; }
    }
    if (pin.state === 'tipping') {
      pin.tilt = Math.min(Math.PI / 2, pin.tilt + (3 + pin.tilt * 9) * dt);
      if (pin.tilt >= Math.PI / 2) pin.state = 'down';
    }
    pin.y = pin.state === 'down' || pin.state === 'tipping' ? Math.max(pin.y, Math.sin(pin.tilt) * 0.045) : pin.y;
    if (pin.w > DECK_END) { pin.state = 'falling'; pin.fall = 0; if (pin.tilt === 0) out.fell += 1; pin.tilt = Math.max(pin.tilt, 0.4); }
    else if (Math.abs(pin.u) > BED_HALF + 0.02 && pin.state !== 'up') { pin.state = 'down'; pin.tilt = Math.PI / 2; pin.y = -GUTTER_DEPTH + 0.05; pin.u = Math.sign(pin.u) * Math.min(Math.abs(pin.u), BED_HALF + GUTTER_WIDTH - 0.06); pin.vu = 0; pin.vw = 0; }
    else if (Math.abs(pin.u) > BED_HALF + 0.02) { pin.state = 'falling'; pin.fall = 0; pin.tilt = 0.5; pin.du = Math.sign(pin.u); pin.dw = 0; out.fell += 1; }
  }
  return out;
}

/** Where a pin is drawn: its base, and how it is turned (a quaternion about the horizontal axis it falls over). */
function pinPose(pin) {
  const lean = Math.sin(pin.tilt) * PIN_H * 0.5;
  const x = pin.u - pin.du * lean * (pin.state === 'up' ? 0 : 1);
  const z = pin.w - pin.dw * lean * (pin.state === 'up' ? 0 : 1);
  const half = pin.tilt / 2;
  const s = Math.sin(half);
  // Axis (dw, 0, -du): turning the pin about it leans the top towards (du, dw).
  return { u: x, w: z, y: pin.y, rotation: pin.tilt === 0 ? [0, 0, 0, 1] : [pin.dw * s, 0, -pin.du * s, Math.cos(half)] };
}

// ---------------------------------------------------------------- the ball

/** The height of the surface under a point of a lane: the floor, a little lower in a gutter. */
function surfaceHeight(u, w) {
  if (w < 0 || w > PIT_END) return 0;
  return Math.abs(u) > BED_HALF ? -GUTTER_DEPTH : 0;
}

/**
 * What a throw becomes. \`from\` is where the ball left the hand ({ u, w, y }) and \`velocity\` how fast it was going ({ vu, vw, vy }); \`assist\` (0 to 1)
 * is how much of the way from the throw's own direction to the head pin is corrected. Slow or sideways throws still roll down the lane.
 */
function launchBall(from, velocity, assist) {
  const speed = Math.hypot(velocity.vu, velocity.vw);
  let du = speed > 0.3 ? velocity.vu / speed : 0, dw = speed > 0.3 ? velocity.vw / speed : 1;
  if (dw < 0.35) { du = 0; dw = 1; }
  const toU = -from.u, toW = Math.max(1, HEAD - from.w);
  const toLen = Math.hypot(toU, toW);
  let mu = du * (1 - assist) + (toU / toLen) * assist, mw = dw * (1 - assist) + (toW / toLen) * assist;
  const len = Math.hypot(mu, mw) || 1;
  mu /= len; mw /= len;
  const pace = Math.min(9.5, Math.max(4.2, speed * Math.max(0.6, dw)));
  return { u: from.u, w: from.w, y: from.y, vu: mu * pace, vw: mw * pace, vy: Math.min(1.2, velocity.vy || 0) };
}

/**
 * Moves a ball one step on a lane (gravity, bounces, rolling resistance, the gutter and, with bumpers, the rails). Returns what it did:
 * \`landed\` when it hit the floor, \`gutter\` once it has fallen into a gutter, \`pit\` when it left the deck.
 */
function stepBall(ball, dt, bumpers, lane) {
  const out = { landed: 0, gutter: false, pit: false, rail: false };
  // Off a lane the ball is on a plain floor and (u, w) are only a place on it: the lane's own rules do not apply.
  const ground = lane === false ? 0 : surfaceHeight(ball.u, ball.w);
  ball.vy -= GRAVITY * dt;
  ball.y += ball.vy * dt;
  const rest = ground + BALL_R;
  const onLane = lane !== false && ball.w >= 0;
  if (ball.y <= rest) {
    if (ball.vy < -0.8) { out.landed = -ball.vy; ball.vy = -ball.vy * 0.3; } else ball.vy = 0;
    ball.y = rest;
    const speed = Math.hypot(ball.vu, ball.vw);
    if (speed > 0) {
      // Dry carpet slows a ball quickly; the oiled lane hardly at all.
      const slow = Math.max(0, speed - (onLane ? 0.08 : 2.6) * dt);
      ball.vu *= slow / speed; ball.vw *= slow / speed;
      // A ball that is rolling on the lane keeps at least a walking pace until the pins, so a soft throw still gets there.
      if (onLane && ball.w < HEAD - 1 && slow > 0.3 && slow < 2.2) { ball.vu *= 2.2 / slow; ball.vw *= 2.2 / slow; }
    }
  }
  ball.u += ball.vu * dt;
  ball.w += ball.vw * dt;
  if (lane !== false && ball.w > 0) {
    if (bumpers && Math.abs(ball.u) > BED_HALF - BALL_R) {
      ball.u = Math.sign(ball.u) * (BED_HALF - BALL_R);
      ball.vu = -ball.vu * 0.55;
      out.rail = true;
    } else if (!bumpers && Math.abs(ball.u) > BED_HALF) {
      // Once over the edge the ball drops into the middle of the gutter and stays there.
      out.gutter = true;
      ball.vu = 0;
      ball.u = Math.sign(ball.u) * (BED_HALF + GUTTER_WIDTH / 2);
    }
  }
  if (lane !== false && ball.w > DECK_END + 0.3) out.pit = true;
  return out;
}

/** The height a pin or ball needs to stay put on a lane once it left: where its centre is when it rests. */
function restingY(ball) { return surfaceHeight(ball.u, ball.w) + BALL_R; }

/** The lane (index) whose bed, gutters and approach the point is over, or -1. \`laneX\` lists the lanes' middles. */
function laneAt(laneX, x, z, foulZ) {
  for (let i = 0; i < laneX.length; i++) if (Math.abs(x - laneX[i]) < BED_HALF + GUTTER_WIDTH + 0.25 && z > foulZ - 4.6 && z < foulZ + PIT_END) return i;
  return -1;
}

// ---------------------------------------------------------------- the scoreboard

/** What a player takes on a scoreboard: a row of marks (X, /, digits) and under it a row with the running score. */
function boardRows(player, current) {
  const card = scoreGame(player.rolls);
  const marks = card.frames.map((frame, i) => frame.mark.join(i === 9 ? '' : ' '));
  const scores = card.frames.map((frame) => (frame.score === null ? '' : String(frame.score)));
  return [{ name: player.name, cells: marks, highlight: current }, { name: '', cells: scores, highlight: current }];
}
`;

/** The source evaluated into an object of its functions and constants, for tests and tools. */
export interface BowlingLogic {
	BED_HALF: number; GUTTER_WIDTH: number; GUTTER_DEPTH: number; HEAD: number; DECK_END: number; PIT_END: number; BALL_R: number; PIN_H: number; PIN_R: number; STEP: number;
	ASSIST_LEVELS: { label: string; value: number }[];
	scoreGame(rolls: number[]): { frames: { rolls: number[]; score: number | null; mark: string[] }[]; total: number; complete: boolean };
	nextRoll(rolls: number[]): { frame: number; roll: number; standing: number; done: boolean };
	isComplete(rolls: number[]): boolean;
	newGame(players: { id: string; name: string }[]): Game;
	currentPlayer(game: Game): GamePlayer | null;
	recordRoll(game: Game, pins: number): RollResult | null;
	addPlayer(game: Game, player: { id: string; name: string }): boolean;
	pinSpots(): { n: number; u: number; w: number }[];
	makePins(): Pin[];
	pinsDown(pins: Pin[]): number;
	pinsBusy(pins: Pin[]): boolean;
	stepPins(pins: Pin[], ball: Ball | null, dt: number): { hits: number; ballHit: boolean; fell: number };
	pinPose(pin: Pin): { u: number; w: number; y: number; rotation: [number, number, number, number] };
	surfaceHeight(u: number, w: number): number;
	launchBall(from: { u: number; w: number; y: number }, velocity: { vu: number; vw: number; vy?: number }, assist: number): Ball;
	stepBall(ball: Ball, dt: number, bumpers: boolean, lane?: boolean): { landed: number; gutter: boolean; pit: boolean; rail: boolean };
	laneAt(laneX: number[], x: number, z: number, foulZ: number): number;
	boardRows(player: GamePlayer, current: boolean): { name: string; cells: string[]; highlight: boolean }[];
}
export interface GamePlayer { id: string; name: string; rolls: number[] }
export interface Game { players: GamePlayer[]; turn: number; over: boolean }
export interface RollResult { player: GamePlayer; pins: number; standing: number; frame: number; strike: boolean; spare: boolean; turnEnds: boolean; gameOver: boolean }
export interface Ball { u: number; w: number; y: number; vu: number; vw: number; vy: number }
export interface Pin { n: number; home: { u: number; w: number }; u: number; w: number; vu: number; vw: number; state: 'up' | 'tipping' | 'down' | 'falling' | 'gone'; tilt: number; du: number; dw: number; y: number; fall: number }

const NAMES = ['BED_HALF', 'GUTTER_WIDTH', 'GUTTER_DEPTH', 'HEAD', 'DECK_END', 'PIT_END', 'BALL_R', 'PIN_H', 'PIN_R', 'STEP', 'ASSIST_LEVELS', 'scoreGame', 'nextRoll', 'isComplete', 'newGame', 'currentPlayer', 'recordRoll', 'addPlayer', 'pinSpots', 'makePins', 'pinsDown', 'pinsBusy', 'stepPins', 'pinPose', 'surfaceHeight', 'launchBall', 'stepBall', 'laneAt', 'boardRows'];

export function loadBowlingLogic(): BowlingLogic {
	return new Function(`${BOWLING_LOGIC_SOURCE}\nreturn { ${NAMES.join(', ')} };`)() as BowlingLogic;
}
