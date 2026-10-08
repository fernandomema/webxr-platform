import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { NEON, box, cylinder, grabbable, machineIds, machineShell, neonSign, toWorld, yawQuat } from './arcadeKit.ts';
import type { Frame, Vec3 } from './arcadeKit.ts';
import { machineScript } from './arcadeSession.ts';

/**
 * Air hockey: a table, two mallets and a puck that the machine's script moves (there is no physics for objects). The player
 * at the near end plays first; in 1 Player mode a robot takes the far mallet.
 */
export const HOCKEY = {
	p: 'ah',
	name: 'Air Hockey',
	/** The table runs from z = 0 (the near end) to z = length, centred on x = 0. */
	length: 2.0,
	halfWidth: 0.5,
	/** Half the width of each goal mouth. */
	goal: 0.17,
	top: 0.85,
	puckRadius: 0.05,
	padRadius: 0.07,
	/** Goals to win. */
	target: 7,
	maxSpeed: 5,
	friction: 0.3,
	wall: 0.93,
	hit: 0.95,
	botSpeed: 1.3,
	padY: 0.884,
	puckY: 0.862
} as const;

export const HOCKEY_IDS = { puck: 'ah-puck', pads: ['ah-pad-0', 'ah-pad-1'], boardFar: 'ah-board-b' } as const;

const padHome = (index: number): Vec3 => [0, HOCKEY.padY, index === 0 ? 0.4 : HOCKEY.length - 0.4];

const GAME = `
const H = ${JSON.stringify(HOCKEY)};
const PUCK = 'ah-puck';
const puck = { pos: [0, H.puckY, H.length / 2], vel: [0, 0, 0], wait: 1 };
const pads = [0, 1].map((i) => ({ id: 'ah-pad-' + i, home: [0, H.padY, i === 0 ? 0.4 : H.length - 0.4], pos: [0, H.padY, i === 0 ? 0.4 : H.length - 0.4], prev: null, vel: [0, 0, 0], free: 0, bot: false }));
let clock = 0;
let serveSide = 0;

const S = createSession({
	ids: ${JSON.stringify(machineIds(HOCKEY.p))},
	extraBoards: ['ah-board-b'],
	maxSeats: 2,
	leaderboard: { name: 'arcade-airhockey' },
	value: (seat) => seat.score - (S.seats.find((other) => other !== seat) || { score: 0 }).score,
	at: [0, 1.6, H.length / 2],
	intro: 'Grab a mallet and hit the puck. 1 PLAYER plays the robot, VERSUS plays a friend: first to ' + H.target + ' goals wins. The first player stands at this end.',
	status: (s) => s.seats.map((seat) => seat.name + ' ' + seat.score).join('   -   ') + '   (first to ' + H.target + ')',
	boardStatus: () => 'First to ' + H.target,
	onStart: (s) => {
		if (s.mode === '1p') s.seats.push({ id: 'bot', name: 'Robot', score: 0, attempts: 0, last: '', data: {}, bot: true });
		serveSide = 0;
		serve(0);
	},
	onIdle: () => { pads[1].bot = false; }
});

function serve(side) {
	puck.pos = [0, H.puckY, side === 0 ? H.length * 0.3 : H.length * 0.7];
	puck.vel = [0, 0, 0];
	puck.wait = 0;
	place(PUCK, puck.pos, undefined, true);
}

function goal(scorer) {
	const x = 0, z = scorer === 1 ? -0.1 : H.length + 0.1;
	puck.vel = [0, 0, 0]; puck.wait = 1.6; puck.pos = [x, H.puckY - 0.02, z];
	place(PUCK, puck.pos, undefined, true);
	burstAt([0, H.top + 0.2, scorer === 1 ? 0 : H.length], scorer === 1 ? '#22d3ee' : '#fb923c', 18);
	soundAt([0, H.top + 0.3, scorer === 1 ? 0 : H.length], 660, 0.6, 300, 200);
	if (S.phase !== 'playing') return S.say(scorer === 1 ? 'Goal at the near end!' : 'Goal at the far end!');
	const seat = S.seats[scorer];
	seat.score += 1;
	S.say(seat.name + ' scores!');
	S.dirty = true;
	if (seat.score >= H.target) return S.finish();
	serveSide = scorer === 1 ? 0 : 1;
}

function readPad(pad, dt) {
	const cur = posOf(pad.id);
	if (!cur) return;
	if (pad.prev && dt > 0) {
		pad.vel = [pad.vel[0] * 0.5 + ((cur[0] - pad.prev[0]) / dt) * 0.5, 0, pad.vel[2] * 0.5 + ((cur[2] - pad.prev[2]) / dt) * 0.5];
	}
	pad.prev = cur; pad.pos = cur;
}

/** The robot: gets behind the puck and pushes it towards the near goal, or guards its own. */
function moveBot(pad, dt) {
	let target;
	const inHalf = puck.pos[2] > H.length / 2;
	if (inHalf) {
		target = pad.pos[2] < puck.pos[2] + 0.1
			? [puck.pos[0] + (puck.pos[0] >= pad.pos[0] ? 0.16 : -0.16), 0, puck.pos[2] + 0.16]
			: [puck.pos[0], 0, puck.pos[2]];
	} else target = [clamp(puck.pos[0] * 0.5, -0.3, 0.3), 0, H.length - 0.3];
	const dx = target[0] - pad.pos[0], dz = target[2] - pad.pos[2];
	const dist = Math.hypot(dx, dz);
	const step = Math.min(dist, H.botSpeed * dt);
	const x = clamp(pad.pos[0] + (dist > 0 ? (dx / dist) * step : 0), -H.halfWidth + H.padRadius, H.halfWidth - H.padRadius);
	const z = clamp(pad.pos[2] + (dist > 0 ? (dz / dist) * step : 0), H.length / 2 + H.padRadius, H.length - H.padRadius);
	pad.vel = [(x - pad.pos[0]) / dt, 0, (z - pad.pos[2]) / dt];
	pad.pos = [x, H.padY, z];
	pad.prev = pad.pos;
	place(pad.id, pad.pos, undefined, false);
}

function collidePad(pad) {
	if (pad.pos[1] < H.top - 0.05 || pad.pos[1] > H.top + 0.4) return;
	const dx = puck.pos[0] - pad.pos[0], dz = puck.pos[2] - pad.pos[2];
	const dist = Math.hypot(dx, dz), reach = H.padRadius + H.puckRadius;
	if (dist >= reach || dist < 1e-6) return;
	const nx = dx / dist, nz = dz / dist;
	const rel = (puck.vel[0] - pad.vel[0]) * nx + (puck.vel[2] - pad.vel[2]) * nz;
	if (rel < 0) {
		puck.vel[0] -= (1 + H.hit) * rel * nx;
		puck.vel[2] -= (1 + H.hit) * rel * nz;
		const speed = Math.hypot(puck.vel[0], puck.vel[2]);
		if (speed > H.maxSpeed) { puck.vel[0] *= H.maxSpeed / speed; puck.vel[2] *= H.maxSpeed / speed; }
		if (speed > 0.4) thudAt([puck.pos[0], H.top + 0.05, puck.pos[2]], clamp(speed / 5, 0.2, 0.8));
	}
	puck.pos[0] = pad.pos[0] + nx * (reach + 0.001);
	puck.pos[2] = pad.pos[2] + nz * (reach + 0.001);
}

function stepPuck(dt) {
	if (puck.wait > 0) {
		puck.wait -= dt;
		if (puck.wait <= 0) serve(serveSide);
		return;
	}
	const speed = Math.hypot(puck.vel[0], puck.vel[2]);
	const steps = clamp(Math.ceil((speed * dt) / 0.03), 1, 6);
	const h = dt / steps, R = H.puckRadius;
	puck.vel[0] *= 1 - H.friction * dt; puck.vel[2] *= 1 - H.friction * dt;
	for (let i = 0; i < steps; i++) {
		puck.pos[0] += puck.vel[0] * h; puck.pos[2] += puck.vel[2] * h;
		for (const pad of pads) collidePad(pad);
		if (puck.pos[0] < -H.halfWidth + R) { puck.pos[0] = -H.halfWidth + R; puck.vel[0] = Math.abs(puck.vel[0]) * H.wall; }
		if (puck.pos[0] > H.halfWidth - R) { puck.pos[0] = H.halfWidth - R; puck.vel[0] = -Math.abs(puck.vel[0]) * H.wall; }
		const inMouth = Math.abs(puck.pos[0]) < H.goal;
		if (puck.pos[2] < R) {
			if (inMouth) { if (puck.pos[2] < -R) return goal(1); }
			else { puck.pos[2] = R; puck.vel[2] = Math.abs(puck.vel[2]) * H.wall; }
		}
		if (puck.pos[2] > H.length - R) {
			if (inMouth) { if (puck.pos[2] > H.length + R) return goal(0); }
			else { puck.pos[2] = H.length - R; puck.vel[2] = -Math.abs(puck.vel[2]) * H.wall; }
		}
	}
	place(PUCK, puck.pos, undefined, false);
}

return {
	onPlayerReady() { S.start(); },
	onUIEvent(event) { S.onUIEvent(event); },
	tick(dt) {
		if (!ctx.world.isHost()) return;
		clock += dt;
		const robot = S.phase === 'playing' && S.mode === '1p';
		pads.forEach((pad, index) => {
			const held = ctx.grab.isSlotHeld(pad.id);
			pad.bot = robot && index === 1 && !held;
			if (pad.bot) moveBot(pad, dt); else readPad(pad, dt);
			pad.free = held || pad.bot ? 0 : pad.free + dt;
			if (pad.free > 6 && (Math.abs(pad.pos[0]) > H.halfWidth || pad.pos[2] < 0 || pad.pos[2] > H.length || pad.pos[1] > H.top + 0.4)) { pad.free = 0; pad.prev = null; pad.pos = pad.home.slice(); place(pad.id, pad.home, undefined, true); }
		});
		stepPuck(dt);
		S.tick(dt);
	}
};
`;

function tableParts(root: string): Slot[] {
	const { length, halfWidth, goal, top } = HOCKEY;
	const rail = (id: string, at: Vec3, scale: Vec3) => box(id, 'Rail', at, scale, '#1e3a8a', { parentId: root }, true);
	const mid = length / 2;
	const endWidth = halfWidth + 0.06 - goal;
	const endX = goal + endWidth / 2;
	const parts: Slot[] = [
		box('ah-table', 'Table Top', [0, top - 0.04, mid], [halfWidth * 2 + 0.12, 0.08, length + 0.12], '#e2e8f0', { parentId: root }, true),
		box('ah-surface', 'Playing Surface', [0, top + 0.001, mid], [halfWidth * 2, 0.004, length], '#0e7490', { parentId: root }),
		box('ah-line', 'Centre Line', [0, top + 0.004, mid], [halfWidth * 2, 0.002, 0.02], '#f8fafc', { parentId: root }),
		cylinder('ah-circle', 'Centre Spot', [0, top + 0.004, mid], 0.3, 0.002, '#22d3ee', { parentId: root }),
		rail('ah-rail-l', [-halfWidth - 0.03, top + 0.04, mid], [0.06, 0.08, length + 0.12]),
		rail('ah-rail-r', [halfWidth + 0.03, top + 0.04, mid], [0.06, 0.08, length + 0.12]),
		box('ah-glow-0', 'Near Goal', [0, top + 0.002, -0.02], [goal * 2, 0.006, 0.04], '#38bdf8', { parentId: root }),
		box('ah-glow-1', 'Far Goal', [0, top + 0.002, length + 0.02], [goal * 2, 0.006, 0.04], '#fb923c', { parentId: root })
	];
	for (const [end, z] of [['n', -0.03], ['f', length + 0.03]] as const) {
		parts.push(rail(`ah-end-${end}l`, [-endX, top + 0.04, z], [endWidth, 0.08, 0.06]), rail(`ah-end-${end}r`, [endX, top + 0.04, z], [endWidth, 0.08, 0.06]));
	}
	for (const [index, [x, z]] of ([[-0.5, 0.05], [0.5, 0.05], [-0.5, length - 0.05], [0.5, length - 0.05]] as const).entries()) {
		parts.push(box(`ah-leg-${index}`, 'Table Leg', [x, (top - 0.08) / 2, z], [0.08, top - 0.08, 0.08], '#334155', { parentId: root }));
	}
	return parts;
}

function pad(frame: Frame, index: number): Slot[] {
	const id = HOCKEY_IDS.pads[index];
	const color = index === 0 ? '#22d3ee' : '#fb923c';
	const r = HOCKEY.padRadius;
	return [
		grabbable(id, 'Mallet', toWorld(frame, padHome(index)), { rotation: yawQuat(frame.yaw) }, [{ type: 'container' }]),
		createSlot({ id: `${id}-base`, parentId: id, name: 'Mallet Base', position: [0, 0, 0], scale: [r * 2, 0.025, r * 2], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color }, { type: 'collider', shape: 'box' }] }),
		cylinder(`${id}-knob`, 'Mallet Knob', [0, 0.04, 0], 0.045, 0.06, '#f1f5f9', { parentId: id })
	];
}

export function buildAirHockey(frame: Frame): Slot[] {
	const root = machineIds(HOCKEY.p).root;
	const { length } = HOCKEY;
	return [
		...machineShell({
			p: HOCKEY.p,
			name: HOCKEY.name,
			frame,
			color: NEON.cyan,
			tagline: 'First to 7 goals wins',
			panelAt: [-1.15, 1.3, -0.3],
			boardAt: [0, 2.2, length + 0.35],
			topAt: [1.25, 1.9, 0.1],
			code: machineScript({ frame, game: GAME })
		}),
		// The same board for whoever plays from the far end, facing them.
		box('ah-board-b-frame', 'Board Frame', [0, 2.2, -0.38], [1.12, 0.74, 0.04], '#1e293b', { parentId: root }),
		createSlot({
			id: HOCKEY_IDS.boardFar,
			parentId: root,
			name: 'Air Hockey Scores (far end)',
			position: [0, 2.2, -0.35],
			rotation: [0, 1, 0, 0],
			scale: [1.04, 0.66, 1],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#081029' }, { type: 'scoreboard', title: 'Air Hockey', status: 'Waiting for a player', columns: ['Score'], rows: [] }]
		}),
		...neonSign(HOCKEY.p, 'AIR HOCKEY', root, [0, 3.0, length + 0.35], 1.8, NEON.cyan),
		...tableParts(root),
		createSlot({
			id: HOCKEY_IDS.puck,
			name: 'Puck',
			position: toWorld(frame, [0, HOCKEY.puckY, length / 2]),
			scale: [HOCKEY.puckRadius * 2, 0.02, HOCKEY.puckRadius * 2],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#f43f5e' }]
		}),
		...pad(frame, 0),
		...pad(frame, 1)
	];
}
