import type { MaterialComponent, Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import type { Vec3 } from './arcadeKit.ts';
import { GRID, POOLS } from './deadDropData.ts';

/** Where the middle of a cell of the raid is (on the floor). */
export const cellCenter = (cx: number, cz: number): Vec3 => [GRID.origin[0] + (cx - 1) * GRID.cell, 0, GRID.origin[2] + (cz - 1) * GRID.cell];

/** Where the loot sits in a cell: the four corners, on top of the prop that stands there. */
export const CORNER = 3.4;
export const PROP_TOP = 1.1;
export const cornerOffset = (spot: number): [number, number] => [spot % 2 === 0 ? -CORNER : CORNER, spot < 2 ? -CORNER : CORNER];

/** The ids of everything the game's scripts reach by name. */
export const ID = {
	director: 'dd-hub',
	consolePanel: 'dd-ui',
	message: 'dd-msg',
	board: 'dd-board',
	top: 'dd-top',
	join: 'dd-bjoin',
	leave: 'dd-bleave',
	start: 'dd-bstart',
	commands: 'dd-cmd',
	stashScreen: 'dd-ss',
	traderScreen: 'dd-ts',
	flush: 'dd-flush',
	raidFloor: 'dd-r-floor',
	entryPad: 'dd-r-entry',
	edge: (kind: 'e' | 'n', x: number, z: number) => `dd-e-${kind}${x}${z}`,
	prop: (cx: number, cz: number, variant: number, corner: number) => `dd-p-${cx}${cz}-${variant}${corner}`,
	exit: (index: number) => `dd-x-${index}`,
	exitBeacon: (index: number) => `dd-x-${index}-beacon`,
	soldier: (index: number) => `dd-s-${index}`,
	dog: (index: number) => `dd-d-${index}`,
	turret: (index: number) => `dd-t-${index}`,
	loot: (index: number) => `dd-l-${index}`,
	bag: (index: number) => `dd-b-${index}`,
	tracer: (index: number) => `dd-tr-${index}`,
	shelf: (index: number) => `dd-f-shelf-${index}`,
	bunk: (index: number) => `dd-f-bunk-${index}`,
	desk: (index: number) => `dd-f-desk-${index}`,
	pillar: (index: number) => `dd-f-pillar-${index}`,
	safe: (index: number) => `dd-f-safe-${index}`,
	arrow: (index: number) => `dd-x-${index}-arrow`,
	gun: (index: number) => `dd-gun-${index}`,
	fx: (index: number) => `dd-fx-${index}`
} as const;

/** Where a parked thing waits, out of sight and out of the way, until the game moves it in: moving a slot costs nothing to guests, switching one on or off costs a whole snapshot. */
export const PARKED: Vec3 = [0, -200, 0];

/** The lamps of the raid gate in the bunker: green while a raid can be started, red while one is under way. */
export const GATE = { open: 'dd-gate-open', closed: 'dd-gate-closed' } as const;

/** The ids of everything that moves and is not a wall: a shot or a ray passes through them. */
export function nonSolidIds(): string[] {
	const ids: string[] = [];
	for (let i = 0; i < POOLS.soldiers; i++) ids.push(ID.soldier(i));
	for (let i = 0; i < POOLS.dogs; i++) ids.push(ID.dog(i));
	for (let i = 0; i < POOLS.turrets; i++) ids.push(ID.turret(i));
	for (let i = 0; i < POOLS.loot; i++) ids.push(ID.loot(i));
	for (let i = 0; i < POOLS.bags; i++) ids.push(ID.bag(i));
	for (let i = 0; i < POOLS.tracers; i++) ids.push(ID.tracer(i));
	for (let i = 0; i < POOLS.guns; i++) ids.push(ID.gun(i), ID.fx(i));
	for (let i = 0; i < 3; i++) ids.push(ID.exit(i), ID.exitBeacon(i));
	ids.push(ID.entryPad);
	return ids;
}

/** A mesh slot with a built-in shape, lit unless `unlit`. */
export function mesh(
	id: string,
	name: string,
	shape: 'box' | 'sphere' | 'cylinder' | 'plane',
	position: Vec3,
	scale: Vec3,
	color: string,
	options: { parentId?: string; unlit?: boolean; opacity?: number; solid?: boolean; disabled?: boolean; material?: MaterialComponent; rotation?: [number, number, number, number] } = {}
): Slot {
	const slot = createSlot({
		id,
		name,
		parentId: options.parentId ?? null,
		position,
		scale,
		...(options.rotation ? { rotation: options.rotation } : {}),
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: shape }, color, ...(options.unlit ? { unlit: true } : {}), ...(options.opacity === undefined ? {} : { opacity: options.opacity }) },
			...(options.material ? [options.material] : []),
			...(options.solid ? [{ type: 'collider' as const, shape: 'box' as const }] : [])
		]
	});
	return options.disabled ? { ...slot, disabled: true } : slot;
}
