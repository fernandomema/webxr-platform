import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { NEON, box, cylinder, grabbable, machineIds, machineShell, neonSign, toWorld, yawQuat } from './arcadeKit.ts';
import type { Frame, Vec3 } from './arcadeKit.ts';
import { machineScript } from './arcadeSession.ts';

/** Whack-a-mole: nine holes, moles that pop up and down, four mallets. Forty-five seconds; a hit is a point for whoever swung. */
export const WHACK = {
	p: 'wm',
	name: 'Whack-a-Mole',
	top: 1.0,
	/** Where the holes are, as [x, z]. */
	holes: [-0.36, 0, 0.36].flatMap((x) => [0.2, 0.55, 0.9].map((z) => [x, z] as [number, number])),
	moleRadius: 0.07,
	seconds: 45,
	malletCount: 4,
	/** Mallet head: how far it can be from a mole sideways, how fast it must be going down, and how high above the table it counts. */
	reach: 0.15,
	hitSpeed: 1.0,
	hitHeight: 0.3,
	malletHomes: [0, 1, 2, 3].map((index) => [-1.15, 1.12, 0.1 + index * 0.3] as Vec3)
} as const;

export const moleId = (index: number) => `wm-mole-${index}`;
export const malletId = (index: number) => `wm-mallet-${index}`;
export const malletHeadId = (index: number) => `wm-mallet-${index}-head`;

const GAME = `
const W = ${JSON.stringify(WHACK)};
const UP = W.top + 0.1, DOWN = W.top - 0.14;
const rand = makeRand(20260508);
let clock = 0, timeLeft = 0, lastSecond = -1, nextPop = 0;
const moles = W.holes.map((hole, i) => ({ id: 'wm-mole-' + i, x: hole[0], z: hole[1], state: 'down', t: 0, stay: 1, y: DOWN }));
const mallets = [];
for (let i = 0; i < W.malletCount; i++) mallets.push({ id: 'wm-mallet-' + i, head: 'wm-mallet-' + i + '-head', home: W.malletHomes[i], prev: null, vel: [0, 0, 0], head3: null, free: 0, cooldown: 0 });

const S = createSession({
	ids: ${JSON.stringify(machineIds(WHACK.p))},
	maxSeats: 4,
	leaderboard: { name: 'arcade-whack' },
	at: [0, 1.8, 0.5],
	intro: 'Grab a mallet and whack the moles when they pop up! ' + W.seconds + ' seconds. 1 PLAYER plays alone, VERSUS races your friends: each hit is a point for whoever swung.',
	status: (s) => 'Time left: ' + Math.ceil(timeLeft) + ' s\\n' + s.seats.map((seat) => seat.name + ' ' + seat.score).join('   '),
	boardStatus: () => Math.ceil(timeLeft) + ' s left',
	onStart: () => { timeLeft = W.seconds; lastSecond = -1; nextPop = 0.6; moles.forEach((m) => { m.state = 'down'; m.y = DOWN; }); }
});

function popMole(playing) {
	const free = moles.filter((m) => m.state === 'down');
	const busy = moles.length - free.length;
	const limit = playing ? 3 + Math.max(0, S.seats.length - 1) : 2;
	if (!free.length || busy >= limit) return;
	const mole = free[Math.floor(rand() * free.length)];
	const pace = playing ? 1 - (1 - timeLeft / W.seconds) * 0.45 : 1;
	mole.state = 'rising'; mole.t = 0; mole.stay = (0.7 + rand() * 0.7) * pace;
}

function animate(mole, dt) {
	if (mole.state === 'down') return;
	mole.t += dt;
	if (mole.state === 'rising') {
		mole.y = DOWN + (UP - DOWN) * Math.min(1, mole.t / 0.16);
		if (mole.t >= 0.16) { mole.state = 'up'; mole.t = 0; }
	} else if (mole.state === 'up') {
		mole.y = UP;
		if (mole.t >= mole.stay) { mole.state = 'falling'; mole.t = 0; }
	} else if (mole.state === 'falling' || mole.state === 'hit') {
		const time = mole.state === 'hit' ? 0.12 : 0.2;
		mole.y = Math.max(DOWN, mole.y - ((UP - DOWN) / time) * dt);
		if (mole.y <= DOWN) { mole.state = 'down'; mole.y = DOWN; }
	}
	place(mole.id, [mole.x, mole.y, mole.z], yawQ, mole.state === 'down');
}

function trackMallet(mallet, dt) {
	const head = posOf(mallet.head);
	if (!head) return;
	if (mallet.head3 && dt > 0) {
		const v = [(head[0] - mallet.head3[0]) / dt, (head[1] - mallet.head3[1]) / dt, (head[2] - mallet.head3[2]) / dt];
		mallet.vel = mallet.vel.map((old, i) => old * 0.4 + v[i] * 0.6);
	}
	mallet.head3 = head;
	mallet.cooldown = Math.max(0, mallet.cooldown - dt);
	const held = ctx.grab.isSlotHeld(mallet.id);
	mallet.free = held ? 0 : mallet.free + dt;
	if (mallet.free > 6) {
		const root = posOf(mallet.id);
		if (root && Math.hypot(root[0] - mallet.home[0], root[2] - mallet.home[2]) > 0.3) { mallet.free = 0; mallet.head3 = null; place(mallet.id, mallet.home, undefined, true); }
	}
	if (!held || mallet.cooldown > 0 || mallet.vel[1] > -W.hitSpeed) return;
	if (head[1] > W.top + W.hitHeight || head[1] < W.top - 0.05) return;
	for (const mole of moles) {
		if (mole.state !== 'up' && mole.state !== 'rising') continue;
		if (mole.y < W.top + 0.03) continue;
		if (Math.hypot(head[0] - mole.x, head[2] - mole.z) > W.reach) continue;
		mole.state = 'hit'; mole.t = 0;
		mallet.cooldown = 0.25;
		thudAt([mole.x, W.top + 0.1, mole.z], 0.7);
		burstAt([mole.x, W.top + 0.15, mole.z], '#facc15', 8);
		if (S.phase !== 'playing') S.say('Whack! (practice)');
		else {
			const seat = S.who(holderOf(mallet.id));
			if (seat) { seat.score += 1; S.dirty = true; }
		}
		return;
	}
}

return {
	onPlayerReady() { S.start(); },
	onUIEvent(event) { S.onUIEvent(event); },
	tick(dt) {
		if (!ctx.world.isHost()) return;
		clock += dt;
		const playing = S.phase === 'playing';
		const attract = S.phase === 'idle' || S.phase === 'joining';
		if (playing || attract) {
			nextPop -= dt;
			if (nextPop <= 0) { popMole(playing); nextPop = playing ? 0.25 + rand() * 0.55 * (timeLeft / W.seconds + 0.4) : 1.8 + rand(); }
		}
		for (const mole of moles) animate(mole, dt);
		for (const mallet of mallets) trackMallet(mallet, dt);
		if (playing) {
			timeLeft = Math.max(0, timeLeft - dt);
			const second = Math.ceil(timeLeft);
			if (second !== lastSecond) { lastSecond = second; S.dirty = true; }
			if (timeLeft <= 0) S.finish();
		}
		S.tick(dt);
	}
};
`;

function tableParts(root: string): Slot[] {
	const parts: Slot[] = [
		box('wm-table', 'Table', [0, WHACK.top - 0.06, 0.55], [1.3, 0.12, 1.3], '#7e22ce', { parentId: root }, true),
		box('wm-back', 'Back Wall', [0, 2.1, 1.28], [2.8, 1.8, 0.06], '#3b0764', { parentId: root }, true),
		box('wm-leg-0', 'Leg', [-0.55, 0.47, 0.0], [0.1, 0.94, 0.1], '#4c1d95', { parentId: root }),
		box('wm-leg-1', 'Leg', [0.55, 0.47, 0.0], [0.1, 0.94, 0.1], '#4c1d95', { parentId: root }),
		box('wm-leg-2', 'Leg', [-0.55, 0.47, 1.1], [0.1, 0.94, 0.1], '#4c1d95', { parentId: root }),
		box('wm-leg-3', 'Leg', [0.55, 0.47, 1.1], [0.1, 0.94, 0.1], '#4c1d95', { parentId: root }),
		box('wm-rack', 'Mallet Rack', [-1.15, 0.92, 0.55], [0.3, 0.04, 1.4], '#581c87', { parentId: root }, true),
		box('wm-rack-leg-0', 'Rack Leg', [-1.15, 0.45, 0.0], [0.08, 0.9, 0.08], '#4c1d95', { parentId: root }),
		box('wm-rack-leg-1', 'Rack Leg', [-1.15, 0.45, 1.1], [0.08, 0.9, 0.08], '#4c1d95', { parentId: root })
	];
	for (const [index, [x, z]] of WHACK.holes.entries()) {
		parts.push(cylinder(`wm-hole-${index}`, 'Hole', [x, WHACK.top + 0.003, z], 0.2, 0.006, '#0a0a0a', { parentId: root }));
	}
	return parts;
}

/** A mole: a brown body, a head, a pink nose and two eyes, hidden under the table top until the script raises it. */
function mole(frame: Frame, index: number): Slot[] {
	const [x, z] = WHACK.holes[index];
	const id = moleId(index);
	return [
		createSlot({ id, name: 'Mole', position: toWorld(frame, [x, WHACK.top - 0.14, z]), rotation: yawQuat(frame.yaw), scale: [0.14, 0.2, 0.14], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#92400e' }] }),
		createSlot({ id: `${id}-head`, parentId: id, name: 'Mole Head', position: [0, 0.5, 0], scale: [1.1, 0.8, 1.1], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#a16207' }] }),
		createSlot({ id: `${id}-nose`, parentId: id, name: 'Mole Nose', position: [0, 0.5, -0.5], scale: [0.35, 0.25, 0.3], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#f472b6' }] }),
		createSlot({ id: `${id}-eye-l`, parentId: id, name: 'Eye', position: [-0.25, 0.7, -0.42], scale: [0.16, 0.2, 0.1], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#0f172a' }] }),
		createSlot({ id: `${id}-eye-r`, parentId: id, name: 'Eye', position: [0.25, 0.7, -0.42], scale: [0.16, 0.2, 0.1], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#0f172a' }] })
	];
}

/** A mallet stands upright, head on top, so a swing from above brings the head down on a mole. */
function mallet(frame: Frame, index: number): Slot[] {
	const id = malletId(index);
	const colors = [NEON.pink, NEON.cyan, NEON.yellow, NEON.green];
	return [
		grabbable(id, 'Mallet', toWorld(frame, WHACK.malletHomes[index]), {}, [{ type: 'container' }]),
		box(`${id}-handle`, 'Mallet Handle', [0, 0, 0], [0.045, 0.44, 0.045], '#a16207', { parentId: id }, true),
		box(malletHeadId(index), 'Mallet Head', [0, 0.27, 0], [0.2, 0.13, 0.13], colors[index % colors.length], { parentId: id }, true)
	];
}

export function buildWhack(frame: Frame): Slot[] {
	const root = machineIds(WHACK.p).root;
	return [
		...machineShell({
			p: WHACK.p,
			name: WHACK.name,
			frame,
			color: NEON.violet,
			tagline: 'Hit as many as you can',
			panelAt: [1.2, 1.3, -0.1],
			boardAt: [-0.65, 2.1, 1.22],
			topAt: [0.75, 2.1, 1.22],
			code: machineScript({ frame, game: GAME })
		}),
		...neonSign(WHACK.p, 'WHACK-A-MOLE', root, [0, 3.2, 1.22], 2.0, NEON.violet),
		...tableParts(root),
		...Array.from({ length: WHACK.holes.length }, (_, index) => mole(frame, index)).flat(),
		...Array.from({ length: WHACK.malletCount }, (_, index) => mallet(frame, index)).flat()
	];
}
