import type { Frame } from './arcadeKit.ts';

/**
 * The script pieces every arcade machine shares. They are source text, put together by `machineScript` into the body of the
 * machine's code block, so each machine runs on its own with no help from the engine beyond `ctx`.
 */

/** Machine coordinates (x right, y up, z away from the players) and world ones, for the frame `F` of the machine. */
export function preludeSource(frame: Frame): string {
	return `
const F = ${JSON.stringify({ o: frame.o, r: frame.r, d: frame.d })};
const toLocal = (p) => { const x = p[0] - F.o[0], z = p[2] - F.o[2]; return [x * F.r[0] + z * F.r[2], p[1] - F.o[1], x * F.d[0] + z * F.d[2]]; };
const toWorld = (l) => [F.o[0] + F.r[0] * l[0] + F.d[0] * l[2], F.o[1] + l[1], F.o[2] + F.r[2] * l[0] + F.d[2] * l[2]];
const YAW = ${frame.yaw};
const yawQ = [0, Math.sin(YAW / 2), 0, Math.cos(YAW / 2)];
/** The rotation that points a slot's +Z along the machine-coordinates direction v (nose up when v goes up). */
const aimQ = (v) => { const yaw = YAW + Math.atan2(v[0], v[2]); const pitch = -Math.atan2(v[1], Math.hypot(v[0], v[2])); const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2); return [cy * sp, sy * cp, -sy * sp, cy * cp]; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const makeRand = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const set = (id, type, field, value, broadcast) => ctx.world.setComponentField(id, type, field, value, broadcast !== false);
const setText = (id, value) => set(id, 'uiElement', 'text', value);
const slotOf = (id) => ctx.hierarchy.getSlot(id);
const holderOf = (id) => { const state = slotOf(id) && slotOf(id).components.find((c) => c.type === 'scriptState'); return (state && state.data && state.data.holder) || ''; };
const posOf = (id) => { const pose = ctx.hierarchy.getWorldPose(id); return pose ? toLocal(pose.position) : null; };
const place = (id, local, rotation, broadcast) => ctx.world.setWorldPose(id, rotation ? { position: toWorld(local), rotation } : { position: toWorld(local) }, broadcast === true);
const cues = [];
const later = (seconds, fn) => cues.push({ t: seconds, fn });
const runCues = (dt) => { for (let i = cues.length - 1; i >= 0; i--) { cues[i].t -= dt; if (cues[i].t <= 0) cues.splice(i, 1)[0].fn(); } };
const soundAt = (local, frequency, volume, durationMs, drop, noise) => ctx.world.spawn({ name: 'Impact Sound', position: toWorld(local), components: [{ type: 'impactSound', frequency, pitchDrop: drop || 0, noiseMix: noise === undefined ? 0.1 : noise, durationMs: durationMs || 200, volume: volume === undefined ? 0.5 : volume }, { type: 'expires', expiresAt: Date.now() + (durationMs || 200) + 600 }] });
const burstAt = (local, color, count) => ctx.world.spawn({ name: 'Particle Burst', position: toWorld(local), components: [{ type: 'particleBurst', color, count: count || 14, durationMs: 700 }, { type: 'expires', expiresAt: Date.now() + 700 }] });
const thudAt = (local, volume) => soundAt(local, 130, volume === undefined ? 0.6 : volume, 140, 80, 0.6);
const jingleAt = (local, win) => (win ? [523, 659, 784, 1047] : [392, 349, 311, 262]).forEach((frequency, i) => later(i * 0.14, () => soundAt(local, frequency, 0.5, 380)));
`;
}

/** Following a held object and working out how fast it is moving when let go. */
export const THROW_SOURCE = `
const GRAVITY = 9.8;
/** One thing a player picks up, in machine coordinates: home pose, what it is doing and the last positions while held. */
function makeBody(id, home) {
	return { id, home, mode: 'home', pos: home.slice(), vel: [0, 0, 0], samples: [], wasHeld: false, age: 0, holder: '', wait: 0, flags: {} };
}
/** Call every frame, before moving the body. Returns 'held', 'released' (this frame) or '' and fills pos / vel. */
function followHand(body, dt, clock) {
	if (ctx.grab.isSlotHeld(body.id)) {
		const p = posOf(body.id);
		if (p) { body.samples.push({ p, t: clock }); body.pos = p; }
		while (body.samples.length > 2 && clock - body.samples[0].t > 0.12) body.samples.shift();
		body.wasHeld = true;
		body.mode = 'held';
		body.holder = holderOf(body.id);
		return 'held';
	}
	if (body.wasHeld) {
		body.wasHeld = false;
		const a = body.samples[0], b = body.samples[body.samples.length - 1];
		const span = b ? b.t - a.t : 0;
		body.vel = span > 0.015 ? [(b.p[0] - a.p[0]) / span, (b.p[1] - a.p[1]) / span, (b.p[2] - a.p[2]) / span] : [0, 0, 0];
		const speed = len(body.vel);
		if (speed > 18) body.vel = body.vel.map((v) => (v * 18) / speed);
		body.samples = [];
		body.holder = holderOf(body.id);
		return 'released';
	}
	return '';
}
/** Puts a body back where it started. */
function sendHome(body) {
	body.mode = 'home'; body.pos = body.home.slice(); body.vel = [0, 0, 0]; body.age = 0; body.flags = {};
	place(body.id, body.home, body.homeRotation, true);
}
`;

/** Seats, turns, the control panel buttons, the boards and the best scores: the part of every machine that is not the game itself. */
export const SESSION_SOURCE = `
function createSession(opts) {
	const ids = opts.ids;
	const maxSeats = opts.maxSeats || 4;
	const s = { phase: 'idle', mode: '1p', seats: [], turn: 0, joinLeft: 0, resultLeft: 0, pause: 0, note: '', winners: [], dirty: true, lastSecond: -1, clock: 0 };
	const seatOf = (id) => s.seats.find((seat) => seat.id === id);
	const mkSeat = (player) => ({ id: player.id, name: player.name, score: 0, attempts: 0, last: '', data: {} });
	const playerOf = (event) => { const who = ctx.world.getPlayer(event.remoteGuestId ? event.remoteGuestId + ':right' : 'right'); return { id: who.id, name: who.name }; };
	const names = () => s.seats.map((seat) => seat.name).join(', ');
	const refreshTop = () => {
		if (!opts.leaderboard || !ctx.leaderboards.available) return;
		Promise.resolve(ctx.leaderboards.showOn(ids.top, opts.leaderboard.name, { limit: 5 })).catch(() => {});
	};
	s.current = () => (s.phase === 'playing' && opts.perVisit ? s.seats[s.turn] : undefined);
	s.say = (message) => { if (s.note !== message) { s.note = message; s.dirty = true; } };
	/** The seat a throw or a hit by this holder counts for, if any. */
	s.who = (holderId) => {
		if (s.phase !== 'playing') return undefined;
		const pool = opts.perVisit ? [s.seats[s.turn]] : s.seats;
		const found = pool.find((seat) => seat && seat.id === holderId);
		return found || (!holderId && s.mode === '1p' ? s.seats[0] : undefined);
	};
	s.attemptsLeft = () => { const seat = s.seats[s.turn]; return seat ? opts.perVisit - (seat.attempts % opts.perVisit) : 0; };
	s.round = () => { const seat = s.seats[s.turn]; return seat ? Math.min(opts.rounds, Math.floor(seat.attempts / opts.perVisit) + 1) : 1; };
	function begin() {
		s.phase = 'playing'; s.turn = 0; s.pause = 0; s.note = ''; s.winners = [];
		s.seats.forEach((seat) => { seat.score = 0; seat.attempts = 0; seat.last = ''; seat.data = {}; });
		if (opts.onStart) opts.onStart(s);
		s.dirty = true;
	}
	s.finish = (note) => {
		if (s.phase !== 'playing') return;
		s.phase = 'finished'; s.resultLeft = opts.resultSeconds || 9; s.pause = 0;
		const value = (seat) => (opts.value ? opts.value(seat) : seat.score);
		const better = (a, b) => (opts.order === 'low' ? a < b : a > b);
		let best = null;
		s.seats.forEach((seat) => { if (best === null || better(value(seat), best)) best = value(seat); });
		s.winners = s.seats.filter((seat) => value(seat) === best).map((seat) => seat.id);
		const winnerNames = s.seats.filter((seat) => s.winners.includes(seat.id)).map((seat) => seat.name).join(' & ');
		s.note = note || (s.seats.length < 2 ? 'Game over! Final score: ' + (s.seats[0] ? opts.cell ? opts.cell(s.seats[0]) : value(s.seats[0]) : 0) : s.winners.length > 1 ? 'A draw between ' + winnerNames + '!' : winnerNames + ' wins!');
		jingleAt(opts.at || [0, 1.6, -1.5], true);
		if (opts.leaderboard && ctx.leaderboards.available) {
			Promise.all(s.seats.filter((seat) => !seat.bot).map((seat) => ctx.leaderboards.submit(opts.leaderboard.name, { id: seat.id, name: seat.name }, value(seat), { order: opts.order || 'high' }))).then(refreshTop).catch(() => {});
		}
		if (opts.onFinish) opts.onFinish(s);
		s.dirty = true;
	};
	function toIdle() {
		s.phase = 'idle'; s.seats = []; s.turn = 0; s.pause = 0; s.winners = []; s.note = '';
		if (opts.onIdle) opts.onIdle(s);
		refreshTop();
		s.dirty = true;
	}
	function join(player) {
		if (s.phase !== 'joining') return;
		if (seatOf(player.id)) return s.say('You are already in, ' + player.name + '.');
		if (s.seats.length >= maxSeats) return s.say('The game is full.');
		s.seats.push(mkSeat(player));
		s.joinLeft = opts.joinSeconds || 20;
		s.note = '';
		s.dirty = true;
		if (s.seats.length >= maxSeats) begin();
	}
	function leave(player) {
		const index = s.seats.findIndex((seat) => seat.id === player.id);
		if (index < 0 || s.phase === 'idle' || s.phase === 'finished') return;
		s.seats.splice(index, 1);
		if (index < s.turn) s.turn -= 1;
		if (s.turn >= s.seats.length) s.turn = 0;
		if (opts.onLeave) opts.onLeave(index, s);
		if (!s.seats.some((seat) => !seat.bot)) return toIdle();
		if (s.phase === 'playing' && s.mode === 'versus' && s.seats.length < 2) return s.finish(s.seats[0].name + ' wins: the others left.');
		s.dirty = true;
	}
	s.onUIEvent = (event) => {
		if (event.type !== 'press') return;
		const player = playerOf(event);
		const free = s.phase === 'idle' || s.phase === 'finished';
		if (event.slotId === ids.one) {
			if (free) { s.mode = '1p'; s.seats = [mkSeat(player)]; begin(); } else s.say('A game is on: wait for it to end.');
		} else if (event.slotId === ids.versus) {
			if (free) { s.mode = 'versus'; s.seats = [mkSeat(player)]; s.phase = 'joining'; s.joinLeft = opts.joinSeconds || 20; s.note = ''; s.winners = []; s.dirty = true; if (opts.onJoining) opts.onJoining(s); }
			else join(player);
		} else if (event.slotId === ids.join) {
			join(player);
		} else if (event.slotId === ids.start) {
			if (s.phase === 'joining' && s.seats.length >= 2 && seatOf(player.id)) begin();
			else if (s.phase === 'joining') s.say('Versus needs at least 2 players.');
		} else if (event.slotId === ids.leave) {
			leave(player);
		}
	};
	/** A player left the world or the game: free their seat. */
	s.drop = (playerId) => leave({ id: playerId });
	/** Counts one finished attempt for the player whose turn it is: points are added up, or the best is kept. */
	s.attempt = (points, label) => {
		const seat = s.current();
		if (!seat || s.pause > 0) return false;
		seat.attempts += 1;
		seat.score = opts.best ? Math.max(seat.score, points) : seat.score + points;
		seat.last = label || '';
		if (seat.attempts % opts.perVisit === 0) s.pause = opts.pauseSeconds === undefined ? 2.2 : opts.pauseSeconds;
		s.dirty = true;
		return true;
	};
	function advance() {
		if (s.seats.every((seat) => seat.attempts >= opts.perVisit * opts.rounds)) return s.finish();
		s.turn = (s.turn + 1) % s.seats.length;
		s.note = '';
		if (opts.onTurn) opts.onTurn(s);
		s.dirty = true;
	}
	function statusLine() {
		if (s.phase === 'joining') return (s.note ? s.note + '\\n' : '') + 'Versus: ' + names() + '. Press JOIN to play. Starting in ' + Math.max(0, Math.ceil(s.joinLeft)) + ' s, or press START.';
		if (s.phase === 'playing') {
			const game = opts.status ? opts.status(s) : '';
			return s.note ? s.note + (game ? '\\n' + game : '') : game;
		}
		if (s.phase === 'finished') return s.note;
		return s.note || opts.intro;
	}
	function boardStatus() {
		if (s.phase === 'joining') return 'Joining: ' + s.seats.length + '/' + maxSeats;
		if (s.phase === 'playing') return opts.boardStatus ? opts.boardStatus(s) : 'Playing';
		if (s.phase === 'finished') return s.note;
		return 'Press 1 PLAYER or VERSUS';
	}
	function render() {
		setText(ids.message, statusLine());
		const rows = s.seats.map((seat, index) => ({
			name: seat.name,
			cells: [opts.cell ? opts.cell(seat) : String(seat.score)],
			highlight: s.phase === 'playing' && !!opts.perVisit && index === s.turn,
			isLeader: s.phase === 'finished' && s.winners.includes(seat.id)
		}));
		for (const board of [ids.board, ...(opts.extraBoards || [])]) {
			set(board, 'scoreboard', 'rows', rows);
			set(board, 'scoreboard', 'status', boardStatus());
		}
	}
	/** Call every frame on the host. */
	s.tick = (dt) => {
		s.clock += dt;
		runCues(dt);
		if (s.phase === 'joining') {
			s.joinLeft -= dt;
			const second = Math.ceil(s.joinLeft);
			if (second !== s.lastSecond) { s.lastSecond = second; s.dirty = true; }
			if (s.joinLeft <= 0) {
				if (s.seats.length >= 2) begin();
				else { toIdle(); s.say('Nobody joined. Try again!'); }
			}
		} else if (s.phase === 'finished') {
			s.resultLeft -= dt;
			if (s.resultLeft <= 0) toIdle();
		} else if (s.phase === 'playing' && s.pause > 0) {
			s.pause -= dt;
			if (s.pause <= 0) { s.pause = 0; advance(); }
		}
		if (s.dirty) { s.dirty = false; render(); }
	};
	s.start = () => { refreshTop(); render(); };
	return s;
}
`;

export interface MachineScript {
	frame: Frame;
	/** The game itself: it can use `createSession`, the prelude, and returns the handlers of the code block. */
	game: string;
}

/** The body of a machine's code block: prelude, shared pieces, then the game. */
export function machineScript({ frame, game }: MachineScript): string {
	return `${preludeSource(frame)}${THROW_SOURCE}${SESSION_SOURCE}${game}`;
}
