import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { NEON, box, cylinder, grabbable, machineIds, machineShell, neonSign, toWorld } from './arcadeKit.ts';
import type { Frame, Vec3 } from './arcadeKit.ts';
import { machineScript } from './arcadeSession.ts';

/** Ring toss: six rings, eight pegs. Three rings a turn, two turns each; the further peg, the more it is worth. */
export const RING_TOSS = {
	p: 'rt',
	name: 'Ring Toss',
	/** The platform the pegs stand on: its top, and where it ends. */
	platformTop: 0.9,
	platform: { x: 0.75, zMin: 0.45, zMax: 1.75 },
	pegHeight: 0.26,
	/** How close to the middle of a peg a ring has to come down to go round it. */
	catchRadius: 0.065,
	ringRadius: 0.08,
	gravity: 9.8,
	count: 6,
	pegs: [
		{ x: -0.5, z: 0.75, points: 10 }, { x: -0.17, z: 0.75, points: 10 }, { x: 0.17, z: 0.75, points: 10 }, { x: 0.5, z: 0.75, points: 10 },
		{ x: -0.33, z: 1.15, points: 20 }, { x: 0, z: 1.15, points: 20 }, { x: 0.33, z: 1.15, points: 20 },
		{ x: 0, z: 1.55, points: 50 }
	],
	rounds: 2,
	perVisit: 3,
	line: -1.2,
	homes: [0, 1, 2, 3, 4, 5].map((index) => [-1.6 + index * 0.2, 0.95, -1.9] as Vec3)
} as const;

export const ringId = (index: number) => `rt-ring-${index}`;

const GAME = `
const R = ${JSON.stringify(RING_TOSS)};
const PEG_TOP = R.platformTop + R.pegHeight;
let clock = 0;
const rings = [];
for (let i = 0; i < R.count; i++) rings.push(makeBody('rt-ring-' + i, R.homes[i]));

const S = createSession({
	ids: ${JSON.stringify(machineIds(RING_TOSS.p))},
	maxSeats: 4,
	perVisit: R.perVisit,
	rounds: R.rounds,
	leaderboard: { name: 'arcade-ringtoss' },
	at: [0, 1.7, -1.2],
	intro: 'Lob the rings onto the pegs: 10, 20 and 50 for the one at the back. 1 PLAYER throws ' + R.perVisit * R.rounds + ' rings, VERSUS plays in turns.',
	status: (s) => {
		const seat = s.seats[s.turn];
		return seat ? seat.name + ': ' + s.attemptsLeft() + ' ring' + (s.attemptsLeft() === 1 ? '' : 's') + ' left, round ' + s.round() + ' of ' + R.rounds : '';
	},
	boardStatus: (s) => (s.seats[s.turn] ? 'Up: ' + s.seats[s.turn].name + ' (round ' + s.round() + '/' + R.rounds + ')' : 'Playing'),
	onStart: () => rings.forEach((r) => { if (r.mode !== 'held') sendHome(r); }),
	onTurn: () => rings.forEach((r) => { if (r.mode !== 'held') sendHome(r); })
});

function register(ring, points, label) {
	if (ring.flags.resolved) return;
	ring.flags.resolved = true;
	if (S.phase !== 'playing') return S.say('Practice throw: ' + label);
	const seat = S.who(ring.holder);
	if (seat && S.attempt(points, label)) return S.say(seat.name + ': ' + label);
	if (!seat) S.say('Wait for your turn. (That one was ' + label + '.)');
}

function updateRing(ring, dt) {
	const state = followHand(ring, dt, clock);
	if (state === 'held') return;
	if (state === 'released') {
		ring.age = 0;
		ring.flags = { resolved: false };
		ring.mode = len(ring.vel) < 1 ? 'drop' : 'flying';
	}
	if (ring.mode === 'flying' || ring.mode === 'drop') {
		ring.age += dt;
		const from = ring.pos.slice();
		ring.pos = [from[0] + ring.vel[0] * dt, from[1] + ring.vel[1] * dt - 0.5 * R.gravity * dt * dt, from[2] + ring.vel[2] * dt];
		ring.vel[1] -= R.gravity * dt;
		if (!ring.flags.resolved && from[1] > PEG_TOP && ring.pos[1] <= PEG_TOP) {
			const t = (from[1] - PEG_TOP) / (from[1] - ring.pos[1]);
			const x = from[0] + (ring.pos[0] - from[0]) * t, z = from[2] + (ring.pos[2] - from[2]) * t;
			const peg = R.pegs.find((p) => Math.hypot(p.x - x, p.z - z) <= R.catchRadius);
			if (peg) {
				ring.mode = 'rest'; ring.wait = 2.5; ring.vel = [0, 0, 0];
				ring.pos = [peg.x, R.platformTop + 0.012, peg.z];
				thudAt(ring.pos, 0.4); soundAt(ring.pos, 988, 0.4, 260);
				if (peg.points >= 50) burstAt([peg.x, PEG_TOP, peg.z], '#facc15', 16);
				register(ring, peg.points, 'Ringer! ' + peg.points);
				place(ring.id, ring.pos, undefined, true);
				return;
			}
		}
		const onPlatform = Math.abs(ring.pos[0]) <= R.platform.x && ring.pos[2] >= R.platform.zMin && ring.pos[2] <= R.platform.zMax;
		const floor = onPlatform ? R.platformTop : 0;
		if (ring.pos[1] <= floor + 0.012 && ring.vel[1] < 0) {
			ring.pos[1] = floor + 0.012; ring.mode = 'rest'; ring.wait = 2.2; ring.vel = [0, 0, 0];
			thudAt(ring.pos, 0.3);
			register(ring, 0, 'No luck: 0');
			place(ring.id, ring.pos, undefined, true);
			return;
		}
		if (ring.age > 8) return sendHome(ring);
		place(ring.id, ring.pos, undefined, false);
		return;
	}
	if (ring.mode === 'rest') {
		ring.wait -= dt;
		if (ring.wait <= 0) sendHome(ring);
	}
}

return {
	onPlayerReady() { S.start(); },
	onUIEvent(event) { S.onUIEvent(event); },
	tick(dt) {
		if (!ctx.world.isHost()) return;
		clock += dt;
		for (const ring of rings) updateRing(ring, dt);
		S.tick(dt);
	}
};
`;

function platformParts(root: string): Slot[] {
	const { x, zMin, zMax } = RING_TOSS.platform;
	const parts: Slot[] = [
		box('rt-platform', 'Peg Platform', [0, RING_TOSS.platformTop - 0.05, (zMin + zMax) / 2], [x * 2, 0.1, zMax - zMin], '#0f766e', { parentId: root }, true),
		box('rt-back', 'Back Wall', [0, 1.8, zMax + 0.1], [3.2, 2.2, 0.06], '#042f2e', { parentId: root }, true),
		box('rt-leg-0', 'Leg', [-x + 0.05, 0.4, zMin + 0.05], [0.08, 0.8, 0.08], '#134e4a', { parentId: root }),
		box('rt-leg-1', 'Leg', [x - 0.05, 0.4, zMin + 0.05], [0.08, 0.8, 0.08], '#134e4a', { parentId: root }),
		box('rt-leg-2', 'Leg', [-x + 0.05, 0.4, zMax - 0.05], [0.08, 0.8, 0.08], '#134e4a', { parentId: root }),
		box('rt-leg-3', 'Leg', [x - 0.05, 0.4, zMax - 0.05], [0.08, 0.8, 0.08], '#134e4a', { parentId: root }),
		box('rt-line', 'Throw Line', [0, 0.006, RING_TOSS.line], [1.8, 0.012, 0.05], NEON.yellow, { parentId: root }),
		box('rt-table', 'Ring Table', [-1.1, 0.92, -1.9], [1.3, 0.04, 0.4], '#134e4a', { parentId: root }, true),
		box('rt-table-leg-0', 'Table Leg', [-1.65, 0.45, -1.9], [0.05, 0.9, 0.35], '#042f2e', { parentId: root }),
		box('rt-table-leg-1', 'Table Leg', [-0.55, 0.45, -1.9], [0.05, 0.9, 0.35], '#042f2e', { parentId: root })
	];
	for (const [index, peg] of RING_TOSS.pegs.entries()) {
		const color = peg.points >= 50 ? '#facc15' : peg.points >= 20 ? '#4ade80' : '#60a5fa';
		parts.push(cylinder(`rt-peg-${index}`, `Peg ${peg.points}`, [peg.x, RING_TOSS.platformTop + RING_TOSS.pegHeight / 2, peg.z], 0.04, RING_TOSS.pegHeight, color, { parentId: root }));
		parts.push(createSlot({
			id: `rt-peg-${index}-label`,
			parentId: root,
			name: `Peg ${peg.points} Label`,
			position: [peg.x, RING_TOSS.platformTop + 0.004, peg.z - 0.1],
			rotation: [0.7071068, 0, 0, 0.7071068],
			scale: [0.14, 0.08, 1],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#042f2e' }, { type: 'textDisplay', title: String(peg.points), lines: [], color: '#042f2e', scale: 1, verticalAlign: 'middle' }]
		}));
	}
	return parts;
}

/** A ring: a hoop of eight short bars lying flat, with one collider so a hand can pick it up. */
function ring(frame: Frame, index: number): Slot[] {
	const id = ringId(index);
	const colors = [NEON.pink, NEON.cyan, NEON.yellow, NEON.green, NEON.violet, NEON.orange];
	const r = RING_TOSS.ringRadius;
	const bar = (k: number) => {
		const angle = (k / 8) * Math.PI * 2;
		return box(`${id}-bar-${k}`, 'Ring Bar', [Math.cos(angle) * r, 0, Math.sin(angle) * r], [0.07, 0.025, 0.03], colors[index % colors.length], {
			parentId: id,
			rotation: [0, Math.sin(-(angle + Math.PI / 2) / 2), 0, Math.cos(-(angle + Math.PI / 2) / 2)]
		});
	};
	return [
		grabbable(id, 'Ring', toWorld(frame, RING_TOSS.homes[index]), {}, [{ type: 'container' }]),
		box(`${id}-grip`, 'Ring Grip', [0, 0, 0], [r * 2.2, 0.03, r * 2.2], '#000000', { parentId: id }, true, 0.02),
		...Array.from({ length: 8 }, (_, k) => bar(k))
	];
}

export function buildRingToss(frame: Frame): Slot[] {
	const root = machineIds(RING_TOSS.p).root;
	return [
		...machineShell({
			p: RING_TOSS.p,
			name: RING_TOSS.name,
			frame,
			color: NEON.green,
			tagline: 'Three rings a turn, two turns each',
			panelAt: [1.2, 1.3, -1.2],
			boardAt: [-1.1, 2.1, 1.85],
			topAt: [1.1, 2.1, 1.85],
			code: machineScript({ frame, game: GAME })
		}),
		...neonSign(RING_TOSS.p, 'RING TOSS', root, [0, 3.05, 1.85], 1.8, NEON.green),
		...platformParts(root),
		...Array.from({ length: RING_TOSS.count }, (_, index) => ring(frame, index)).flat()
	];
}
