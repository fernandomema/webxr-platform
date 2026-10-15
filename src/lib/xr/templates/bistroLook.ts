import type { Component, MaterialComponent, Quat, Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import type { Vec3 } from './bistroData.ts';

/** The colours of Bistro Rush: cream plaster over bottle-green panelling, oak, brass and a red that says "eat here". */
export const COLOR = {
	plaster: '#efe6d2',
	green: '#1f4d3a',
	greenDark: '#163a2b',
	oak: '#b07a45',
	oakDark: '#7a4f2a',
	walnut: '#5a3a22',
	brass: '#c9a24b',
	red: '#b3261e',
	redSoft: '#d9534a',
	cream: '#f6efe0',
	steel: '#b9c0c7',
	steelDark: '#737b85',
	iron: '#2b2d31',
	slate: '#3b4046',
	white: '#f5f5f2',
	glassDay: '#dff1ff',
	lampWarm: '#ffd9a0',
	lampCool: '#f3f8ff',
	leaf: '#3f8f3a',
	leafLight: '#63b04f',
	terracotta: '#b5603a',
	ink: '#15171a',
	gold: '#f2c14e',
	paper: '#f3ead7'
} as const;

const texture = (id: string, map: string) => ({ kind: 'url' as const, url: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_${map}_1k.jpg` });

/** A Poly Haven (CC0) material laid on a surface by real size: `size` metres per repeat, however the slot is scaled. */
export function material(id: string, size: number, label: string): MaterialComponent {
	return { type: 'material', albedo: texture(id, 'diff'), normal: texture(id, 'nor_gl'), arm: texture(id, 'arm'), mapping: 'world', size, label };
}

/** The textured surfaces, each with the colour it is on average: what the light baker (which cannot read pictures) bounces. */
export const MATERIAL = {
	parquet: { tint: '#a8763f', component: material('herringbone_parquet', 2.4, 'Herringbone parquet') },
	planks: { tint: '#9c7a52', component: material('laminate_floor_02', 2.5, 'Laminate floor') },
	tiles: { tint: '#cfd3d2', component: material('floor_tiles_06', 2, 'Kitchen tiles') },
	plaster: { tint: '#e9e1cf', component: material('white_plaster_02', 3, 'Plaster') },
	brick: { tint: '#9a4f3a', component: material('red_brick_03', 2.2, 'Red brick') },
	paving: { tint: '#8d8c88', component: material('checkered_pavement_tiles', 2, 'Paving') },
	panelling: { tint: '#2a5a45', component: material('brown_planks_05', 1.6, 'Painted panelling') }
} as const;
export type MaterialId = keyof typeof MATERIAL;

export const yaw = (angle: number): Quat => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
const QUARTER = Math.PI / 4;
/** A cylinder turned to lie along x, or along z. */
export const ALONG_X: Quat = [0, 0, Math.sin(QUARTER), Math.cos(QUARTER)];
export const ALONG_Z: Quat = [Math.sin(QUARTER), 0, 0, Math.cos(QUARTER)];
/** A plane laid flat, read from above by somebody standing south of it. */
export const FLAT: Quat = [Math.sin(QUARTER), 0, 0, Math.cos(QUARTER)];

export interface PartOptions {
	parentId?: string | null;
	rotation?: Quat;
	unlit?: boolean;
	opacity?: number;
	/** Stops the player (unless it is part of something that can be carried). */
	solid?: boolean;
	material?: MaterialId;
	extra?: Component[];
}

/** A piece of the world: one built-in shape. Plain coloured boxes, balls and cylinders are drawn as cheap instances. */
export function part(id: string, name: string, shape: 'box' | 'sphere' | 'cylinder' | 'plane' | 'ground' | 'disc', at: Vec3, scale: Vec3, color: string, options: PartOptions = {}): Slot {
	const textured = options.material ? MATERIAL[options.material] : null;
	return createSlot({
		id,
		name,
		parentId: options.parentId ?? null,
		position: at,
		scale,
		...(options.rotation ? { rotation: options.rotation } : {}),
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: shape }, color: textured ? textured.tint : color, ...(options.unlit ? { unlit: true } : {}), ...(options.opacity === undefined ? {} : { opacity: options.opacity }) },
			...(textured ? [textured.component] : []),
			...(options.solid ? [{ type: 'collider' as const, shape: 'box' as const }] : []),
			...(options.extra ?? [])
		]
	});
}

/** A parent that only groups: it moves what is inside it and draws nothing. */
export const group = (id: string, name: string, at: Vec3, options: { parentId?: string | null; rotation?: Quat; extra?: Component[] } = {}): Slot =>
	createSlot({ id, name, parentId: options.parentId ?? null, position: at, ...(options.rotation ? { rotation: options.rotation } : {}), components: [{ type: 'container' }, ...(options.extra ?? [])] });

/** A list of pieces under one parent, given as rows of `[key, shape, at, scale, color, options?]`. */
export type Piece = [key: string, shape: 'box' | 'sphere' | 'cylinder' | 'plane', at: Vec3, scale: Vec3, color: string, options?: PartOptions];
export const pieces = (parentId: string, name: string, list: Piece[]): Slot[] => list.map(([key, shape, at, scale, color, options]) => part(`${parentId}-${key}`, `${name} ${key}`, shape, at, scale, color, { ...options, parentId }));
/** The same list as pieces of the world itself: placed where they are, under no parent. */
export const loose = (prefix: string, name: string, list: Piece[]): Slot[] => list.map(([key, shape, at, scale, color, options]) => part(`${prefix}-${key}`, `${name} ${key}`, shape, at, scale, color, options));

/**
 * A sign with text: `looks` is the way its readable face looks, as a yaw (0 looks along +z, so a sign on the north wall of a room,
 * read by somebody south of it, looks along -z: PI). The title is drawn in yellow and the lines in white, on `color`.
 */
export function sign(id: string, at: Vec3, looks: number, width: number, height: number, title: string, lines: string[], scale = 1, color: string = COLOR.ink, parentId: string | null = null): Slot {
	return createSlot({
		id,
		parentId,
		name: title || 'Sign',
		position: at,
		// A plane is read from its -z side.
		rotation: yaw(looks + Math.PI),
		scale: [width, height, 1],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color },
			{ type: 'textDisplay', title, lines, color, scale, verticalAlign: 'middle' }
		]
	});
}

/** The same sign lying on a surface, read from the south. */
export function flatSign(id: string, at: Vec3, width: number, height: number, title: string, scale = 1, color: string = COLOR.ink, parentId: string | null = null): Slot {
	return createSlot({
		id,
		parentId,
		name: title || 'Label',
		position: at,
		rotation: FLAT,
		scale: [width, height, 1],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color },
			{ type: 'textDisplay', title, lines: [], color, scale, verticalAlign: 'middle' }
		]
	});
}

// --- screens -----------------------------------------------------------------------------------------------------------------

type Element = Partial<Extract<Component, { type: 'uiElement' }>>;

export const PAGE = '#17130f';
export const MUTED = '#b5a995';
export const INK = '#f7f1e3';

/** A screen: `looks` as for `sign`. Its elements are the slots below it. */
export function screen(id: string, parentId: string, name: string, at: Vec3, looks: number, width: number, height: number, worldWidth: number, background: string = PAGE): Slot {
	return createSlot({ id, parentId, name, position: at, rotation: yaw(looks + Math.PI), components: [{ type: 'uiPanel', width, height, worldWidth, background }] });
}
export const ui = (id: string, parentId: string, kind: 'container' | 'text' | 'button', element: Element): Slot => createSlot({ id, parentId, name: id, components: [{ type: 'uiElement', kind, ...element }] });
export const text = (id: string, parent: string, value: string, width: number, height: number, fontSize: number, color: string = INK, align: 'left' | 'center' | 'right' = 'center', bold = false): Slot =>
	ui(id, parent, 'text', { text: value, width, height, fontSize, color, textAlign: align, ...(bold ? { fontWeight: 'bold' as const } : {}) });
export const button = (id: string, parent: string, label: string, width: number, height: number, background: string, fontSize = 24): Slot =>
	ui(id, parent, 'button', { text: label, width, height, fontSize, fontWeight: 'bold', textAlign: 'center', cornerRadius: 14, background, color: '#ffffff' });
export const row = (id: string, parent: string, width: number, height: number, gap = 8, extra: Element = {}): Slot => ui(id, parent, 'container', { width, height, flexDirection: 'row', gap, ...extra });
export const column = (id: string, parent: string, width: number, height: number, gap = 6, extra: Element = {}): Slot => ui(id, parent, 'container', { width, height, flexDirection: 'column', gap, ...extra });

/** A wooden frame round a screen or a board on a wall: `across` is 'x' for a wall that runs east-west. */
export function frame(id: string, at: Vec3, across: 'x' | 'z', width: number, height: number, color: string = COLOR.walnut): Slot[] {
	const t = 0.07, depth = 0.06;
	const bar = (key: string, offset: [number, number], w: number, h: number) =>
		part(`${id}-${key}`, 'Frame', 'box', across === 'x' ? [at[0] + offset[0], at[1] + offset[1], at[2]] : [at[0], at[1] + offset[1], at[2] + offset[0]], across === 'x' ? [w, h, depth] : [depth, h, w], color);
	return [bar('t', [0, height / 2 + t / 2], width + 2 * t, t), bar('b', [0, -height / 2 - t / 2], width + 2 * t, t), bar('l', [-width / 2 - t / 2, 0], t, height), bar('r', [width / 2 + t / 2, 0], t, height)];
}
