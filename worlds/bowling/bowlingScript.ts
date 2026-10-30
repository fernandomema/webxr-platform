import { BOWLING_LOGIC_SOURCE } from './bowlingLogic.ts';
import { BALLS_PER_LANE, BOWLING, CUSTOM_BALL_COUNT, LANE_COUNT, MACHINE, ballHome, customBallHome, customBallId, laneIds } from './bowlingLayout.ts';
import { BALL_FINISHES, BALL_MATERIALS, MACHINE_BUTTONS, ballMaterial, materialButtonId } from './bowlingMachine.ts';

/**
 * The script that runs every lane of the alley (one code block on the director, which the lane consoles hang from so that it hears their
 * presses). Everything that changes the world is done by the host; the guests only see what it writes (poses and components).
 *
 *  - Balls: a ball somebody lets go of is followed from the hand (its last tenth of a second gives the speed) and thrown down the lane it
 *    was let go over, with some help towards the head pin (set on the desk). It rolls, falls into the gutter or rebounds off bumpers, hits
 *    the pins and goes into the pit, and comes back to its place on the return. A ball put back on a return goes home at once.
 *  - Pins: bowlingLogic.ts moves them; here they only get posed. A roll is counted when they stop, and the game takes it from there
 *    (frames, spares, strikes, who is next). The pins that stand are kept for the second ball; a new rack comes for the next turn.
 *  - Desks: the scoreboard, the screen over the pins and the panel (join, leave, bumpers, aim help, new game, cheer).
 */
const LAYOUT = {
	laneX: BOWLING.laneX,
	foulZ: BOWLING.foulZ,
	returnX: BOWLING.returnX,
	deskZ: BOWLING.deskZ,
	maxPlayers: BOWLING.maxPlayers,
	hallBoard: BOWLING.hallOfFameBoard,
	homes: [
		...Array.from({ length: LANE_COUNT }, (_, lane) => Array.from({ length: BALLS_PER_LANE }, (_, k) => ({ id: laneIds(lane).ball(k), lane, pos: ballHome(lane, k) }))).flat(),
		// The balls the ball machine makes: they start on its tray, and after a roll come back to the return of the lane they were bowled on.
		...Array.from({ length: CUSTOM_BALL_COUNT }, (_, k) => ({ id: customBallId(k), lane: 0, pos: customBallHome(k), custom: true }))
	],
	neon: ['#ff2fb3', '#25e6ff'],
	/** Solids a ball passes through: the floors (it has its own) and the walls that keep people off the lanes. */
	ignore: ['bw-floor-lobby', 'bw-floor-west', 'bw-floor-east', 'bw-barrier-front', 'bw-barrier-west', 'bw-barrier-east']
};

export const DIRECTOR_SCRIPT = String.raw`${BOWLING_LOGIC_SOURCE}
const LAYOUT = ${JSON.stringify(LAYOUT)};
const FOUL = LAYOUT.foulZ;
const BOARD = 'bowling-best';
const RETURN_DELAY = 2.6;
const SWEEP_TIME = 2.0;
const IDLE_RETURN = 7;
const THROW_MIN_SPEED = 0.9;
const MAX_SPEED = 12;
const BANNER_TIME = 3;
const COLUMNS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

const set = (id, type, field, value) => ctx.world.setComponentField(id, type, field, value, true);
const guard = (promise, label) => Promise.resolve(promise).catch((error) => ctx.log(label + ': ' + (error && error.message ? error.message : error)));
const laneId = (lane) => ({
  pin: (n) => 'bw-l' + lane + '-pin-' + n,
  board: 'bw-l' + lane + '-board',
  monitor: 'bw-l' + lane + '-monitor',
  status: 'bw-l' + lane + '-status',
  bumpers: 'bw-l' + lane + '-bumpers',
  assist: 'bw-l' + lane + '-assist',
  rail: (side) => 'bw-l' + lane + '-rail-' + side,
  console: 'bw-l' + lane + '-console'
});

let ready = false;
let clock = 0;
let fxLeft = 8;
let fxTimer = 0;
let moved = false;
let flushTimer = 0;
let checkTimer = 0;
const lanes = LAYOUT.laneX.map((x, i) => ({
  i: i, x: x, ids: laneId(i), game: null, assist: 1, bumpers: false, phase: 'ready', timer: 0, rollTime: 0, pins: makePins(), ball: null,
  downBefore: 0, rerack: false, banner: null, bannerUntil: 0, hitSound: 0, thrower: null, leaving: [], flashUntil: 0, flashStep: -1
}));
const balls = LAYOUT.homes.map((home) => ({
  id: home.id, home: home.pos.slice(), trayHome: home.pos.slice(), custom: !!home.custom, displaced: null, displacedBy: null, parked: false, lastLane: -1, lane: home.lane, phase: 'home', pos: home.pos.slice(), vel: [0, 0, 0], samples: [], holder: null,
  rest: 0, returnAt: 0, quat: [0, 0, 0, 1], hidden: false
}));

// ---------------------------------------------------------------- sound and light

function fx(position, components, ttl) {
  if (fxLeft <= 0) return;
  fxLeft -= 1;
  ctx.world.spawn({ id: crypto.randomUUID(), name: 'Alley Effect', position: position, components: components.concat([{ type: 'expires', expiresAt: Date.now() + ttl }]) });
}
const sound = (position, spec) => fx(position, [Object.assign({ type: 'impactSound' }, spec)], (spec.durationMs || 220) + 600);
const burst = (position, color, count) => fx(position, [{ type: 'particleBurst', color: color, count: count, durationMs: 1400 }], 1500);

const deckPoint = (L) => [L.x, 0.4, FOUL + HEAD];
const pinCrash = (L, strength) => sound([L.x, 0.3, FOUL + HEAD], { frequency: 700 + Math.random() * 900, pitchDrop: 300, noiseMix: 0.78, durationMs: 150 + strength * 12, volume: Math.min(0.9, 0.25 + strength * 0.08) });

function haptic(player, intensity, ms) {
  if (!player || !ctx.haptics) return;
  try { ctx.haptics.pulse(player.id, { hand: 'both', intensity: intensity, durationMs: ms }); } catch (error) { /* a guest without controllers */ }
}

// ---------------------------------------------------------------- players

function nearestPlayer(point, maxDistance) {
  let best = null;
  let bestDistance = maxDistance;
  for (const p of ctx.world.getPlayers()) {
    const pose = ctx.world.getPlayerPose(p.id);
    if (!pose || !pose.head) continue;
    const h = pose.head.position;
    const distance = Math.hypot(h[0] - point[0], h[1] - point[1], h[2] - point[2]);
    if (distance < bestDistance) { bestDistance = distance; best = p; }
  }
  return best ? { id: best.id, name: best.name } : null;
}

// ---------------------------------------------------------------- what the desk and the screens say

function statusText(L) {
  const game = L.game;
  if (!game || game.players.length === 0) return 'Press JOIN, or just roll a ball.';
  if (game.over) {
    const totals = game.players.map((p) => ({ name: p.name, total: scoreGame(p.rolls).total }));
    const top = Math.max.apply(null, totals.map((t) => t.total));
    const winners = totals.filter((t) => t.total === top).map((t) => t.name);
    return 'Game over! ' + winners.join(' & ') + (winners.length > 1 ? ' tie with ' : ' wins with ') + top + '. Roll a ball to play again.';
  }
  const who = currentPlayer(game);
  const next = nextRoll(who.rolls);
  const place = 'Frame ' + (next.frame + 1) + ', ball ' + (next.roll + 1);
  if (L.phase === 'rolling') return who.name + ' is rolling... (' + place + ')';
  return who.name + ' is up. ' + place + '.';
}

function paintConsole(L) {
  set(L.ids.status, 'uiElement', 'text', statusText(L));
  set(L.ids.bumpers, 'uiElement', 'text', 'Bumpers: ' + (L.bumpers ? 'ON' : 'OFF'));
  set(L.ids.bumpers, 'uiElement', 'background', L.bumpers ? '#2563eb' : '#1e293b');
  set(L.ids.assist, 'uiElement', 'text', 'Aim help: ' + ASSIST_LEVELS[L.assist].label);
}

function paintBoard(L) {
  const game = L.game;
  const rows = [];
  if (game) {
    const current = game.over ? null : currentPlayer(game);
    for (const player of game.players) for (const row of boardRows(player, player === current)) rows.push(row);
  }
  ctx.world.setComponent(L.ids.board, { type: 'scoreboard', title: 'LANE ' + (L.i + 1), status: statusText(L), columns: COLUMNS, rows: rows });
}

function paintMonitor(L) {
  const game = L.game;
  let title = 'LANE ' + (L.i + 1);
  let color = '#facc15';
  let lines = ['Grab a ball and roll'];
  let background = '#0a1030';
  if (L.banner && clock < L.bannerUntil) { title = L.banner.text; color = L.banner.color; lines = L.banner.lines; background = '#1a0a30'; }
  else if (game && game.over) {
    const totals = game.players.map((p) => ({ name: p.name, total: scoreGame(p.rolls).total })).sort((a, b) => b.total - a.total);
    title = totals[0].name + ' WINS'; color = '#4ade80';
    lines = totals.slice(0, 3).map((t) => t.name + '  ' + t.total);
  } else if (game && game.players.length) {
    const who = currentPlayer(game);
    const next = nextRoll(who.rolls);
    title = who.name; color = '#ffffff';
    lines = ['Frame ' + (next.frame + 1) + '  ·  Ball ' + (next.roll + 1), 'Score ' + scoreGame(who.rolls).total];
  }
  ctx.world.setComponent(L.ids.monitor, { type: 'textDisplay', title: title, titleColor: color, lines: lines, lineColor: '#cfe1ff', background: background });
}

function paintLane(L) { paintConsole(L); paintBoard(L); paintMonitor(L); }

function showBanner(L, text, color, lines) {
  L.banner = { text: text, color: color, lines: lines || [] };
  L.bannerUntil = clock + BANNER_TIME;
}

/** The neon of a lane: its own colours, and a chase of colours for a few seconds after a strike or a spare. */
const FLASH = ['#ff2fb3', '#25e6ff', '#facc15', '#ffffff'];
function paintNeon(L, a, b, unit) {
  const color = (id, value) => ctx.world.setComponentField(id, 'meshRenderer', 'color', value, true);
  color('bw-l' + L.i + '-glow-0', a);
  color('bw-l' + L.i + '-glow-1', b);
  color('bw-l' + L.i + '-unit-neon', unit);
}
function neonTick(L) {
  if (clock < L.flashUntil) {
    const step = Math.floor(clock / 0.2);
    if (step === L.flashStep) return;
    L.flashStep = step;
    paintNeon(L, FLASH[step % 4], FLASH[(step + 1) % 4], FLASH[(step + 2) % 4]);
  } else if (L.flashStep >= 0) {
    L.flashStep = -1;
    const mine = L.i % 2 === 0 ? [LAYOUT.neon[0], LAYOUT.neon[1]] : [LAYOUT.neon[1], LAYOUT.neon[0]];
    paintNeon(L, mine[0], mine[1], mine[L.i % 2]);
  }
}

function refreshHall() {
  if (!ctx.leaderboards || !ctx.leaderboards.available) return;
  guard(ctx.leaderboards.showOn(LAYOUT.hallBoard, BOARD, { limit: 8 }), 'hall of fame');
}

// ---------------------------------------------------------------- games

function startGame(L, player) {
  L.game = newGame(player ? [player] : [{ id: 'guest-' + L.i, name: 'Guest' }]);
  if (pinsDown(L.pins) > 0) resetPins(L);
}

function join(L, player) {
  if (!player) return 'Come closer to the desk to join.';
  if (L.phase === 'rolling') return 'Wait for the ball to finish.';
  if (!L.game || L.game.players.length === 0) { startGame(L, player); return player.name + ' joined.'; }
  if (L.game.players.some((p) => p.id === player.id)) return player.name + ' is already playing.';
  if (L.game.players.length >= LAYOUT.maxPlayers) return 'This lane is full (' + LAYOUT.maxPlayers + ' players).';
  if (L.game.over) { L.game = newGame(L.game.players.concat([player])); resetPins(L); }
  else addPlayer(L.game, player);
  return player.name + ' joined.';
}

function leave(L, playerId) {
  const game = L.game;
  if (!game) return;
  // While a ball is in play the roll is still the current player's: whoever it is leaves when it is over.
  if (L.phase === 'rolling' || L.phase === 'settling') { L.leaving.push(playerId); return; }
  const at = game.players.findIndex((p) => p.id === playerId);
  if (at < 0) return;
  const wasTurn = !game.over && game.players[game.turn % game.players.length] === game.players[at];
  game.players.splice(at, 1);
  if (game.players.length === 0) { L.game = null; resetPins(L); if (L.phase !== 'rolling') L.phase = 'ready'; return; }
  if (at < game.turn) game.turn -= 1;
  if (game.turn >= game.players.length) game.turn = 0;
  if (wasTurn && !game.over) {
    // Their turn is over: the next one throws at a new rack.
    for (let tries = 0; tries < game.players.length && isComplete(game.players[game.turn].rolls); tries++) game.turn = (game.turn + 1) % game.players.length;
    if (L.phase !== 'rolling') resetPins(L);
  }
  if (game.players.every((p) => isComplete(p.rolls))) game.over = true;
}

function finishGame(L) {
  const game = L.game;
  for (const player of game.players) {
    const total = scoreGame(player.rolls).total;
    if (ctx.leaderboards && ctx.leaderboards.available && !String(player.id).startsWith('guest-')) guard(ctx.leaderboards.submit(BOARD, { id: player.id, name: player.name }, total, { order: 'high' }), 'leaderboard');
  }
  setTimeout(refreshHall, 1500);
  burst(deckPoint(L), '#facc15', 120);
  sound(deckPoint(L), { frequency: 880, pitchDrop: -200, noiseMix: 0.1, durationMs: 700, volume: 0.5 });
}

// ---------------------------------------------------------------- pins

function posePin(L, pin) {
  const id = L.ids.pin(pin.n);
  if (pin.state === 'gone') {
    if (!pin.hidden) { pin.hidden = true; ctx.world.setSlotEnabled(id, false); }
    return;
  }
  const pose = pinPose(pin);
  const key = pose.u.toFixed(3) + '|' + pose.w.toFixed(3) + '|' + pose.y.toFixed(3) + '|' + pin.tilt.toFixed(2);
  if (pin.key === key) return;
  pin.key = key;
  ctx.world.setWorldPose(id, { position: [L.x + pose.u, pose.y, FOUL + pose.w], rotation: pose.rotation }, false);
  moved = true;
}

function resetPins(L) {
  L.pins = makePins();
  for (const pin of L.pins) {
    const id = L.ids.pin(pin.n);
    ctx.world.setSlotEnabled(id, true, false);
    ctx.world.setWorldPose(id, { position: [L.x + pin.u, 0, FOUL + pin.w], rotation: [0, 0, 0, 1] }, false);
    pin.hidden = false;
  }
  ctx.world.flush();
  L.downBefore = 0;
  sound([L.x, 1, FOUL + HEAD], { frequency: 140, pitchDrop: 60, noiseMix: 0.4, durationMs: 350, volume: 0.4 });
}

/** The pins that fell are swept away and the rest stay where they stand for the second ball. */
function sweepPins(L) {
  for (const pin of L.pins) {
    if (pin.state === 'up') continue;
    pin.state = 'gone';
    posePin(L, pin);
  }
  ctx.world.flush();
  L.downBefore = pinsDown(L.pins);
}

/** A rack with the number of pins given standing: new pins, less the ones a first ball took (any of them: they are not kept, only how many). */
function setRack(L, standing) {
  resetPins(L);
  for (const pin of L.pins) {
    if (10 - pinsDown(L.pins) <= standing) break;
    pin.state = 'gone';
    posePin(L, pin);
  }
  ctx.world.flush();
}

/** A ball thrown out of turn is the thrower's own: it goes on their card, and the turn passes to them (a player that was not in the game joins it, if there is room). */
function claimTurn(L, thrower) {
  const game = L.game;
  if (!thrower || game.over || game.players.length === 0) return;
  let index = game.players.findIndex((p) => p.id === thrower.id);
  if (index < 0) {
    if (game.players.length >= LAYOUT.maxPlayers) return;
    addPlayer(game, thrower);
    index = game.players.length - 1;
  }
  if (isComplete(game.players[index].rolls)) return;
  game.turn = index;
}

// ---------------------------------------------------------------- the roll is over

function endOfRoll(L) {
  const down = pinsDown(L.pins);
  const knocked = Math.max(0, down - L.downBefore);
  const thrower = currentPlayer(L.game);
  const result = recordRoll(L.game, knocked);
  L.ball = null;
  if (!result) { L.phase = 'ready'; paintLane(L); return; }
  const pos = deckPoint(L);
  const who = result.player.name;
  if (result.strike) {
    showBanner(L, 'STRIKE!', '#facc15', [who]);
    L.flashUntil = clock + BANNER_TIME;
    burst(pos, '#facc15', 160);
    sound(pos, { frequency: 1200, pitchDrop: 800, noiseMix: 0.7, durationMs: 700, volume: 0.9 });
    haptic(thrower, 0.9, 260);
  } else if (result.spare) {
    showBanner(L, 'SPARE!', '#4ade80', [who]);
    L.flashUntil = clock + BANNER_TIME * 0.6;
    burst(pos, '#4ade80', 90);
    sound(pos, { frequency: 660, pitchDrop: -240, noiseMix: 0.2, durationMs: 500, volume: 0.6 });
    haptic(thrower, 0.6, 160);
  } else if (knocked === 0) {
    showBanner(L, 'MISS', '#f87171', [who]);
    sound(pos, { frequency: 150, pitchDrop: 90, noiseMix: 0.3, durationMs: 400, volume: 0.45 });
  } else {
    showBanner(L, knocked + (knocked === 1 ? ' PIN' : ' PINS'), '#ffffff', [who]);
  }
  if (result.gameOver) {
    finishGame(L);
    L.phase = 'sweeping';
    L.rerack = true;
  } else {
    L.rerack = result.turnEnds || result.standing === 10;
    L.phase = 'sweeping';
  }
  L.timer = 0;
  paintLane(L);
}

function finishSweep(L) {
  const leaving = L.leaving.splice(0);
  for (const id of leaving) leave(L, id);
  // Somebody who left may have been the one whose frame is next: the next one starts at a full rack.
  if (L.rerack || (leaving.length && L.game)) resetPins(L); else sweepPins(L);
  L.phase = 'ready';
  L.timer = 0;
  paintLane(L);
}

/** A ball that was taken out of play (grabbed again) or that never got to the pit: what fell so far counts. */
function abortRoll(L) {
  if (L.phase !== 'rolling') return;
  L.ball = null;
  L.phase = 'settling';
  L.timer = 0;
}

function deliver(L, ball) {
  L.ball = ball;
  L.phase = 'rolling';
  L.rollTime = 0;
  if (!L.game) startGame(L, ball.holder);
  else if (L.game.over) { L.game = newGame(L.game.players); resetPins(L); }
  else claimTurn(L, ball.holder);
  // The rack is what the one who throws has left to hit: a card that expects a second ball finds the pins its first one left.
  const up = currentPlayer(L.game);
  if (up) { const standing = nextRoll(up.rolls).standing; if (10 - pinsDown(L.pins) !== standing) setRack(L, standing); }
  L.downBefore = pinsDown(L.pins);
  L.thrower = ball.holder;
  ball.lastLane = L.i;
  paintLane(L);
}

// ---------------------------------------------------------------- balls

/**
 * A ball from the ball machine that is back from a lane takes the place of one of that lane's own balls on its return (the own ball is put away
 * until the machine's ball leaves again). Returns whether it found a place; without one the ball goes to the machine's tray.
 */
function takeLanePlace(ball, laneIndex) {
  restoreDisplaced(ball);
  const own = balls.find((b) => !b.custom && b.lane === laneIndex && b.phase === 'home' && !b.parked && !ctx.grab.isSlotHeld(b.id));
  if (!own) return false;
  own.parked = true;
  own.displacedBy = ball;
  // Put away twice over: switched off and sent under the floor, so that nothing of it can be left showing under the ball that takes its place.
  ctx.world.setSlotEnabled(own.id, false);
  ctx.world.setWorldPose(own.id, { position: [own.home[0], -30, own.home[2]] });
  ball.displaced = own;
  ball.home = own.home.slice();
  return true;
}

/** The own ball comes back out, and the machine's ball goes back to thinking of its tray as home. */
function restoreDisplaced(ball) {
  const own = ball.displaced;
  if (!own) return;
  ball.displaced = null;
  own.displacedBy = null;
  if (own.parked) {
    own.parked = false;
    ctx.world.setWorldPose(own.id, { position: own.home, rotation: [0, 0, 0, 1] });
    ctx.world.setSlotEnabled(own.id, true);
  }
  ball.home = ball.trayHome.slice();
}

/** The lane whose return a point is over (the one the machine's ball was bowled on, if it is one of that return's two). */
function laneOfReturn(x, preferred) {
  const lanesHere = LAYOUT.returnX.map((rx, i) => (Math.abs(rx - x) < 0.5 ? i : -1)).filter((i) => i >= 0);
  return lanesHere.includes(preferred) ? preferred : lanesHere.length ? lanesHere[0] : -1;
}

function sendHome(ball, quiet, laneIndex) {
  for (const L of lanes) if (L.ball === ball) abortRoll(L);
  if (ball.custom) {
    restoreDisplaced(ball);
    if (laneIndex >= 0) takeLanePlace(ball, laneIndex);
  }
  ball.phase = 'home';
  ball.vel = [0, 0, 0];
  ball.pos = ball.home.slice();
  ball.quat = [0, 0, 0, 1];
  ball.rest = 0;
  if (ball.hidden) { ball.hidden = false; ctx.world.setSlotEnabled(ball.id, true); }
  ctx.world.setWorldPose(ball.id, { position: ball.home, rotation: ball.quat });
  if (!quiet) sound(ball.home, { frequency: 180, pitchDrop: 80, noiseMix: 0.35, durationMs: 260, volume: 0.5 });
}

function inReturnZone(p) {
  for (const rx of LAYOUT.returnX) if (Math.abs(p[0] - rx) < 0.45 && p[2] > 1.2 && p[2] < FOUL + 0.1 && p[1] > 0.55 && p[1] < 1.6) return true;
  return false;
}

function releaseVelocity(ball) {
  const s = ball.samples;
  if (s.length < 2) return [0, 0, 0];
  const last = s[s.length - 1];
  let first = last;
  for (let i = s.length - 1; i >= 0; i--) { if (last.t - s[i].t > 0.14) break; first = s[i]; }
  const span = last.t - first.t;
  if (span < 0.03) return [0, 0, 0];
  const v = [(last.p[0] - first.p[0]) / span, (last.p[1] - first.p[1]) / span, (last.p[2] - first.p[2]) / span];
  const speed = Math.hypot(v[0], v[1], v[2]);
  return speed > MAX_SPEED ? v.map((c) => (c * MAX_SPEED) / speed) : v;
}

function grabbed(ball) {
  ball.holder = nearestPlayer(ball.pos, 3);
  // Taken off a lane's return: the own ball it replaced is there again.
  if (ball.custom) { restoreDisplaced(ball); ball.lastLane = -1; }
  for (const L of lanes) if (L.ball === ball) abortRoll(L);
  ball.phase = 'held';
  ball.samples = [];
  ball.vel = [0, 0, 0];
  ball.rest = 0;
}

function released(ball) {
  const p = ball.pos;
  if (inReturnZone(p)) { sendHome(ball, false, ball.custom ? laneOfReturn(p[0], ball.lastLane) : -1); return; }
  const v = releaseVelocity(ball);
  ball.phase = 'free';
  ball.vel = v;
  ball.rest = 0;
  const lane = laneAt(LAYOUT.laneX, p[0], p[2], FOUL);
  if (lane < 0 || p[1] > 2) return;
  const L = lanes[lane];
  const atLine = p[2] > FOUL - 0.9 && p[2] < FOUL + 0.5 && p[1] < 1.4 && Math.abs(p[0] - L.x) < BED_HALF + 0.3;
  const thrown = Math.hypot(v[0], v[2]) >= THROW_MIN_SPEED && v[2] > 0.2;
  // A ball let go at the line is rolled even when it is only set down (a desktop player has no swing to throw with).
  if (thrown || atLine) {
    if (!thrown) v[0] = v[1] = v[2] = 0;
    const out = launchBall({ u: p[0] - L.x, w: p[2] - FOUL, y: Math.max(p[1], BALL_R) }, { vu: v[0], vw: v[2], vy: v[1] }, ASSIST_LEVELS[L.assist].value);
    ball.vel = [out.vu, out.vy, out.vw];
  }
  // Let go past the line (reaching over it): it counts from here.
  if (p[2] >= FOUL && L.phase === 'ready' && !L.ball && Math.abs(p[0] - L.x) < BED_HALF + 0.1) deliver(L, ball);
}

function wallBounce(ball, dt) {
  const speed = Math.hypot(ball.vel[0], ball.vel[1], ball.vel[2]);
  if (speed * dt < 1e-4) return;
  const dir = [ball.vel[0] / speed, ball.vel[1] / speed, ball.vel[2] / speed];
  const hit = ctx.physics.sphereCast(ball.pos, BALL_R, dir, speed * dt + 0.003, { ignore: LAYOUT.ignore.concat([ball.id]) });
  if (!hit) return;
  const along = ball.vel[0] * hit.normal[0] + ball.vel[1] * hit.normal[1] + ball.vel[2] * hit.normal[2];
  if (along >= 0) return;
  for (let k = 0; k < 3; k++) ball.vel[k] -= (1 + 0.45) * along * hit.normal[k];
  if (along < -1.5) sound(ball.pos, { frequency: 160, pitchDrop: 70, noiseMix: 0.4, durationMs: 220, volume: Math.min(0.7, -along * 0.12) });
}

/** One step of a ball that is not in a hand: gravity and rolling on the lane (or on the floor off it), the rails or the gutter, the pins. */
function stepFreeBall(ball, dt) {
  const laneIndex = laneAt(LAYOUT.laneX, ball.pos[0], ball.pos[2], FOUL);
  const L = laneIndex >= 0 ? lanes[laneIndex] : null;
  if (!L) wallBounce(ball, dt);
  const bx = L ? L.x : 0;
  const bz = L ? FOUL : 0;
  const state = { u: ball.pos[0] - bx, w: ball.pos[2] - bz, y: ball.pos[1], vu: ball.vel[0], vw: ball.vel[2], vy: ball.vel[1] };
  const before = state.w;
  const out = stepBall(state, dt, L ? L.bumpers : false, !!L);
  ball.pos = [state.u + bx, state.y, state.w + bz];
  ball.vel = [state.vu, state.vy, state.vw];
  if (state.vu !== 0 || state.vw !== 0) {
    // Roll: the axis is across the way it goes.
    const speed = Math.hypot(state.vu, state.vw);
    const turn = ctx.math.quatFromAxisAngle([state.vw / speed, 0, -state.vu / speed], (speed * dt) / BALL_R);
    ball.quat = ctx.math.quatMultiply(turn, ball.quat);
  }
  if (ball.pos[1] > 4.3) { ball.pos[1] = 4.3; if (ball.vel[1] > 0) ball.vel[1] *= -0.3; }
  if (out.landed > 1.5) sound(ball.pos, { frequency: 120, pitchDrop: 60, noiseMix: 0.5, durationMs: 240, volume: Math.min(0.8, out.landed * 0.1) });
  if (L) {
    if (L.phase === 'ready' && !L.ball && before < 0 && state.w >= 0 && state.vw > 1 && Math.abs(state.u) < BED_HALF + 0.1) deliver(L, ball);
    if (L.ball === ball && L.phase === 'rolling') {
      if (out.pit) { ball.phase = 'pit'; ball.returnAt = clock + RETURN_DELAY; ball.hidden = true; ctx.world.setSlotEnabled(ball.id, false); L.phase = 'settling'; L.timer = 0; L.ball = null; }
      return;
    }
    if (out.pit && ball.phase === 'free') { ball.phase = 'pit'; ball.returnAt = clock + RETURN_DELAY; ball.hidden = true; ctx.world.setSlotEnabled(ball.id, false); }
  }
  // Nothing is moving it any more: it goes home after a while.
  if (Math.hypot(ball.vel[0], ball.vel[2]) < 0.15 && Math.abs(ball.vel[1]) < 1) ball.rest += dt; else ball.rest = 0;
  if (ball.pos[1] < -5) ball.rest = IDLE_RETURN + 1;
}

function simulate(dt) {
  for (const ball of balls) {
    if (ball.phase !== 'free') continue;
    const L = lanes.find((lane) => lane.ball === ball && lane.phase === 'rolling');
    stepFreeBall(ball, dt);
    if (L && ball.phase === 'free') {
      const state = { u: ball.pos[0] - L.x, w: ball.pos[2] - FOUL, y: ball.pos[1], vu: ball.vel[0], vw: ball.vel[2], vy: ball.vel[1] };
      const out = stepPins(L.pins, state.w > HEAD - 0.6 ? state : null, dt);
      if (out.ballHit) { ball.pos[0] = state.u + L.x; ball.pos[2] = state.w + FOUL; ball.vel[0] = state.vu; ball.vel[2] = state.vw; }
      if (out.hits > 0.25 && clock - L.hitSound > 0.07) { L.hitSound = clock; pinCrash(L, out.hits); }
    }
  }
  for (const L of lanes) {
    if (L.phase !== 'settling' && !(L.phase === 'rolling' && !L.ball)) continue;
    const out = stepPins(L.pins, null, dt);
    if (out.hits > 0.25 && clock - L.hitSound > 0.07) { L.hitSound = clock; pinCrash(L, out.hits); }
  }
}

function everyFrame(dt) {
  clock += dt;
  fxTimer += dt;
  if (fxTimer > 0.1) { fxTimer = 0; fxLeft = 8; }
  for (const ball of balls) {
    const held = ctx.grab.isSlotHeld(ball.id);
    if (held) {
      const pose = ctx.hierarchy.getWorldPose(ball.id);
      if (!pose) continue;
      if (ball.phase !== 'held') grabbed(ball);
      ball.pos = pose.position.slice();
      ball.samples.push({ t: clock, p: ball.pos.slice() });
      while (ball.samples.length > 2 && clock - ball.samples[0].t > 0.3) ball.samples.shift();
    } else if (ball.phase === 'held') released(ball);
  }
}

function afterFrame(dt) {
  for (const L of lanes) {
    if (L.phase === 'rolling') {
      L.rollTime += dt;
      // A ball that never makes it (stuck, or put down on the lane): it is out of play after a while.
      if (L.ball && L.rollTime > 14) { const stuck = L.ball; stuck.phase = 'pit'; stuck.returnAt = clock; L.ball = null; L.phase = 'settling'; L.timer = 0; }
    }
    if (L.phase === 'settling') {
      L.timer += dt;
      if ((!pinsBusy(L.pins) && L.timer > 0.8) || L.timer > 7) endOfRoll(L);
    } else if (L.phase === 'sweeping') {
      L.timer += dt;
      if (L.timer >= SWEEP_TIME) finishSweep(L);
    }
    if (L.banner && clock >= L.bannerUntil) { L.banner = null; paintMonitor(L); }
    neonTick(L);
    if (L.phase === 'rolling' || L.phase === 'settling') for (const pin of L.pins) posePin(L, pin);
  }
  for (const ball of balls) {
    if (ball.phase === 'free') {
      ctx.world.setWorldPose(ball.id, { position: ball.pos, rotation: ball.quat }, false);
      moved = true;
      if (ball.rest > IDLE_RETURN) sendHome(ball, false, -1);
    } else if (ball.phase === 'pit' && clock >= ball.returnAt) sendHome(ball, false, ball.custom ? ball.lastLane : -1);
  }
  // A machine ball on a lane's return that the machine took away again (to make another): the own ball it replaced comes back.
  checkTimer += dt;
  if (checkTimer >= 0.5) {
    checkTimer = 0;
    for (const ball of balls) {
      if (!ball.displaced || ball.phase !== 'home') continue;
      const pose = ctx.hierarchy.getWorldPose(ball.id);
      if (pose && Math.hypot(pose.position[0] - ball.home[0], pose.position[1] - ball.home[1], pose.position[2] - ball.home[2]) > 0.3) restoreDisplaced(ball);
    }
  }
  // Poses were written quietly: the guests get them a few times a second, as one difference.
  flushTimer += dt;
  if (moved && flushTimer >= 0.05) { moved = false; flushTimer = 0; ctx.world.flush(); }
}

// ---------------------------------------------------------------- the desks

function press(slotId) {
  const match = /^bw-l(\d+)-(join|leave|bumpers|assist|new|cheer)$/.exec(slotId);
  if (!match) return;
  const L = lanes[Number(match[1])];
  if (!L) return;
  const action = match[2];
  const player = nearestPlayer([L.x, 1.4, LAYOUT.deskZ], 6);
  let message = '';
  if (action === 'join') message = join(L, player);
  else if (action === 'leave') { if (player) { leave(L, player.id); if (L.leaving.length) message = 'You leave when the ball is done.'; } }
  else if (action === 'bumpers') {
    if (L.phase === 'rolling') message = 'Wait for the ball to finish.';
    else {
      L.bumpers = !L.bumpers;
      ctx.world.setSlotEnabled(L.ids.rail(0), L.bumpers);
      ctx.world.setSlotEnabled(L.ids.rail(1), L.bumpers);
      sound([L.x, 0.3, FOUL + 1], { frequency: 300, pitchDrop: 120, noiseMix: 0.3, durationMs: 200, volume: 0.4 });
    }
  } else if (action === 'assist') L.assist = (L.assist + 1) % ASSIST_LEVELS.length;
  else if (action === 'new') {
    if (L.phase === 'rolling' || L.phase === 'settling') message = 'Wait for the ball to finish.';
    else {
      if (L.game) L.game = newGame(L.game.players);
      resetPins(L);
      L.phase = 'ready';
    }
  } else if (action === 'cheer') {
    burst(deckPoint(L), '#ff58d6', 90);
    sound([L.x, 1.5, 0], { frequency: 0, noiseMix: 1, durationMs: 900, volume: 0.35 });
    sound([L.x, 1.5, 0], { frequency: 420, pitchDrop: -200, noiseMix: 0.5, durationMs: 500, volume: 0.25 });
  }
  paintLane(L);
  if (message) set(L.ids.status, 'uiElement', 'text', message);
}

function init() {
  ready = true;
  for (const L of lanes) paintLane(L);
  refreshHall();
}

return {
  /** What a test reads back; nothing in the world uses it. */
  state: { lanes: lanes, balls: balls },
  onUIEvent(event) {
    if (event.type !== 'press' || !ctx.world.isHost()) return;
    press(event.slotId);
  },
  onPlayerLeft(player) {
    if (!ctx.world.isHost()) return;
    for (const L of lanes) if (L.game && L.game.players.some((p) => p.id === player.id)) { leave(L, player.id); paintLane(L); }
  },
  tick(dt) {
    if (!ctx.world.isHost()) return;
    if (!ready) init();
    everyFrame(dt);
    for (let n = ctx.time.fixed(STEP, 6); n > 0; n--) simulate(STEP);
    afterFrame(dt);
  }
};
`;

const MACHINE_DATA = {
	materials: BALL_MATERIALS.map((material, i) => ({ name: material.name, chip: material.chip, finish: material.finish, albedo: (ballMaterial(i, 0) as { albedo: { assetId: string } }).albedo.assetId })),
	finishes: BALL_FINISHES,
	rails: [...new Set(BOWLING.returnX)],
	railY: BOWLING.ballRestY,
	balls: Array.from({ length: CUSTOM_BALL_COUNT }, (_, k) => ({ id: customBallId(k), home: customBallHome(k) })),
	preview: MACHINE.previewId,
	buttons: { finish: MACHINE_BUTTONS.finish, make: MACHINE_BUTTONS.make, name: MACHINE_BUTTONS.name, material: Array.from({ length: BALL_MATERIALS.length }, (_, i) => materialButtonId(i)) }
};

/**
 * The ball machine's panel: pick a material (a button each) and a finish, watch the ball in the window turn in it, and make the ball: one of
 * the machine's balls (hidden until now) is given that material and put on the tray, where anybody can take it and bowl with it like any other.
 */
export const MACHINE_SCRIPT = String.raw`
const DATA = ${JSON.stringify(MACHINE_DATA)};
const MESSAGE_TIME = 3.5;
let pick = 0;
let finish = DATA.materials[0].finish;
let next = 0;
let turn = 0;
let clock = 0;
let message = '';
let messageUntil = 0;
let shownName = '';

const text = (id, value) => ctx.world.setComponentField(id, 'uiElement', 'text', value, true);
const materialOf = (i, f) => ({ type: 'material', albedo: { kind: 'asset', assetId: DATA.materials[i].albedo }, mapping: 'mesh', tiling: 1, roughness: DATA.finishes[f].roughness, metallic: DATA.finishes[f].metallic });

function paint() {
  const m = DATA.materials[pick];
  const label = message && clock < messageUntil ? message : m.name + ' · ' + DATA.finishes[finish].name;
  if (label !== shownName) { shownName = label; text(DATA.buttons.name, label); }
  DATA.buttons.material.forEach((id, i) => text(id, (i === pick ? '● ' : '') + DATA.materials[i].name));
  text(DATA.buttons.finish, 'Finish: ' + DATA.finishes[finish].name);
  ctx.world.setComponent(DATA.preview, materialOf(pick, finish));
}

function say(value) { message = value; messageUntil = clock + MESSAGE_TIME; paint(); }

/** The next of the machine's balls that is free: hidden, or waiting on the tray, and not in anybody's hand. */
function freeBall() {
  for (let n = 0; n < DATA.balls.length; n++) {
    const at = (next + n) % DATA.balls.length;
    const ball = DATA.balls[at];
    if (ctx.grab.isSlotHeld(ball.id)) continue;
    const slot = ctx.hierarchy.getSlot(ball.id);
    if (!slot) continue;
    let free = slot.disabled === true;
    if (!free) {
      const pose = ctx.hierarchy.getWorldPose(ball.id);
      const at = pose ? pose.position : null;
      // Waiting on the tray, or on the return of a lane it was bowled on: nobody has it, so it can be made again.
      free = !!at && (Math.hypot(at[0] - ball.home[0], at[1] - ball.home[1], at[2] - ball.home[2]) < 0.15
        || (Math.abs(at[1] - DATA.railY) < 0.06 && at[2] > 1.5 && at[2] < 3.8 && DATA.rails.some((x) => Math.abs(at[0] - x) < 0.12)));
    }
    if (free) return at;
  }
  return -1;
}

function make() {
  const at = freeBall();
  if (at < 0) { say('All the balls are out. Put one back on the tray.'); return; }
  const ball = DATA.balls[at];
  next = at + 1;
  ctx.world.setComponent(ball.id, materialOf(pick, finish));
  ctx.world.setWorldPose(ball.id, { position: ball.home, rotation: [0, 0, 0, 1] });
  ctx.world.setSlotEnabled(ball.id, true);
  ctx.particles.burst({ color: DATA.materials[pick].chip, count: 70, durationMs: 1000 });
  ctx.audio.play({ frequency: 520, pitchDrop: -260, noiseMix: 0.15, durationMs: 420, volume: 0.45 });
  say('Your ' + DATA.materials[pick].name + ' ball is on the tray!');
}

return {
  onUIEvent(event) {
    if (event.type !== 'press' || !ctx.world.isHost()) return;
    const at = DATA.buttons.material.indexOf(event.slotId);
    if (at >= 0) { pick = at; finish = DATA.materials[at].finish; message = ''; paint(); }
    else if (event.slotId === DATA.buttons.finish) { finish = (finish + 1) % DATA.finishes.length; message = ''; paint(); }
    else if (event.slotId === DATA.buttons.make) make();
  },
  tick(dt) {
    if (!ctx.world.isHost()) return;
    clock += dt;
    if (shownName === '') paint();
    else if (message && clock >= messageUntil) { message = ''; paint(); }
    turn += dt * 0.7;
    ctx.world.setLocalPose(DATA.preview, { rotation: ctx.math.quatMultiply(ctx.math.quatFromAxisAngle([0, 1, 0], turn), ctx.math.quatFromAxisAngle([1, 0, 0], 0.35)) }, false);
  }
};
`;
