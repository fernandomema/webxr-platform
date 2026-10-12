import type { MaterialComponent, Quat, Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import type { Vec3 } from './arcadeKit.ts';
import { PARKED, mesh } from './deadDropKit.ts';

/** The colours of Dead Drop: a worn military bunker lit by warm lamps, with orange and red for what matters. */
export const COLOR = {
	concrete: '#b8b4ab',
	concreteDark: '#6f6c66',
	floor: '#8d8a83',
	metal: '#6c7178',
	metalDark: '#35383d',
	rust: '#9a5a36',
	olive: '#59623a',
	canvas: '#7a7352',
	wood: '#7c5a3a',
	hazard: '#f5b301',
	black: '#16171a',
	lamp: '#ffe2a8',
	screen: '#46e1ff',
	alert: '#ff3b2f',
	go: '#3be06b'
} as const;

const texture = (id: string, map: string) => ({ kind: 'url' as const, url: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_${map}_1k.jpg` });

/** A Poly Haven (CC0) material laid on a surface by real size: `size` metres per repeat, however the slot is scaled. */
export function material(id: string, size: number, label: string): MaterialComponent {
	return { type: 'material', albedo: texture(id, 'diff'), normal: texture(id, 'nor_gl'), arm: texture(id, 'arm'), mapping: 'world', size, label };
}

export const MATERIAL = {
	wall: material('concrete_wall_008', 3, 'Concrete wall'),
	floor: material('concrete_floor_worn_001', 3, 'Worn concrete floor'),
	plate: material('metal_plate_02', 2, 'Metal plate'),
	rust: material('rusty_metal_02', 2, 'Rusty metal'),
	iron: material('corrugated_iron', 2, 'Corrugated iron'),
	/** Painted military metal, worn through to rust: lockers, doors, crates of ammunition. */
	olive: material('green_metal_rust', 1.5, 'Green painted metal'),
	/** Clean steel plate, for counters and cabinets. */
	steel: material('metal_plate', 1.5, 'Steel plate'),
	planks: material('brown_planks_03', 1.5, 'Wooden planks'),
	plywood: material('plywood', 1.5, 'Plywood')
} as const;

export const yawOf = (yaw: number): Quat => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

/** A group of parts that moves as one: the root is a container and the parts are laid out in its own coordinates. */
export interface Part {
	key: string;
	shape: 'box' | 'sphere' | 'cylinder' | 'plane';
	position: Vec3;
	scale: Vec3;
	color: string;
	unlit?: boolean;
	solid?: boolean;
	opacity?: number;
	material?: MaterialComponent;
}

export function composite(id: string, name: string, at: Vec3, yaw: number, parts: Part[], options: { parked?: boolean } = {}): Slot[] {
	const root = createSlot({ id, name, position: options.parked ? PARKED : at, rotation: yawOf(yaw), components: [{ type: 'container' }] });
	return [root, ...parts.map((part) => mesh(`${id}-${part.key}`, name, part.shape, part.position, part.scale, part.color, { parentId: id, unlit: part.unlit, solid: part.solid, opacity: part.opacity, material: part.material }))];
}

/** Furniture, each with the parts it is made of, in its own coordinates: it faces +z, and its back is at z = -0.25. */
export const FURNITURE: Record<'shelf' | 'bunk' | 'desk' | 'pillar' | 'safe', Part[]> = {
	shelf: [
		{ key: 'back', shape: 'box', position: [0, 0.95, -0.2], scale: [1.2, 1.9, 0.05], color: COLOR.metalDark, solid: true },
		{ key: 'b0', shape: 'box', position: [0, 0.3, 0], scale: [1.2, 0.04, 0.45], color: COLOR.metal },
		{ key: 'b1', shape: 'box', position: [0, 0.95, 0], scale: [1.2, 0.04, 0.45], color: COLOR.metal },
		{ key: 'b2', shape: 'box', position: [0, 1.6, 0], scale: [1.2, 0.04, 0.45], color: COLOR.metal },
		{ key: 'c0', shape: 'box', position: [-0.3, 0.5, 0], scale: [0.4, 0.34, 0.34], color: COLOR.wood },
		{ key: 'c1', shape: 'box', position: [0.25, 1.15, 0], scale: [0.5, 0.34, 0.34], color: COLOR.olive },
		{ key: 'c2', shape: 'box', position: [-0.2, 1.78, 0], scale: [0.3, 0.3, 0.3], color: COLOR.rust }
	],
	bunk: [
		{ key: 'low', shape: 'box', position: [0, 0.45, 0], scale: [1.2, 0.12, 0.6], color: COLOR.canvas, solid: true },
		{ key: 'high', shape: 'box', position: [0, 1.25, 0], scale: [1.2, 0.12, 0.6], color: COLOR.olive },
		{ key: 'post-a', shape: 'box', position: [-0.6, 0.8, -0.25], scale: [0.06, 1.6, 0.06], color: COLOR.metalDark },
		{ key: 'post-b', shape: 'box', position: [0.6, 0.8, -0.25], scale: [0.06, 1.6, 0.06], color: COLOR.metalDark }
	],
	desk: [
		{ key: 'top', shape: 'box', position: [0, 0.75, 0], scale: [1.2, 0.06, 0.55], color: COLOR.metal, solid: true },
		{ key: 'leg-a', shape: 'box', position: [-0.55, 0.36, 0], scale: [0.06, 0.72, 0.5], color: COLOR.metalDark },
		{ key: 'leg-b', shape: 'box', position: [0.55, 0.36, 0], scale: [0.06, 0.72, 0.5], color: COLOR.metalDark },
		{ key: 'monitor', shape: 'box', position: [0, 1.12, -0.1], scale: [0.7, 0.42, 0.05], color: COLOR.black },
		{ key: 'screen', shape: 'plane', position: [0, 1.12, -0.07], scale: [0.62, 0.34, 1], color: COLOR.screen, unlit: true }
	],
	pillar: [
		{ key: 'base', shape: 'box', position: [0, 0.15, 0], scale: [0.9, 0.3, 0.9], color: COLOR.concreteDark, solid: true },
		{ key: 'shaft', shape: 'cylinder', position: [0, 1.6, 0], scale: [0.7, 3.0, 0.7], color: COLOR.concrete, solid: true },
		{ key: 'band', shape: 'box', position: [0, 0.9, 0], scale: [0.78, 0.18, 0.78], color: COLOR.hazard }
	],
	safe: [
		{ key: 'body', shape: 'box', position: [0, 0.6, 0], scale: [1.0, 1.2, 0.7], color: COLOR.metalDark, solid: true },
		{ key: 'door', shape: 'box', position: [0, 0.6, 0.36], scale: [0.86, 1.06, 0.04], color: COLOR.metal },
		{ key: 'dial', shape: 'cylinder', position: [0.2, 0.62, 0.4], scale: [0.2, 0.03, 0.2], color: COLOR.hazard, unlit: true },
		{ key: 'gold', shape: 'box', position: [-0.2, 1.24, 0], scale: [0.5, 0.1, 0.25], color: '#facc15', unlit: true }
	]
};

/** A standing figure, for the trader: it faces +z, feet on the floor. */
export const HUMAN: Part[] = [
	{ key: 'legs', shape: 'box', position: [0, 0.45, 0], scale: [0.4, 0.9, 0.28], color: COLOR.metalDark },
	{ key: 'torso', shape: 'box', position: [0, 1.2, 0], scale: [0.52, 0.7, 0.3], color: COLOR.olive },
	{ key: 'arm-a', shape: 'box', position: [-0.34, 1.15, 0], scale: [0.14, 0.62, 0.16], color: COLOR.olive },
	{ key: 'arm-b', shape: 'box', position: [0.34, 1.15, 0], scale: [0.14, 0.62, 0.16], color: COLOR.olive },
	{ key: 'head', shape: 'sphere', position: [0, 1.68, 0], scale: [0.28, 0.3, 0.28], color: '#b99a7c' },
	{ key: 'cap', shape: 'box', position: [0, 1.82, 0.02], scale: [0.3, 0.1, 0.34], color: COLOR.canvas }
];
