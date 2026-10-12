import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { GRID, POOLS } from './deadDropData.ts';
import { CORNER, ID, PARKED, PROP_TOP, cellCenter, mesh } from './deadDropKit.ts';
import { COLOR, FURNITURE, MATERIAL, composite } from './deadDropLook.ts';

const { cell: C, size: N, wallHeight: H, doorWidth: DOOR } = GRID;
const [OX, , OZ] = GRID.origin;
const THICK = 0.3;
const LINTEL = 2.4;
const WALL_TINT = '#d6d2c8';

/** The raid's whole width: the grid of rooms. */
export const RAID_SIZE = C * N;

/** Where furniture can stand in a room: along the walls, either side of the doorways and clear of the corner props. */
export const WALL_SPOTS: { x: number; z: number; yaw: number }[] = (() => {
	const spots: { x: number; z: number; yaw: number }[] = [];
	for (const side of [-1, 1]) {
		for (const along of [-2, 2]) {
			spots.push({ x: along, z: side * 4.6, yaw: side > 0 ? Math.PI : 0 });
			spots.push({ x: side * 4.6, z: along, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
		}
	}
	return spots;
})();

/** A doorway in a wall of length `C`: two side pieces, a lintel and a hazard strip on the floor, in the wall's own coordinates. */
function doorway(prefix: string, name: string, at: [number, number], alongX: boolean): Slot[] {
	const side = (C - DOOR) / 2;
	const offset = DOOR / 2 + side / 2;
	const place = (along: number, y: number, long: number, high: number): { position: [number, number, number]; scale: [number, number, number] } => ({
		position: alongX ? [at[0] + along, y, at[1]] : [at[0], y, at[1] + along],
		scale: alongX ? [long, high, THICK] : [THICK, high, long]
	});
	const piece = (id: string, along: number, y: number, long: number, high: number) => {
		const { position, scale } = place(along, y, long, high);
		return mesh(id, name, 'box', position, scale, WALL_TINT, { solid: true, disabled: true, material: MATERIAL.wall });
	};
	const strip = place(0, 0.006, DOOR, 0.012);
	return [
		piece(`${prefix}-l`, -offset, H / 2, side, H),
		piece(`${prefix}-r`, offset, H / 2, side, H),
		piece(`${prefix}-top`, 0, LINTEL + (H - LINTEL) / 2, DOOR, H - LINTEL),
		mesh(`${prefix}-mark`, 'Threshold', 'box', strip.position, alongX ? [DOOR, 0.012, 0.5] : [0.5, 0.012, DOOR], COLOR.hazard, { unlit: true, disabled: true })
	];
}

/** Everything of the raid that the layout switches on and off or moves in: walls, doorways, props, furniture, the exits. */
export function buildRaid(): Slot[] {
	const slots: Slot[] = [
		createSlot({
			id: ID.raidFloor,
			name: 'Raid Floor',
			position: [OX, -0.05, OZ],
			scale: [RAID_SIZE / 20, 1, RAID_SIZE / 20],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#c9c5bb' }, MATERIAL.floor, { type: 'collider', shape: 'box' }]
		}),
		mesh('dd-r-ceiling', 'Raid Ceiling', 'box', [OX, H + 0.1, OZ], [RAID_SIZE + 0.6, 0.2, RAID_SIZE + 0.6], '#6e7076', { material: MATERIAL.plate }),
		mesh('dd-r-wall-n', 'Outer Wall', 'box', [OX, H / 2, OZ + RAID_SIZE / 2 + THICK / 2], [RAID_SIZE + 0.6, H, THICK], WALL_TINT, { solid: true, material: MATERIAL.wall }),
		mesh('dd-r-wall-s', 'Outer Wall', 'box', [OX, H / 2, OZ - RAID_SIZE / 2 - THICK / 2], [RAID_SIZE + 0.6, H, THICK], WALL_TINT, { solid: true, material: MATERIAL.wall }),
		mesh('dd-r-wall-w', 'Outer Wall', 'box', [OX - RAID_SIZE / 2 - THICK / 2, H / 2, OZ], [THICK, H, RAID_SIZE + 0.6], WALL_TINT, { solid: true, material: MATERIAL.wall }),
		mesh('dd-r-wall-e', 'Outer Wall', 'box', [OX + RAID_SIZE / 2 + THICK / 2, H / 2, OZ], [THICK, H, RAID_SIZE + 0.6], WALL_TINT, { solid: true, material: MATERIAL.wall }),
		// Light in the raid: a warm lamp in the middle of every room, baked (the lamp fixtures below are what it comes from).
		...Array.from({ length: N * N }, (_, i) => {
			const [x, , z] = cellCenter(i % N, Math.floor(i / N));
			return createSlot({ id: `dd-r-light-${i}`, name: 'Raid Light', position: [x, H - 0.4, z], components: [{ type: 'pointLight', color: '#ffd9a0', intensity: 1.2, range: 6.5, baked: true }] });
		})
	];

	// Between two rooms the wall is solid, or has a doorway; the layout switches which.
	for (let z = 0; z < N; z++) {
		for (let x = 0; x < N - 1; x++) {
			const at: [number, number] = [OX + (x - 1) * C + C / 2, OZ + (z - 1) * C];
			slots.push(mesh(ID.edge('e', x, z), 'Wall', 'box', [at[0], H / 2, at[1]], [THICK, H, C], WALL_TINT, { solid: true, material: MATERIAL.wall }), ...doorway(ID.edge('e', x, z), 'Doorway', at, false));
		}
	}
	for (let z = 0; z < N - 1; z++) {
		for (let x = 0; x < N; x++) {
			const at: [number, number] = [OX + (x - 1) * C, OZ + (z - 1) * C + C / 2];
			slots.push(mesh(ID.edge('n', x, z), 'Wall', 'box', [at[0], H / 2, at[1]], [C, H, THICK], WALL_TINT, { solid: true, material: MATERIAL.wall }), ...doorway(ID.edge('n', x, z), 'Doorway', at, true));
		}
	}

	for (let cz = 0; cz < N; cz++) {
		for (let cx = 0; cx < N; cx++) {
			const centre = cellCenter(cx, cz);
			// Cover in the four corners, in one of two styles: crates, or low walls and barrels.
			for (let variant = 0; variant < 2; variant++) {
				for (let corner = 0; corner < 4; corner++) {
					const x = corner % 2 === 0 ? -CORNER : CORNER;
					const z = corner < 2 ? -CORNER : CORNER;
					const position: [number, number, number] = [centre[0] + x, PROP_TOP / 2, centre[2] + z];
					const id = ID.prop(cx, cz, variant, corner);
					if (variant === 0) slots.push(mesh(id, 'Crate', 'box', position, [1.4, PROP_TOP, 1.4], corner % 2 ? COLOR.olive : COLOR.wood, { solid: true, disabled: true }));
					else if (corner % 2) slots.push(mesh(id, 'Low Wall', 'box', position, [2.4, PROP_TOP, 0.5], COLOR.concreteDark, { solid: true, disabled: true, material: MATERIAL.wall }));
					else slots.push(mesh(id, 'Barrel', 'cylinder', position, [0.9, PROP_TOP, 0.9], corner < 2 ? COLOR.rust : COLOR.olive, { solid: true, disabled: true }));
				}
			}
			// Always there: a ceiling lamp, a pipe along the ceiling, and some dust in the air.
			const tag = `dd-r-${cx}${cz}`;
			slots.push(
				mesh(`${tag}-lamp`, 'Ceiling Lamp', 'box', [centre[0], H - 0.04, centre[2]], [1.2, 0.06, 0.3], COLOR.lamp, { unlit: true }),
				mesh(`${tag}-pipe-a`, 'Pipe', 'cylinder', [centre[0] - 3, H - 0.25, centre[2]], [0.18, C - 0.8, 0.18], COLOR.metalDark, { rotation: [Math.sin(Math.PI / 4), 0, 0, Math.cos(Math.PI / 4)] }),
				createSlot({ id: `${tag}-dust`, name: 'Dust', position: [centre[0], 1.6, centre[2]], components: [{ type: 'particleEmitter', color: '#d9d4c7', capacity: 28, rate: 4, radius: 4, size: 0.05, lifetime: 7, speed: 0.06, opacity: 0.25, active: true }] })
			);
		}
	}

	// Furniture, put in the rooms by the layout.
	const pools: [keyof typeof FURNITURE, number, (i: number) => string][] = [
		['shelf', POOLS.shelves, ID.shelf], ['bunk', POOLS.bunks, ID.bunk], ['desk', POOLS.desks, ID.desk], ['pillar', POOLS.pillars, ID.pillar], ['safe', POOLS.safes, ID.safe]
	];
	for (const [kind, count, id] of pools) for (let i = 0; i < count; i++) slots.push(...composite(id(i), kind, PARKED, 0, FURNITURE[kind], { parked: true }));

	// The three exits and the place the squad arrives; the layout moves them to their rooms.
	for (let i = 0; i < 3; i++) {
		slots.push(
			mesh(ID.exit(i), 'Exit Zone', 'cylinder', PARKED, [4.4, 0.05, 4.4], COLOR.go, { unlit: true, opacity: 0.45 }),
			mesh(ID.exitBeacon(i), 'Exit Beacon', 'cylinder', PARKED, [0.3, 3, 0.3], COLOR.go, { unlit: true, opacity: 0.7 }),
			createSlot({
				id: ID.arrow(i),
				name: 'Exit Sign',
				position: PARKED,
				scale: [1.6, 0.5, 1],
				components: [
					{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#052e16' },
					{ type: 'textDisplay', title: 'EXIT', lines: [], color: '#052e16', scale: 0.8, verticalAlign: 'middle' }
				]
			})
		);
	}
	slots.push(mesh(ID.entryPad, 'Entry Pad', 'cylinder', PARKED, [3, 0.04, 3], '#38bdf8', { unlit: true, opacity: 0.5 }));
	return slots;
}
