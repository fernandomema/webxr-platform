import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { NEON, box, cylinder, grabbable, machineIds, machineShell, neonSign, toWorld } from './arcadeKit.ts';
import type { Frame, Vec3 } from './arcadeKit.ts';
import { machineScript } from './arcadeSession.ts';

/** Basketball: three balls on a rack, a hoop with a backboard. Sixty seconds on the clock; everybody in the game plays at once. */
export const BASKETBALL = {
	p: 'bb',
	name: 'Basketball',
	rim: [0, 2.45, 1.3] as Vec3,
	rimRadius: 0.26,
	/** The front face of the backboard, and the area it covers. */
	boardZ: 1.62,
	boardHalfWidth: 0.55,
	boardBottom: 2.2,
	boardTop: 3.0,
	ballRadius: 0.12,
	gravity: 9.8,
	count: 3,
	seconds: 60,
	/** A shot taken from at least this far from the rim is worth three. */
	threeFrom: 3.6,
	freeThrowZ: -1.4,
	threeZ: -2.4,
	homes: [0, 1, 2].map((index) => [0.8 + index * 0.3, 0.92, -1.7] as Vec3)
} as const;

export const ballId = (index: number) => `bb-ball-${index}`;

const GAME = `
const B = ${JSON.stringify(BASKETBALL)};
let clock = 0;
let timeLeft = 0;
let lastSecond = -1;
const balls = [];
for (let i = 0; i < B.count; i++) balls.push(makeBody('bb-ball-' + i, B.homes[i]));

const S = createSession({
	ids: ${JSON.stringify(machineIds(BASKETBALL.p))},
	maxSeats: 4,
	leaderboard: { name: 'arcade-basketball' },
	at: [0, 2, 0],
	intro: 'Take a ball from the rack and shoot! ' + B.seconds + ' seconds. A basket is 2 points, 3 from behind the far line. 1 PLAYER plays alone, VERSUS plays at the same time as your friends.',
	status: (s) => 'Time left: ' + Math.ceil(timeLeft) + ' s\\n' + s.seats.map((seat) => seat.name + ' ' + seat.score).join('   '),
	boardStatus: () => Math.ceil(timeLeft) + ' s left',
	onStart: () => { timeLeft = B.seconds; lastSecond = -1; balls.forEach((b) => { if (b.mode !== 'held') sendHome(b); }); }
});

/** A ball that touches the rim bounces off it like a ring of tube. */
function collideRim(ball) {
	const dx = ball.pos[0] - B.rim[0], dz = ball.pos[2] - B.rim[2];
	const m = Math.hypot(dx, dz);
	if (m < 1e-6) return;
	const rx = B.rim[0] + (dx / m) * B.rimRadius, rz = B.rim[2] + (dz / m) * B.rimRadius;
	const ex = ball.pos[0] - rx, ey = ball.pos[1] - B.rim[1], ez = ball.pos[2] - rz;
	const d = Math.hypot(ex, ey, ez), reach = B.ballRadius + 0.02;
	if (d >= reach || d < 1e-6) return;
	const n = [ex / d, ey / d, ez / d];
	const vn = ball.vel[0] * n[0] + ball.vel[1] * n[1] + ball.vel[2] * n[2];
	if (vn < 0) {
		ball.vel = ball.vel.map((v, i) => v - 1.5 * vn * n[i]);
		if (vn < -1) thudAt(ball.pos, 0.4);
	}
	ball.pos = [rx + n[0] * (reach + 0.001), B.rim[1] + n[1] * (reach + 0.001), rz + n[2] * (reach + 0.001)];
}

function basket(ball) {
	ball.flags.scored = true;
	const far = Math.hypot(ball.flags.from[0] - B.rim[0], ball.flags.from[2] - B.rim[2]) >= B.threeFrom;
	const points = far ? 3 : 2;
	soundAt(B.rim, 880, 0.5, 260);
	burstAt([B.rim[0], B.rim[1] - 0.1, B.rim[2]], '#fb923c', 12);
	if (S.phase !== 'playing') return S.say('Nice shot! ' + points + ' points (practice).');
	const seat = S.who(ball.holder);
	if (!seat) return;
	seat.score += points;
	S.say(seat.name + ' scores ' + points + '!');
	S.dirty = true;
}

function updateBall(ball, dt) {
	const state = followHand(ball, dt, clock);
	if (state === 'held') return;
	if (state === 'released') {
		ball.age = 0;
		ball.flags = { scored: false, from: ball.pos.slice() };
		ball.mode = len(ball.vel) < 1 ? 'drop' : 'flying';
	}
	if (ball.mode === 'flying' || ball.mode === 'drop') {
		ball.age += dt;
		const steps = 3, h = dt / steps, R = B.ballRadius;
		for (let i = 0; i < steps; i++) {
			const before = ball.pos[1];
			ball.pos = [ball.pos[0] + ball.vel[0] * h, ball.pos[1] + ball.vel[1] * h - 0.5 * B.gravity * h * h, ball.pos[2] + ball.vel[2] * h];
			ball.vel[1] -= B.gravity * h;
			if (ball.mode === 'flying' && !ball.flags.scored && before > B.rim[1] && ball.pos[1] <= B.rim[1] && Math.hypot(ball.pos[0] - B.rim[0], ball.pos[2] - B.rim[2]) <= B.rimRadius - 0.05) basket(ball);
			collideRim(ball);
			if (ball.pos[2] > B.boardZ - R && ball.vel[2] > 0 && Math.abs(ball.pos[0]) < B.boardHalfWidth && ball.pos[1] > B.boardBottom && ball.pos[1] < B.boardTop) {
				ball.pos[2] = B.boardZ - R; ball.vel[2] = -ball.vel[2] * 0.55; ball.vel[0] *= 0.9;
				if (Math.abs(ball.vel[2]) > 0.8) thudAt(ball.pos, 0.5);
			}
			if (ball.pos[1] < R) {
				ball.pos[1] = R;
				if (Math.abs(ball.vel[1]) > 1) { thudAt(ball.pos, clamp(Math.abs(ball.vel[1]) / 8, 0.15, 0.6)); ball.vel = [ball.vel[0] * 0.8, -ball.vel[1] * 0.6, ball.vel[2] * 0.8]; }
				else { ball.vel = [0, 0, 0]; ball.mode = 'rest'; ball.wait = 2.5; break; }
			}
		}
		if (ball.age > 12) return sendHome(ball);
		place(ball.id, ball.pos, undefined, ball.mode === 'rest');
		return;
	}
	if (ball.mode === 'rest') {
		ball.wait -= dt;
		if (ball.wait <= 0) sendHome(ball);
	}
}

return {
	onPlayerReady() { S.start(); },
	onUIEvent(event) { S.onUIEvent(event); },
	tick(dt) {
		if (!ctx.world.isHost()) return;
		clock += dt;
		for (const ball of balls) updateBall(ball, dt);
		if (S.phase === 'playing') {
			timeLeft = Math.max(0, timeLeft - dt);
			const second = Math.ceil(timeLeft);
			if (second !== lastSecond) { lastSecond = second; S.dirty = true; if (second > 0 && second <= 5) soundAt([0, 2, -1], 600, 0.3, 120); }
			if (timeLeft <= 0) S.finish();
		}
		S.tick(dt);
	}
};
`;

function hoopParts(root: string): Slot[] {
	const [rx, ry, rz] = BASKETBALL.rim;
	const parts: Slot[] = [
		box('bb-backboard', 'Backboard', [0, 2.6, BASKETBALL.boardZ + 0.025], [1.1, 0.8, 0.05], '#e2e8f0', { parentId: root }, true, 0.9),
		box('bb-target', 'Backboard Square', [0, 2.52, BASKETBALL.boardZ - 0.002], [0.4, 0.28, 0.004], '#dc2626', { parentId: root }),
		box('bb-bracket', 'Rim Bracket', [0, ry - 0.01, (rz + BASKETBALL.boardZ) / 2 + BASKETBALL.rimRadius / 2], [0.08, 0.03, BASKETBALL.boardZ - rz - BASKETBALL.rimRadius + 0.01], '#f97316', { parentId: root }),
		cylinder('bb-pole', 'Pole', [0, 1.5, BASKETBALL.boardZ + 0.2], 0.12, 3, '#475569', { parentId: root }),
		box('bb-base', 'Base', [0, 0.05, BASKETBALL.boardZ + 0.2], [0.9, 0.1, 0.9], '#334155', { parentId: root }, true),
		createSlot({ id: 'bb-net', parentId: root, name: 'Net', position: [rx, ry - 0.22, rz], scale: [0.4, 0.4, 0.4], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#f8fafc', opacity: 0.35 }] })
	];
	for (let index = 0; index < 12; index++) {
		const angle = (index / 12) * Math.PI * 2;
		parts.push(
			box(`bb-rim-${index}`, 'Rim', [rx + Math.cos(angle) * BASKETBALL.rimRadius, ry, rz + Math.sin(angle) * BASKETBALL.rimRadius], [0.17, 0.035, 0.035], '#f97316', {
				parentId: root,
				// A box lies along x; turning it by -angle about y lays it tangent to the ring.
				rotation: [0, Math.sin(-(angle + Math.PI / 2) / 2), 0, Math.cos(-(angle + Math.PI / 2) / 2)]
			})
		);
	}
	return parts;
}

function courtParts(root: string): Slot[] {
	return [
		box('bb-line-ft', 'Free Throw Line', [0, 0.006, BASKETBALL.freeThrowZ], [1.6, 0.012, 0.05], NEON.yellow, { parentId: root }),
		box('bb-line-3', 'Three Point Line', [0, 0.006, BASKETBALL.threeZ], [2.6, 0.012, 0.05], '#f8fafc', { parentId: root }),
		box('bb-rack-top', 'Ball Rack', [1.1, 0.78, -1.7], [1.0, 0.04, 0.4], '#334155', { parentId: root }, true),
		box('bb-rack-leg-0', 'Rack Leg', [0.65, 0.38, -1.7], [0.05, 0.76, 0.35], '#1e293b', { parentId: root }),
		box('bb-rack-leg-1', 'Rack Leg', [1.55, 0.38, -1.7], [0.05, 0.76, 0.35], '#1e293b', { parentId: root })
	];
}

export function buildBasketball(frame: Frame): Slot[] {
	const root = machineIds(BASKETBALL.p).root;
	return [
		...machineShell({
			p: BASKETBALL.p,
			name: BASKETBALL.name,
			frame,
			color: NEON.orange,
			tagline: 'Sixty seconds. How many can you sink?',
			panelAt: [-1.2, 1.25, -2.0],
			boardAt: [-1.75, 2.6, 1.0],
			topAt: [1.75, 2.6, 1.0],
			code: machineScript({ frame, game: GAME })
		}),
		...neonSign(BASKETBALL.p, BASKETBALL.name.toUpperCase(), root, [0, 3.45, BASKETBALL.boardZ + 0.1], 1.8, NEON.orange),
		...hoopParts(root),
		...courtParts(root),
		...Array.from({ length: BASKETBALL.count }, (_, index) =>
			grabbable(ballId(index), 'Basketball', toWorld(frame, BASKETBALL.homes[index]), { scale: [0.24, 0.24, 0.24] }, [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#ea580c' },
				{ type: 'collider', shape: 'sphere' }
			])
		)
	];
}
