import type { Slot } from '../../ecs/types';
import { NEON, box, cylinder, grabbable, machineIds, machineShell, neonSign, toWorld, yawQuat } from './arcadeKit.ts';
import type { Frame, Vec3 } from './arcadeKit.ts';
import { machineScript } from './arcadeSession.ts';

/** Darts: six darts on a table, a board on the wall. Three darts a turn, four turns each, the highest total wins. */
export const DARTS = {
	p: 'dt',
	name: 'Darts',
	center: [0, 1.7, 0] as Vec3,
	radius: 0.34,
	/** The plane of the board, in machine coordinates. */
	boardZ: 0,
	/** How far the point of a dart is ahead of its middle. */
	tip: 0.14,
	/** Half the size of the cork backboard around the board. */
	backHalf: 0.5,
	count: 6,
	gravity: 5,
	toeZ: -2.4,
	tableAt: [1.15, 0, -2.3] as Vec3,
	homes: Array.from({ length: 6 }, (_, index) => [0.95 + index * 0.08, 0.97, -2.3] as Vec3),
	rounds: 4,
	perVisit: 3
} as const;

export const dartId = (index: number) => `dt-dart-${index}`;

const GAME = `
const D = ${JSON.stringify(DARTS)};
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
let clock = 0;
const darts = [];
for (let i = 0; i < D.count; i++) { const body = makeBody('dt-dart-' + i, D.homes[i]); body.homeRotation = yawQ; darts.push(body); }

/** What a dart that lands at (x, y), measured from the middle of the board, is worth. */
function scoreAt(x, y) {
	const f = Math.hypot(x, y) / D.radius;
	if (f < 0.05) return { points: 50, label: 'Bullseye! 50' };
	if (f < 0.1) return { points: 25, label: 'Outer bull: 25' };
	const angle = ((Math.atan2(x, y) * 180) / Math.PI + 360 + 9) % 360;
	const n = SECTORS[Math.floor(angle / 18) % 20];
	if (f >= 0.9) return { points: n * 2, label: 'Double ' + n + ': ' + n * 2 };
	if (f >= 0.58 && f < 0.66) return { points: n * 3, label: 'Triple ' + n + ': ' + n * 3 };
	return { points: n, label: String(n) };
}

const S = createSession({
	ids: ${JSON.stringify(machineIds(DARTS.p))},
	maxSeats: 4,
	perVisit: D.perVisit,
	rounds: D.rounds,
	leaderboard: { name: 'arcade-darts' },
	at: [0, 1.7, -1.8],
	intro: 'Grab a dart from the table and throw it at the board. Press 1 PLAYER for a game of ' + D.perVisit * D.rounds + ' darts, or VERSUS to play in turns.',
	status: (s) => {
		const seat = s.seats[s.turn];
		return seat ? seat.name + ': ' + s.attemptsLeft() + ' dart' + (s.attemptsLeft() === 1 ? '' : 's') + ' left, round ' + s.round() + ' of ' + D.rounds : '';
	},
	boardStatus: (s) => (s.seats[s.turn] ? 'Up: ' + s.seats[s.turn].name + ' (round ' + s.round() + '/' + D.rounds + ')' : 'Playing'),
	onStart: () => darts.forEach((d) => { if (d.mode !== 'held') sendHome(d); }),
	onTurn: () => darts.forEach((d) => { if (d.mode !== 'held') sendHome(d); })
});

/** A dart that has come to rest scores (or not) for whoever threw it. */
function register(dart, points, label) {
	if (S.phase !== 'playing') return S.say('Practice throw: ' + label);
	const seat = S.who(dart.holder);
	if (seat && S.attempt(points, label)) return S.say(seat.name + ': ' + label);
	if (!seat) S.say('Wait for your turn. (That one was ' + label + '.)');
}

function land(dart, hx, hy) {
	const x = hx - D.center[0], y = hy - D.center[1];
	dart.vel = [0, 0, 0];
	dart.age = 0;
	if (Math.hypot(x, y) <= D.radius) {
		const result = scoreAt(x, y);
		dart.mode = 'stuck'; dart.wait = 2; dart.pos = [hx, hy, D.boardZ - 0.06];
		thudAt(dart.pos, 0.6);
		if (result.points >= 50) { soundAt(dart.pos, 1175, 0.5, 300); burstAt(dart.pos, '#ff2d95'); }
		register(dart, result.points, result.label);
	} else if (Math.abs(x) < D.backHalf && Math.abs(hy - D.center[1]) < D.backHalf) {
		dart.mode = 'stuck'; dart.wait = 2; dart.pos = [hx, hy, D.boardZ - 0.06];
		thudAt(dart.pos, 0.4);
		register(dart, 0, 'Off the board: 0');
	} else {
		dart.mode = 'drop'; dart.pos = [hx, hy, D.boardZ - 0.06];
		register(dart, 0, 'Missed everything: 0');
	}
	place(dart.id, dart.pos, aimQ([0, 0, 1]), true);
}

function updateDart(dart, dt) {
	const state = followHand(dart, dt, clock);
	if (state === 'held') return;
	if (state === 'released') {
		dart.age = 0;
		dart.mode = len(dart.vel) < 1 ? 'drop' : 'flying';
		if (dart.mode === 'drop') dart.vel = [0, 0, 0];
	}
	if (dart.mode === 'flying' || dart.mode === 'drop') {
		dart.age += dt;
		const from = dart.pos.slice();
		dart.pos = [from[0] + dart.vel[0] * dt, from[1] + dart.vel[1] * dt - 0.5 * D.gravity * dt * dt, from[2] + dart.vel[2] * dt];
		dart.vel[1] -= D.gravity * dt;
		const plane = D.boardZ - D.tip;
		if (dart.mode === 'flying' && from[2] < plane && dart.pos[2] >= plane) {
			const t = (plane - from[2]) / (dart.pos[2] - from[2]);
			land(dart, from[0] + (dart.pos[0] - from[0]) * t, from[1] + (dart.pos[1] - from[1]) * t);
			return;
		}
		if (dart.pos[1] <= 0.03) {
			dart.pos[1] = 0.03;
			if (dart.mode === 'flying') register(dart, 0, 'Missed everything: 0');
			dart.mode = 'rest'; dart.wait = 2; dart.vel = [0, 0, 0];
			thudAt(dart.pos, 0.3);
			place(dart.id, dart.pos, undefined, true);
			return;
		}
		if (dart.age > 6) return sendHome(dart);
		place(dart.id, dart.pos, dart.mode === 'flying' ? aimQ(dart.vel) : undefined, false);
		return;
	}
	if (dart.mode === 'stuck' || dart.mode === 'rest') {
		dart.wait -= dt;
		if (dart.wait <= 0) sendHome(dart);
	}
}

return {
	onPlayerReady() { S.start(); },
	onUIEvent(event) { S.onUIEvent(event); },
	tick(dt) {
		if (!ctx.world.isHost()) return;
		clock += dt;
		for (const dart of darts) updateDart(dart, dt);
		S.tick(dt);
	}
};
`;

/** The board, its wires, the table the darts lie on and the toe line. */
function boardParts(root: string): Slot[] {
	const [cx, cy] = DARTS.center;
	const disc = (id: string, name: string, diameter: number, z: number, color: string) =>
		cylinder(id, name, [cx, cy, z], diameter, 0.012, color, { parentId: root, rotation: [0.7071068, 0, 0, 0.7071068] });
	const r = DARTS.radius;
	const parts: Slot[] = [
		box('dt-back', 'Backboard', [0, 1.3, 0.1], [3.6, 2.7, 0.08], '#2b2230', { parentId: root }, true),
		box('dt-cork', 'Cork Backboard', [cx, cy, 0.05], [DARTS.backHalf * 2, DARTS.backHalf * 2, 0.04], '#a16207', { parentId: root }),
		disc('dt-b-dbl', 'Double Ring', r * 2, 0.02, '#dc2626'),
		disc('dt-b-s1', 'Outer Single', r * 1.8, 0.015, '#fde68a'),
		disc('dt-b-tri', 'Triple Ring', r * 1.32, 0.012, '#16a34a'),
		disc('dt-b-s2', 'Inner Single', r * 1.16, 0.009, '#fde68a'),
		disc('dt-b-bull', 'Outer Bull', r * 0.2, 0.006, '#16a34a'),
		disc('dt-b-eye', 'Bullseye', r * 0.1, 0.003, '#dc2626')
	];
	for (let index = 0; index < 10; index++) {
		const angle = (index * Math.PI) / 10;
		parts.push(box(`dt-wire-${index}`, 'Wire', [cx, cy, -0.002], [0.004, r * 2, 0.002], '#cbd5e1', { parentId: root, rotation: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)] }));
	}
	parts.push(
		box('dt-toe', 'Throw Line', [0, 0.006, DARTS.toeZ], [1.4, 0.012, 0.05], NEON.yellow, { parentId: root }),
		box('dt-table-top', 'Dart Table', [DARTS.tableAt[0], 0.92, DARTS.tableAt[2]], [0.7, 0.04, 0.42], '#7c2d12', { parentId: root }, true),
		box('dt-table-leg-0', 'Table Leg', [DARTS.tableAt[0] - 0.3, 0.45, DARTS.tableAt[2] - 0.17], [0.05, 0.9, 0.05], '#451a03', { parentId: root }),
		box('dt-table-leg-1', 'Table Leg', [DARTS.tableAt[0] + 0.3, 0.45, DARTS.tableAt[2] - 0.17], [0.05, 0.9, 0.05], '#451a03', { parentId: root }),
		box('dt-table-leg-2', 'Table Leg', [DARTS.tableAt[0] - 0.3, 0.45, DARTS.tableAt[2] + 0.17], [0.05, 0.9, 0.05], '#451a03', { parentId: root }),
		box('dt-table-leg-3', 'Table Leg', [DARTS.tableAt[0] + 0.3, 0.45, DARTS.tableAt[2] + 0.17], [0.05, 0.9, 0.05], '#451a03', { parentId: root })
	);
	return parts;
}

/** One dart: a root a hand can grab, with a barrel, a point and two crossed flights, lying along the machine's z axis. */
function buildDart(frame: Frame, index: number, color: string): Slot[] {
	const id = dartId(index);
	const part = (name: string, at: Vec3, scale: Vec3, shade: string, collider = false) => box(`${id}-${name}`, name, at, scale, shade, { parentId: id }, collider);
	return [
		grabbable(id, 'Dart', toWorld(frame, DARTS.homes[index]), { rotation: yawQuat(frame.yaw) }, [{ type: 'container' }]),
		part('barrel', [0, 0, 0], [0.04, 0.04, 0.12], '#cbd5e1', true),
		part('point', [0, 0, 0.1], [0.012, 0.012, 0.08], '#f1f5f9'),
		part('flight-v', [0, 0, -0.1], [0.004, 0.09, 0.07], color),
		part('flight-h', [0, 0, -0.1], [0.09, 0.004, 0.07], color)
	];
}

export function buildDarts(frame: Frame): Slot[] {
	const root = machineIds(DARTS.p).root;
	const colors = [NEON.pink, NEON.cyan, NEON.yellow, NEON.green, NEON.violet, NEON.orange];
	return [
		...machineShell({
			p: DARTS.p,
			name: DARTS.name,
			frame,
			color: NEON.pink,
			tagline: 'Three darts a turn, highest total wins',
			panelAt: [-0.95, 1.25, -2.1],
			boardAt: [-1.15, 2.15, 0.02],
			topAt: [1.15, 2.15, 0.02],
			code: machineScript({ frame, game: GAME })
		}),
		...neonSign(DARTS.p, DARTS.name.toUpperCase(), root, [0, 2.85, 0.02], 1.8, NEON.pink),
		...boardParts(root),
		...Array.from({ length: DARTS.count }, (_, index) => buildDart(frame, index, colors[index % colors.length])).flat()
	];
}
