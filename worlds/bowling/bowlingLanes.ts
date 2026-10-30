import type { Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { asset } from './assets.ts';
import { loadBowlingLogic } from './bowlingLogic.ts';
import { BALLS_PER_LANE, BOWLING, DIRECTOR_ID, HALL, LANE_COUNT, ballHome, laneIds } from './bowlingLayout.ts';
import { SURFACES } from './bowlingHall.ts';
import { box, cylinder, group, pitch, pointLight, sign, spotLight, ui, type Vec3 } from './bowlingParts.ts';

const logic = loadBowlingLogic();
const MAGENTA = '#ff2fb3';
const CYAN = '#25e6ff';
/** The lane runs from the foul line to the back of the pin deck. */
const DECK_Z = BOWLING.foulZ + logic.DECK_END;
const BED_WIDTH = logic.BED_HALF * 2;
const GUTTER_EDGE = logic.BED_HALF + logic.GUTTER_WIDTH;
const BLOCK_LENGTH = BOWLING.pitBackZ - BOWLING.foulZ;

/** Everything shared by the four lanes: the base the beds sit on, the caps between them, the walls that keep people off, the returns. */
function buildBlock(): Slot[] {
	const { foulZ, laneX, blockMinX, blockMaxX, pitBackZ } = BOWLING;
	const midZ = (foulZ + pitBackZ) / 2;
	const slots: Slot[] = [
		// The floor of the machinery: the bottom of the gutters and the pit.
		box('bw-block-base', 'Lane Block Base', [0, -0.12, midZ], [blockMaxX - blockMinX, 0.1, BLOCK_LENGTH], '#06060b'),
		// The curtain at the back, black, with the pin-setters above the decks.
		box('bw-pit-curtain', 'Pit Curtain', [0, 1.5, pitBackZ - 0.05], [blockMaxX - blockMinX, 3.0, 0.1], '#040406')
	];
	// Caps between the lanes: from the outer gutter edge of one lane to that of the next (and from the last to the wall of the block).
	const edges: [number, number][] = [[blockMinX, laneX[0] - GUTTER_EDGE]];
	for (let i = 0; i < LANE_COUNT - 1; i++) edges.push([laneX[i] + GUTTER_EDGE, laneX[i + 1] - GUTTER_EDGE]);
	edges.push([laneX[LANE_COUNT - 1] + GUTTER_EDGE, blockMaxX]);
	edges.forEach(([x0, x1], i) => slots.push(box(`bw-cap-${i}`, 'Lane Cap', [(x0 + x1) / 2, -0.02, midZ], [x1 - x0, 0.1, BLOCK_LENGTH], '#0e0e16')));
	// Invisible walls: the foul line and the two sides of the block.
	const wall = (id: string, name: string, position: Vec3, size: Vec3) => box(id, name, position, size, '#000000', { solid: true, opacity: 0 });
	// (the sides run to the end wall, so that nobody can step round the curtain into the gap behind it)
	const sideLength = HALL.maxZ - foulZ;
	slots.push(wall('bw-barrier-front', 'Foul Line Barrier', [0, 0.7, foulZ + 0.05], [blockMaxX - blockMinX + 0.2, 1.4, 0.1]));
	slots.push(wall('bw-barrier-west', 'West Barrier', [blockMinX - 0.05, 0.7, foulZ + sideLength / 2], [0.1, 1.4, sideLength]));
	slots.push(wall('bw-barrier-east', 'East Barrier', [blockMaxX + 0.05, 0.7, foulZ + sideLength / 2], [0.1, 1.4, sideLength]));
	slots.push(wall('bw-barrier-end', 'End Barrier', [0, 0.7, HALL.maxZ - 0.05], [blockMaxX - blockMinX, 1.4, 0.1]));
	// The ball returns, one per pair: a case with a metal rail on top that the balls rest on.
	for (const x of [...new Set(BOWLING.returnX)]) {
		const id = `bw-return-${x < 0 ? 'w' : 'e'}`;
		const z = foulZ - 1.35;
		slots.push(group(id, 'Ball Return', [0, 0, 0]));
		slots.push(box(`${id}-case`, 'Return Case', [x, 0.39, z], [0.62, 0.78, 2.7], '#7a1620', { parentId: id, solid: true }));
		slots.push(box(`${id}-tray`, 'Return Tray', [x, 0.8, z], [0.34, 0.04, 2.6], '#aab4c0', { parentId: id }));
		slots.push(box(`${id}-rail-a`, 'Return Rail', [x - 0.2, 0.84, z], [0.04, 0.08, 2.6], '#d4d8de', { parentId: id }));
		slots.push(box(`${id}-rail-b`, 'Return Rail', [x + 0.2, 0.84, z], [0.04, 0.08, 2.6], '#d4d8de', { parentId: id }));
		slots.push(box(`${id}-glow`, 'Return Glow', [x, 0.5, foulZ - 0.01], [0.5, 0.05, 0.03], '#ffb347', { parentId: id, unlit: true }));
		slots.push(sign(`${id}-label`, 'Return Label', [x, 0.5, z - 1.36], [0.5, 0.16], { title: 'BALL RETURN', titleColor: '#ffffff', lines: [], background: '#7a1620', scale: 0.5 }, { parentId: id }));
	}
	return slots;
}

/** One lane: the bed, its markings and neon, the rails, the pit and the unit over it, the screen, the light, the pins and the balls. */
function buildLane(lane: number): Slot[] {
	const x = BOWLING.laneX[lane];
	const ids = laneIds(lane);
	const { foulZ } = BOWLING;
	const bedLength = DECK_Z - foulZ;
	const slots: Slot[] = [group(ids.root, `Lane ${lane + 1}`, [0, 0, 0])];
	const own = (slot: Slot): Slot => ({ ...slot, parentId: ids.root });
	slots.push(own(box(`bw-l${lane}-bed`, 'Lane Bed', [x, -0.05, foulZ + bedLength / 2], [BED_WIDTH, 0.1, bedLength], '#d9a45f', { surface: SURFACES.lane })));
	slots.push(own(box(`bw-l${lane}-foul`, 'Foul Line', [x, 0.004, foulZ + 0.02], [BED_WIDTH, 0.008, 0.05], '#15151c')));
	// Arrows: seven marks in a V a few metres past the line, the way a lane has them.
	for (let k = 0; k < 7; k++) {
		const across = (k - 3) * 0.1325;
		const along = 4.4 + (3 - Math.abs(k - 3)) * 0.16;
		slots.push(own(box(`bw-l${lane}-arrow-${k}`, 'Lane Arrow', [x + across, 0.004, foulZ + along], [0.055, 0.008, 0.26], '#5a3a1f')));
	}
	// Neon along the cap edges, and the two rails that fill the gutters when the bumpers are up.
	const colors = lane % 2 === 0 ? [MAGENTA, CYAN] : [CYAN, MAGENTA];
	for (const side of [0, 1] as const) {
		const dir = side === 0 ? -1 : 1;
		slots.push(own(box(ids.glow(side), 'Lane Neon', [x + dir * (GUTTER_EDGE + 0.012), 0.035, foulZ + (BOWLING.pitBackZ - foulZ) / 2], [0.025, 0.02, BOWLING.pitBackZ - foulZ], colors[side], { unlit: true })));
		slots.push(
			own(
				cylinder(ids.bumperRail(side), 'Bumper Rail', [x + dir * (logic.BED_HALF + 0.085), 0.0, foulZ + bedLength / 2], 0.17, bedLength, side === 0 ? '#2f6bff' : '#ff4f93', { rotation: pitch(Math.PI / 2), disabled: true })
			)
		);
	}
	// The unit over the pin deck, the neon under it and the screen on it.
	slots.push(own(box(`bw-l${lane}-unit`, 'Pinsetter', [x, 3.0, DECK_Z - 0.9], [2.0, 0.9, 2.8], '#10101c', {})));
	slots.push(own(box(`bw-l${lane}-unit-neon`, 'Pinsetter Neon', [x, 2.52, DECK_Z - 2.28], [1.9, 0.04, 0.04], colors[lane % 2], { unlit: true })));
	slots.push(
		own(
			sign(ids.monitor, 'Lane Screen', [x, 3.0, DECK_Z - 2.31], [1.85, 0.72], { title: `LANE ${lane + 1}`, titleColor: '#facc15', lines: ['Grab a ball and roll'], lineColor: '#ffffff', background: '#0a1030', scale: 1.1 }, { rotation: pitch(-0.1) })
		)
	);
	slots.push(own(spotLight(`bw-l${lane}-spot`, 'Pin Spot', [x, 4.1, DECK_Z - 4.5], pitch(0.74), '#fff3df', 3, 9, 60)));
	// Pins in their ten places, all on the lane's bed.
	for (const spot of logic.pinSpots()) {
		slots.push(
			own(
				createSlot({
					id: ids.pin(spot.n),
					name: `Pin ${spot.n}`,
					position: [x + spot.u, 0, foulZ + spot.w],
					components: [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: asset('models/bowling-pin.glb') }, modelScale: 'native' }]
				})
			)
		);
	}
	// The balls of the lane, on its return.
	for (let k = 0; k < BALLS_PER_LANE; k++) {
		slots.push(
			createSlot({
				id: ids.ball(k),
				name: 'Bowling Ball',
				position: ballHome(lane, k),
				scale: [0.216, 0.216, 0.216],
				components: [
					{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: asset('models/bowling-ball.glb') } },
					{ type: 'collider', shape: 'sphere' },
					{ type: 'grabbable', scalable: false, autoGrip: true }
				]
			})
		);
	}
	return slots;
}

/** The desk behind a lane's approach: the score board over it, the panel to join and set the lane, and a bench for the friends waiting. */
function buildDesk(lane: number): Slot[] {
	const x = BOWLING.laneX[lane];
	const ids = laneIds(lane);
	const z = BOWLING.deskZ;
	const vinyl = lane % 2 === 0 ? '#b4235a' : '#0f766e';
	const slots: Slot[] = [
		group(`bw-desk-${lane}`, `Desk ${lane + 1}`, [0, 0, 0]),
		box(`bw-desk-${lane}-body`, 'Desk', [x, 0.45, z], [1.3, 0.9, 0.62], '#241610', { parentId: `bw-desk-${lane}`, solid: true }),
		box(`bw-desk-${lane}-top`, 'Desk Top', [x, 0.92, z], [1.42, 0.05, 0.74], '#5a3626', { parentId: `bw-desk-${lane}`, surface: SURFACES.wood }),
		box(`bw-desk-${lane}-post-a`, 'Board Post', [x - 0.95, 1.9, z + 0.32], [0.05, 1.95, 0.05], '#2a2a36', { parentId: `bw-desk-${lane}` }),
		box(`bw-desk-${lane}-post-b`, 'Board Post', [x + 0.95, 1.9, z + 0.32], [0.05, 1.95, 0.05], '#2a2a36', { parentId: `bw-desk-${lane}` }),
		box(`bw-desk-${lane}-frame`, 'Board Frame', [x, 2.4, z + 0.37], [2.12, 1.28, 0.05], '#2a3a78', { parentId: `bw-desk-${lane}` }),
		createSlot({
			id: ids.board,
			parentId: `bw-desk-${lane}`,
			name: `Lane ${lane + 1} Scores`,
			position: [x, 2.4, z + 0.33],
			rotation: pitch(-0.12),
			scale: [2.0, 1.167, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#081029' },
				{ type: 'scoreboard', title: `LANE ${lane + 1}`, status: 'Press JOIN or roll a ball to start', columns: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], rows: [] }
			]
		}),
		// A bench for the friends waiting their turn, facing the lane.
		box(`bw-bench-${lane}-seat`, 'Bench', [x, 0.25, z - 1.7], [1.7, 0.5, 0.55], vinyl, { parentId: `bw-desk-${lane}`, solid: true }),
		box(`bw-bench-${lane}-back`, 'Bench Back', [x, 0.78, z - 1.98], [1.7, 0.56, 0.1], vinyl, { parentId: `bw-desk-${lane}` })
	];
	return slots;
}

const BUTTON = { fontSize: 24, fontWeight: 'bold', textAlign: 'center', cornerRadius: 16, width: 288, height: 62 } as const;
const PANEL_WIDTH = 640;

/** The panel on a desk. All of them hang from the director, whose script hears every press. */
function buildConsole(lane: number): Slot[] {
	const ids = laneIds(lane);
	const x = BOWLING.laneX[lane];
	const root = ids.console;
	const row = (name: string) => `${root}-row-${name}`;
	const button = (id: string, parent: string, text: string, background: string) => ui(id, parent, 'button', { ...BUTTON, text, background });
	return [
		createSlot({
			id: root,
			parentId: DIRECTOR_ID,
			name: `Lane ${lane + 1} Console`,
			position: [x, 1.2, BOWLING.deskZ - 0.12],
			rotation: pitch(0.55),
			components: [{ type: 'uiPanel', width: PANEL_WIDTH, height: 440, worldWidth: 0.9, background: '#0a1030' }]
		}),
		ui(`${root}-title`, root, 'text', { text: `LANE ${lane + 1}`, width: 580, height: 48, fontSize: 38, fontWeight: 'bold', textAlign: 'center', color: '#facc15' }),
		ui(ids.status, root, 'text', { text: 'Press JOIN, or just roll a ball.', width: 580, height: 92, fontSize: 25, textAlign: 'center', color: '#ffffff' }),
		ui(row('a'), root, 'container', { width: 588, height: 64, flexDirection: 'row', gap: 12, margin: 4 }),
		button(ids.join, row('a'), 'Join', '#16a34a'),
		button(ids.leave, row('a'), 'Leave', '#b91c1c'),
		ui(row('b'), root, 'container', { width: 588, height: 64, flexDirection: 'row', gap: 12, margin: 4 }),
		button(ids.bumpers, row('b'), 'Bumpers: OFF', '#1e293b'),
		button(ids.assist, row('b'), 'Aim help: Normal', '#1e293b'),
		ui(row('c'), root, 'container', { width: 588, height: 64, flexDirection: 'row', gap: 12, margin: 4 }),
		button(ids.newGame, row('c'), 'New game', '#7c3aed'),
		button(ids.cheer, row('c'), 'Cheer!', '#ca8a04')
	];
}

/** The alley's lanes and what is on them. `directorScript` is the script that runs the games; it sits on the slot the consoles hang from. */
export function buildLanes(directorScript: string): Slot[] {
	const slots: Slot[] = [
		createSlot({ id: DIRECTOR_ID, name: 'Alley Director', components: [{ type: 'container' }, { type: 'codeBlock', code: directorScript }] }),
		...buildBlock()
	];
	for (let lane = 0; lane < LANE_COUNT; lane++) slots.push(...buildLane(lane), ...buildDesk(lane), ...buildConsole(lane));
	// Light over each pair's approach, and a row of lamps down the length of the lanes (they are baked: see bowling.ts).
	for (const [i, x] of [-3.2, 3.2].entries()) slots.push(pointLight(`bw-light-approach-${i}`, 'Approach Light', [x, 3.4, 1.6], '#ffe2b8', 2.4, 10, false));
	for (const [i, x] of [-3.2, 3.2].entries()) for (const [j, z] of [8, 13, 17.5].entries()) slots.push(pointLight(`bw-light-lane-${i}-${j}`, 'Lane Lamp', [x, 4.0, z], '#fff0d8', 2.2, 8, false));
	slots.push(pointLight('bw-light-end', 'End Wall Glow', [0, 3.5, HALL.maxZ - 2], '#ff2fb3', 1.6, 9, false));
	// The lobby, where people arrive and wait: over the arrival point, over the benches and over the shoe counter.
	slots.push(pointLight('bw-light-lobby-0', 'Lobby Light', [0, 3.9, -9.5], '#ffd9a8', 2.4, 11, false));
	slots.push(pointLight('bw-light-lobby-1', 'Lounge Light', [-4.2, 3.9, -3.2], '#ffd0a0', 2.2, 9, false));
	slots.push(pointLight('bw-light-lobby-2', 'Lounge Light', [4.2, 3.9, -3.2], '#ffd0a0', 2.2, 9, false));
	slots.push(pointLight('bw-light-shoes', 'Shoe Counter Light', [0, 3.4, -12.4], '#ffc27a', 1.8, 7, false));
	return slots;
}
