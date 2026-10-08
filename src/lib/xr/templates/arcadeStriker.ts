import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { NEON, box, grabbable, machineIds, machineShell, neonSign, toWorld } from './arcadeKit.ts';
import type { Frame, Vec3 } from './arcadeKit.ts';
import { machineScript } from './arcadeSession.ts';

/** Strength tester: hit the pad with the big mallet and the lights climb the tower as high as the blow was hard. */
export const STRIKER = {
	p: 'st',
	name: 'Strength Tester',
	padTop: 0.9,
	padZ: 0.5,
	/** Half the size of the pad. */
	padHalf: 0.3,
	/** How high above the pad the head of the mallet counts as striking it. */
	hitHeight: 0.25,
	/** Speed of the mallet head, in m/s, that makes a perfect 100. */
	topSpeed: 10,
	minSpeed: 1.2,
	levels: 10,
	towerZ: 1.35,
	towerBottom: 1.2,
	rounds: 3,
	perVisit: 1,
	malletHome: [-1.05, 0.5, -0.3] as Vec3
} as const;

export const STRIKER_IDS = { mallet: 'st-mallet', head: 'st-mallet-head', segments: Array.from({ length: 10 }, (_, index) => `st-seg-${index}`), bell: 'st-bell' } as const;

const COLORS = ['#22c55e', '#22c55e', '#22c55e', '#eab308', '#eab308', '#eab308', '#f97316', '#f97316', '#ef4444', '#ef4444'];

const GAME = `
const T = ${JSON.stringify(STRIKER)};
const SEGMENTS = ${JSON.stringify(STRIKER_IDS.segments)};
const COLORS = ${JSON.stringify(COLORS)};
const DIM = '#1f2937';
const mallet = { id: 'st-mallet', head: 'st-mallet-head', prev: null, vel: [0, 0, 0], cooldown: 0, free: 0 };
let meter = { level: 0, shown: 0, t: 0, hold: 0 };
let lit = -1;

const S = createSession({
	ids: ${JSON.stringify(machineIds(STRIKER.p))},
	maxSeats: 4,
	perVisit: T.perVisit,
	rounds: T.rounds,
	best: true,
	leaderboard: { name: 'arcade-striker' },
	at: [0, 1.7, 0],
	intro: 'Grab the big mallet and hit the pad as hard as you can. 1 PLAYER takes ' + T.rounds + ' blows and keeps the best; VERSUS takes turns, one blow each round.',
	status: (s) => {
		const seat = s.seats[s.turn];
		return seat ? seat.name + ': blow ' + s.round() + ' of ' + T.rounds : '';
	},
	boardStatus: (s) => (s.seats[s.turn] ? 'Up: ' + s.seats[s.turn].name + ' (blow ' + s.round() + '/' + T.rounds + ')' : 'Playing')
});

function light(level) {
	if (level === lit) return;
	lit = level;
	SEGMENTS.forEach((id, i) => set(id, 'meshRenderer', 'color', i < level ? COLORS[i] : DIM));
}

/** The result of a blow climbs the tower, then stays for a moment. */
function strike(power) {
	const level = clamp(Math.ceil(power / 10), 0, T.levels);
	meter = { level, shown: 0, t: 0, hold: 2.2 };
	soundAt([0, T.padTop + 0.1, T.padZ], 110, 0.9, 220, 60, 0.7);
	burstAt([0, T.padTop + 0.1, T.padZ], '#fb923c', 10);
	const label = power >= 100 ? 'RING THE BELL! 100' : 'Power ' + power;
	if (S.phase !== 'playing') return S.say('Practice blow: ' + label);
	const seat = S.who(holderOf(mallet.id));
	if (seat && S.attempt(power, label)) return S.say(seat.name + ': ' + label);
	if (!seat) S.say('Wait for your turn. (That one was ' + power + '.)');
}

function trackMallet(dt) {
	const head = posOf(mallet.head);
	if (!head) return;
	if (mallet.prev && dt > 0) {
		const v = [(head[0] - mallet.prev[0]) / dt, (head[1] - mallet.prev[1]) / dt, (head[2] - mallet.prev[2]) / dt];
		mallet.vel = mallet.vel.map((old, i) => old * 0.4 + v[i] * 0.6);
	}
	mallet.prev = head;
	mallet.cooldown = Math.max(0, mallet.cooldown - dt);
	const held = ctx.grab.isSlotHeld(mallet.id);
	mallet.free = held ? 0 : mallet.free + dt;
	if (mallet.free > 6) {
		const root = posOf(mallet.id);
		if (root && Math.hypot(root[0] - T.malletHome[0], root[2] - T.malletHome[2]) > 0.3) { mallet.free = 0; mallet.prev = null; place(mallet.id, T.malletHome, undefined, true); }
	}
	if (!held || mallet.cooldown > 0) return;
	if (head[1] < T.padTop - 0.02 || head[1] > T.padTop + T.hitHeight) return;
	if (Math.abs(head[0]) > T.padHalf || Math.abs(head[2] - T.padZ) > T.padHalf) return;
	const speed = len(mallet.vel);
	if (mallet.vel[1] > -T.minSpeed || speed < T.minSpeed) return;
	mallet.cooldown = 1.5;
	strike(Math.round(clamp(speed / T.topSpeed, 0, 1) * 100));
}

function animateMeter(dt) {
	if (meter.level <= 0 && meter.shown <= 0) { light(0); return; }
	if (meter.shown < meter.level) {
		meter.t += dt;
		const next = Math.min(meter.level, Math.floor(meter.t / 0.055) + 1);
		if (next > meter.shown) {
			meter.shown = next;
			light(next);
			soundAt([0, T.towerBottom + next * 0.22, T.towerZ], 400 + next * 70, 0.25, 90);
			if (next === T.levels) { soundAt([0, 3.5, T.towerZ], 1568, 0.7, 900); burstAt([0, 3.5, T.towerZ], '#facc15', 20); }
		}
	} else {
		meter.hold -= dt;
		if (meter.hold <= 0) { meter = { level: 0, shown: 0, t: 0, hold: 0 }; light(0); }
	}
}

return {
	onPlayerReady() { S.start(); light(0); },
	onUIEvent(event) { S.onUIEvent(event); },
	tick(dt) {
		if (!ctx.world.isHost()) return;
		trackMallet(dt);
		animateMeter(dt);
		S.tick(dt);
	}
};
`;

function towerParts(root: string): Slot[] {
	const { padTop, padZ, padHalf, towerZ, towerBottom } = STRIKER;
	const parts: Slot[] = [
		box('st-pad', 'Strike Pad', [0, padTop - 0.1, padZ], [padHalf * 2, 0.2, padHalf * 2], '#b91c1c', { parentId: root }, true),
		box('st-pad-top', 'Strike Pad Top', [0, padTop + 0.003, padZ], [padHalf * 1.6, 0.006, padHalf * 1.6], '#fca5a5', { parentId: root }),
		box('st-base', 'Base', [0, 0.35, padZ], [0.9, 0.7, 0.9], '#450a0a', { parentId: root }, true),
		box('st-back', 'Tower Back', [0, towerBottom + 1.1, towerZ + 0.12], [0.5, 2.5, 0.06], '#1f2937', { parentId: root }, true),
		box('st-rack', 'Mallet Stand', [STRIKER.malletHome[0], 0.03, STRIKER.malletHome[2]], [0.3, 0.06, 0.3], '#450a0a', { parentId: root }),
		box('st-line', 'Stand Here', [0, 0.006, -0.45], [0.8, 0.012, 0.05], NEON.yellow, { parentId: root }),
		createSlot({ id: STRIKER_IDS.bell, parentId: root, name: 'Bell', position: [0, 3.6, towerZ], scale: [0.3, 0.3, 0.3], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#facc15' }] })
	];
	STRIKER_IDS.segments.forEach((id, index) => parts.push(box(id, `Light ${index + 1}`, [0, towerBottom + index * 0.22 + 0.1, towerZ], [0.24, 0.17, 0.1], '#1f2937', { parentId: root })));
	for (let index = 0; index < STRIKER.levels; index++) {
		parts.push(
			createSlot({
				id: `st-mark-${index}`,
				parentId: root,
				name: `Mark ${(index + 1) * 10}`,
				position: [0.2, towerBottom + index * 0.22 + 0.1, towerZ - 0.052],
				scale: [0.1, 0.1, 1],
				components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#111827' }, { type: 'textDisplay', title: String((index + 1) * 10), lines: [], color: '#111827', scale: 1.2, verticalAlign: 'middle' }]
			})
		);
	}
	return parts;
}

/** The big mallet stands upright, head on top: swing it over the shoulder and bring the head down on the pad. */
function mallet(frame: Frame): Slot[] {
	return [
		grabbable(STRIKER_IDS.mallet, 'Big Mallet', toWorld(frame, STRIKER.malletHome), {}, [{ type: 'container' }]),
		box(`${STRIKER_IDS.mallet}-handle`, 'Mallet Handle', [0, 0, 0], [0.06, 0.9, 0.06], '#a16207', { parentId: STRIKER_IDS.mallet }, true),
		box(STRIKER_IDS.head, 'Mallet Head', [0, 0.55, 0], [0.34, 0.22, 0.22], '#dc2626', { parentId: STRIKER_IDS.mallet }, true)
	];
}

export function buildStriker(frame: Frame): Slot[] {
	const root = machineIds(STRIKER.p).root;
	return [
		...machineShell({
			p: STRIKER.p,
			name: STRIKER.name,
			frame,
			color: NEON.orange,
			tagline: 'Ring the bell at the top',
			panelAt: [1.2, 1.3, -0.1],
			boardAt: [-1.4, 2.3, 1.5],
			topAt: [1.4, 2.3, 1.5],
			code: machineScript({ frame, game: GAME })
		}),
		...neonSign(STRIKER.p, 'STRENGTH', root, [0, 4.1, STRIKER.towerZ + 0.05], 1.6, NEON.orange),
		...towerParts(root),
		...mallet(frame)
	];
}
