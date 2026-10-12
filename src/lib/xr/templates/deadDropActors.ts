import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import type { Vec3 } from './arcadeKit.ts';
import { ENEMIES, POOLS } from './deadDropData.ts';
import { ID, PARKED, mesh } from './deadDropKit.ts';
import { COLOR } from './deadDropLook.ts';

/** Ids of the parts of the gun that the scripts reach: `dd-gun-<n>` plus these. */
export const GUN_PART = { brain: 'brain', muzzle: 'muzzle', model: 'model', readout: 'readout', hp: 'hp', mag: 'mag', pack: 'pack', arrow: 'arrow' } as const;
export const gunPart = (index: number, part: string): string => `${ID.gun(index)}-${part}`;

/** The bars on the gun are this wide and tall when full. */
export const BAR = { width: 0.1, height: 0.008, depth: 0.009, y: 0.052, hpZ: -0.066, magZ: -0.078, packZ: -0.09 } as const;

interface Piece {
	key: string;
	position: Vec3;
	scale: Vec3;
	color: string;
	shape?: 'box' | 'sphere' | 'cylinder';
	unlit?: boolean;
	/** A joint: an empty slot the script turns, with the parts that hang from it as children. */
	pivot?: boolean;
	/** The key of the joint this part hangs from (its position is then in the joint's own coordinates). */
	parent?: string;
}

/** A part's scale while hidden: too small to see, so that showing it is a change of scale (which costs the guests nothing). */
const TINY: Vec3 = [0.001, 0.001, 0.001];

/** The marks over an enemy's head: a ball that fills as it notices, and a bar and dot (an exclamation mark) when it has. `at` is the height of the top of its head. */
const marks = (at: number): Piece[] => [
	{ key: 'mY', position: [0, at + 0.3, 0], scale: TINY, color: '#facc15', shape: 'sphere', unlit: true },
	{ key: 'mBar', position: [0, at + 0.42, 0], scale: TINY, color: COLOR.alert, unlit: true },
	{ key: 'mDot', position: [0, at + 0.18, 0], scale: TINY, color: COLOR.alert, unlit: true }
];

/** The soldier: parts in its own coordinates, facing +z with the feet on y = 0. The script swings the legs and tips the whole thing over when it dies. */
export const SOLDIER_PARTS: Piece[] = [
	// The legs hang from the hips, so that they swing from there.
	{ key: 'legL', position: [-0.11, 0.8, 0], scale: TINY, color: '#3f3a33', pivot: true },
	{ key: 'legLm', parent: 'legL', position: [0, -0.4, 0], scale: [0.17, 0.8, 0.2], color: '#3f3a33' },
	{ key: 'legR', position: [0.11, 0.8, 0], scale: TINY, color: '#3f3a33', pivot: true },
	{ key: 'legRm', parent: 'legR', position: [0, -0.4, 0], scale: [0.17, 0.8, 0.2], color: '#3f3a33' },
	// Everything above the hips leans and flinches together; the head turns and the arms swing from the shoulders.
	{ key: 'upper', position: [0, 0.8, 0], scale: TINY, color: '#4a4f38', pivot: true },
	{ key: 'torso', parent: 'upper', position: [0, 0.3, 0], scale: [0.52, 0.62, 0.3], color: '#4a4f38' },
	{ key: 'pack', parent: 'upper', position: [0, 0.35, -0.24], scale: [0.4, 0.5, 0.2], color: '#2f3321' },
	{ key: 'head', parent: 'upper', position: [0, 0.66, 0], scale: TINY, color: '#a8977f', pivot: true },
	{ key: 'headm', parent: 'head', position: [0, 0.09, 0], scale: [0.26, 0.28, 0.26], color: '#a8977f', shape: 'sphere' },
	{ key: 'helmet', parent: 'head', position: [0, 0.21, 0.01], scale: [0.32, 0.16, 0.34], color: '#3b4030' },
	{ key: 'visor', parent: 'head', position: [0, 0.11, 0.15], scale: [0.24, 0.06, 0.04], color: COLOR.alert, unlit: true },
	{ key: 'armR', parent: 'upper', position: [0.31, 0.55, 0], scale: TINY, color: '#4a4f38', pivot: true },
	{ key: 'armRm', parent: 'armR', position: [0, 0, 0.25], scale: [0.13, 0.13, 0.5], color: '#4a4f38' },
	{ key: 'rifle', parent: 'armR', position: [-0.11, -0.14, 0.42], scale: [0.08, 0.12, 0.72], color: COLOR.black },
	{ key: 'armL', parent: 'upper', position: [-0.31, 0.55, 0], scale: TINY, color: '#4a4f38', pivot: true },
	{ key: 'armLm', parent: 'armL', position: [0, 0, 0.25], scale: [0.13, 0.13, 0.5], color: '#4a4f38' },
	{ key: 'flash', position: [0, 0.95, 0], scale: TINY, color: '#ffffff', unlit: true },
	...marks(1.75)
];
/** How big the white shell that shows a hit is, when shown. */
export const HIT_SHELL: Vec3 = [0.62, 1.95, 0.46];

/** Where a soldier's rifle ends, and a turret's barrels, in their own coordinates. */
export const MUZZLE_AT = { soldier: [0.2, 1.2, 0.8], heavy: [0.2, 1.2, 0.8], dog: [0, 0.5, 0.6], turret: [0, 0.85, 0.85] } as const;

/** The dog: low and long, facing +z. The script swings its legs and rolls it over when it dies. */
export const DOG_PARTS: Piece[] = [
	{ key: 'body', position: [0, 0.48, 0], scale: [0.34, 0.34, 0.9], color: '#7c5a3a' },
	// The head dips and lifts, the tail wags and the legs swing from where they join the body.
	{ key: 'head', position: [0, 0.62, 0.45], scale: TINY, color: '#6b4a2f', pivot: true },
	{ key: 'headm', parent: 'head', position: [0, 0.04, 0.11], scale: [0.26, 0.26, 0.3], color: '#6b4a2f' },
	{ key: 'snout', parent: 'head', position: [0, -0.02, 0.33], scale: [0.14, 0.12, 0.2], color: '#3b2a1b' },
	{ key: 'eyes', parent: 'head', position: [0, 0.08, 0.23], scale: [0.2, 0.04, 0.03], color: COLOR.alert, unlit: true },
	{ key: 'tail', position: [0, 0.6, -0.45], scale: TINY, color: '#6b4a2f', pivot: true },
	{ key: 'tailm', parent: 'tail', position: [0, 0, -0.15], scale: [0.07, 0.07, 0.3], color: '#6b4a2f' },
	{ key: 'legF', position: [0, 0.4, 0.3], scale: TINY, color: '#6b4a2f', pivot: true },
	{ key: 'legFm', parent: 'legF', position: [0, -0.2, 0], scale: [0.3, 0.4, 0.1], color: '#6b4a2f' },
	{ key: 'legB', position: [0, 0.4, -0.3], scale: TINY, color: '#6b4a2f', pivot: true },
	{ key: 'legBm', parent: 'legB', position: [0, -0.2, 0], scale: [0.3, 0.4, 0.1], color: '#6b4a2f' },
	{ key: 'flash', position: [0, 0.4, 0], scale: TINY, color: '#ffffff', unlit: true },
	...marks(0.85)
];
export const DOG_SHELL: Vec3 = [0.5, 0.9, 1.15];

export const TURRET_PARTS: Piece[] = [
	{ key: 'base', position: [0, 0.25, 0], scale: [0.7, 0.5, 0.7], color: '#57534e', shape: 'cylinder' },
	{ key: 'neck', position: [0, 0.62, 0], scale: [0.26, 0.3, 0.26], color: COLOR.metalDark },
	{ key: 'head', position: [0, 0.85, 0], scale: [0.52, 0.3, 0.56], color: '#44403c' },
	{ key: 'plate', position: [0, 0.85, 0.3], scale: [0.5, 0.26, 0.04], color: COLOR.rust },
	{ key: 'barrelA', position: [-0.13, 0.85, 0.6], scale: [0.07, 0.07, 0.6], color: COLOR.black },
	{ key: 'barrelB', position: [0.13, 0.85, 0.6], scale: [0.07, 0.07, 0.6], color: COLOR.black },
	{ key: 'eye', position: [0, 0.97, 0.3], scale: [0.1, 0.1, 0.1], color: COLOR.alert, shape: 'sphere', unlit: true },
	...marks(1.05)
];

function figure(id: string, name: string, parts: Piece[]): Slot[] {
	return [
		createSlot({ id, name, position: PARKED, components: [{ type: 'container' }] }),
		...parts.map((part) => {
			const parentId = part.parent ? `${id}-${part.parent}` : id;
			// A joint is an empty slot; anything else is a mesh.
			if (part.pivot) return createSlot({ id: `${id}-${part.key}`, parentId, name, position: part.position, components: [{ type: 'container' }] });
			return mesh(`${id}-${part.key}`, name, part.shape ?? 'box', part.position, part.scale, part.color, { parentId, unlit: part.unlit, opacity: part.key === 'flash' ? 0.55 : undefined });
		})
	];
}

export const buildSoldiers = (): Slot[] => Array.from({ length: POOLS.soldiers }, (_, i) => figure(ID.soldier(i), ENEMIES.soldier.name, SOLDIER_PARTS)).flat();
export const buildDogs = (): Slot[] => Array.from({ length: POOLS.dogs }, (_, i) => figure(ID.dog(i), ENEMIES.dog.name, DOG_PARTS)).flat();
export const buildTurrets = (): Slot[] => Array.from({ length: POOLS.turrets }, (_, i) => figure(ID.turret(i), ENEMIES.turret.name, TURRET_PARTS)).flat();

/** Loot: a small crate and its label. The game gives each one an item when a raid begins. */
export function buildLoot(): Slot[] {
	return Array.from({ length: POOLS.loot }, (_, index) => {
		const id = ID.loot(index);
		return [
			mesh(id, 'Loot', 'box', PARKED, [0.22, 0.22, 0.22], '#a8a29e', { unlit: true }),
			createSlot({
				id: `${id}-label`,
				parentId: id,
				name: 'Loot Label',
				position: [0, 0.36, 0],
				scale: [1.5, 0.6, 1],
				components: [
					{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0c0a09' },
					{ type: 'textDisplay', title: '', lines: [], color: '#0c0a09', scale: 0.4 }
				]
			})
		];
	}).flat();
}

/** What a player leaves behind when they die: a bag a teammate can take. */
export function buildBags(): Slot[] {
	return Array.from({ length: POOLS.bags }, (_, index) => {
		const id = ID.bag(index);
		return [
			createSlot({ id, name: 'Dropped Bag', position: PARKED, components: [{ type: 'container' }] }),
			mesh(`${id}-body`, 'Bag', 'box', [0, 0.2, 0], [0.5, 0.4, 0.3], '#7f1d1d', { parentId: id }),
			mesh(`${id}-strap`, 'Bag Strap', 'box', [0, 0.2, 0.16], [0.08, 0.42, 0.02], COLOR.black, { parentId: id }),
			mesh(`${id}-beacon`, 'Bag Beacon', 'cylinder', [0, 1.5, 0], [0.08, 3, 0.08], '#f87171', { parentId: id, unlit: true, opacity: 0.6 })
		];
	}).flat();
}

/** Tracers and aiming lasers: thin boxes the game lays along a line and parks again. */
export function buildTracers(): Slot[] {
	return Array.from({ length: POOLS.tracers }, (_, index) =>
		mesh(ID.tracer(index), 'Tracer', 'box', PARKED, [0.02, 0.02, 1], index < POOLS.tracers - 4 ? '#fde047' : COLOR.alert, { unlit: true })
	);
}

/** The two models a gun can show: where each part is, relative to the grip. The other one is shrunk away. */
export const GUN_MODELS: Record<'pistol' | 'smg', { parts: Piece[]; muzzle: Vec3 }> = {
	pistol: {
		parts: [
			{ key: 'slide', position: [0, 0.04, 0.075], scale: [0.032, 0.034, 0.17], color: '#2b2d31' },
			{ key: 'sight', position: [0, 0.064, 0.14], scale: [0.01, 0.012, 0.012], color: COLOR.hazard, unlit: true },
			{ key: 'mag', position: [0, -0.1, -0.012], scale: [0.026, 0.05, 0.036], color: '#1b1c1e' }
		],
		muzzle: [0, 0.04, 0.165]
	},
	smg: {
		parts: [
			{ key: 'receiver', position: [0, 0.032, 0.11], scale: [0.046, 0.052, 0.26], color: '#2b2d31' },
			{ key: 'handguard', position: [0, 0.024, 0.3], scale: [0.05, 0.046, 0.14], color: '#1b1c1e' },
			{ key: 'barrel', position: [0, 0.03, 0.42], scale: [0.015, 0.015, 0.12], color: '#8b8f96' },
			{ key: 'stock', position: [0, 0.014, -0.17], scale: [0.04, 0.05, 0.16], color: '#1b1c1e' },
			{ key: 'mag', position: [0, -0.1, 0.12], scale: [0.03, 0.16, 0.05], color: '#1b1c1e' },
			{ key: 'sight', position: [0, 0.072, 0.1], scale: [0.014, 0.034, 0.05], color: COLOR.hazard, unlit: true }
		],
		muzzle: [0, 0.03, 0.49]
	}
};
const HIDDEN: Vec3 = [0.001, 0.001, 0.001];

/**
 * How a gun sits in the hand: tipped down a little, as a wrist holds it, and moved so that the middle of the handle (the box called
 * Grip, below) is exactly at the hand and not the top of the gun. The pose puts the gun's origin at the hand, so the origin has to be
 * where the handle is not: it is the handle's position turned by the tilt and taken away.
 */
const HANDLE: Vec3 = [0, -0.05, -0.02];
const TILT_DEGREES = 15;
const HELD = (() => {
	const a = (TILT_DEGREES * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
	// A turn about x takes (y, z) to (y c - z s, y s + z c).
	const round = (n: number) => Math.round(n * 10000) / 10000;
	return { position: [0, round(-(HANDLE[1] * c - HANDLE[2] * s)), round(-(HANDLE[1] * s + HANDLE[2] * c))] as Vec3, rotation: [TILT_DEGREES, 0, 0] as Vec3 };
})();

/**
 * The script of a gun. It only reports what the hand did, in its own `scriptState`, which the director reads: a script cannot call
 * another. The radial menu (the only thing that works the same in a headset and on the desktop) sends commands the director
 * picks up: a guest cannot change the world, but its spawns reach the host, so a command is a short-lived slot under `dd-cmd`.
 */
function gunBrain(index: number): string {
	return `
const GUN = ${index}, BRAIN = ${JSON.stringify(ID.gun(index) + '-brain')}, COMMANDS = ${JSON.stringify(ID.commands)};
const state = { seq: 0, down: false, equipped: false, playerId: '', name: '', hand: 'right' };
const write = () => ctx.world.setComponentField(BRAIN, 'scriptState', 'data', { ...state }, false);
const send = (cmd) => {
	const holder = ctx.equip.holder();
	if (!holder) return;
	ctx.world.spawn({ name: 'Command', parentId: COMMANDS, components: [{ type: 'scriptState', data: { cmd, gun: GUN, player: holder.playerId } }, { type: 'expires', expiresAt: Date.now() + 6000 }] });
};
return {
	onEquip(event) { state.equipped = true; state.playerId = event.playerId; state.name = event.playerName; state.hand = event.hand; state.down = false; write(); },
	onUnequip() { state.equipped = false; state.down = false; write(); },
	onTrigger(event) {
		if (event.phase === 'press') { state.down = true; state.seq += 1; }
		else if (event.phase === 'release') state.down = false;
		else return;
		state.playerId = event.playerId; state.name = event.playerName; state.hand = event.hand;
		write();
	},
	getRadialItems() {
		return [
			{ label: 'Reload', isEnabled: () => true, onSelect: () => send('reload') },
			{ label: 'Medkit', isEnabled: () => true, onSelect: () => send('medkit') },
			{ label: 'Switch weapon', isEnabled: () => true, onSelect: () => send('switch') }
		];
	}
};`;
}

/** The guns on the rack in the hub: one per squad member. Each shows health, magazine and pack as bars and an arrow to the exit, and the rest as a few lines of text. */
export function buildGuns(rack: Vec3): Slot[] {
	return Array.from({ length: POOLS.guns }, (_, index) => {
		const root = ID.gun(index);
		const model = gunPart(index, GUN_PART.model);
		const child = (part: string, name: string, position: Vec3, scale: Vec3, color: string, options: { solid?: boolean; unlit?: boolean; parentId?: string } = {}) =>
			mesh(`${root}-${part}`, name, 'box', position, scale, color, { parentId: options.parentId ?? root, solid: options.solid, unlit: options.unlit });
		const pieces = (kind: 'pistol' | 'smg', shown: boolean): Slot[] =>
			GUN_MODELS[kind].parts.map((part) => child(`${kind}-${part.key}`, kind === 'pistol' ? 'Pistol' : 'Submachine Gun', part.position, shown ? part.scale : HIDDEN, part.color, { parentId: model, unlit: part.unlit }));
		return [
			createSlot({
				id: root,
				name: 'Weapon',
				position: [rack[0] - 0.9 + index * 0.6, rack[1], rack[2]],
				components: [
					{ type: 'container' },
					{ type: 'grabbable', scalable: false, autoGrip: true },
					{ type: 'equippable', left: HELD, right: HELD, autoGrip: true }
				]
			}),
			child('grip', 'Grip', [0, -0.05, -0.02], [0.034, 0.11, 0.044], '#1b1c1e', { solid: true }),
			child('frame', 'Frame', [0, 0.012, 0.04], [0.045, 0.05, 0.16], '#2b2d31', { solid: true }),
			createSlot({ id: model, parentId: root, name: 'Weapon Model', components: [{ type: 'container' }] }),
			...pieces('pistol', true),
			...pieces('smg', false),
			createSlot({ id: gunPart(index, GUN_PART.muzzle), parentId: root, name: 'Muzzle', position: GUN_MODELS.pistol.muzzle }),
			child('bar-bg', 'Bars', [0, 0.05, -0.078], [BAR.width + 0.004, 0.006, 0.04], '#0c0a09', { unlit: true }),
			child(GUN_PART.hp, 'Health Bar', [0, BAR.y, BAR.hpZ], [BAR.width, BAR.height, BAR.depth], '#4ade80', { unlit: true }),
			child(GUN_PART.mag, 'Magazine Bar', [0, BAR.y, BAR.magZ], [BAR.width, BAR.height, BAR.depth], '#facc15', { unlit: true }),
			child(GUN_PART.pack, 'Pack Bar', [0, BAR.y, BAR.packZ], [BAR.width, BAR.height, BAR.depth], '#60a5fa', { unlit: true }),
			child(GUN_PART.arrow, 'Exit Arrow', [0.075, 0.056, 0.0], [0.012, 0.006, 0.045], COLOR.go, { unlit: true }),
			createSlot({
				id: gunPart(index, GUN_PART.readout),
				parentId: root,
				name: 'Readout',
				position: [0, 0.11, 0.02],
				rotation: [Math.sin(Math.PI / 7), 0, 0, Math.cos(Math.PI / 7)],
				scale: [0.19, 0.095, 1],
				components: [
					{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0c0a09' },
					{ type: 'textDisplay', title: 'DEAD DROP', lines: ['Equip me, then JOIN', 'at the console'], color: '#0c0a09', scale: 0.34 }
				]
			}),
			createSlot({ id: gunPart(index, GUN_PART.brain), parentId: root, name: 'Weapon Brain', components: [{ type: 'scriptState', data: {} }, { type: 'codeBlock', code: gunBrain(index) }] })
		];
	}).flat();
}

/**
 * What a player sees when they die: a red veil and a banner that the director holds in front of their eyes for as long as they are
 * dead (one pair for each gun, so for each member of the squad), parked the rest of the time.
 */
export function buildDeathVeils(): Slot[] {
	return Array.from({ length: POOLS.guns }, (_, index) => {
		const id = ID.fx(index);
		return [
			createSlot({ id, name: 'Death Veil', position: PARKED, components: [{ type: 'container' }] }),
			mesh(`${id}-veil`, 'Veil', 'plane', [0, 0, 0], [3.4, 2.4, 1], '#7f0d0d', { parentId: id, unlit: true, opacity: 0.6 }),
			createSlot({
				id: `${id}-text`,
				parentId: id,
				name: 'Death Banner',
				position: [0, 0, -0.01],
				scale: [0.9, 0.24, 1],
				components: [
					{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#0c0a09' },
					{ type: 'textDisplay', title: 'YOU DIED', lines: [''], color: '#0c0a09', scale: 1.6, verticalAlign: 'middle' }
				]
			})
		];
	}).flat();
}
