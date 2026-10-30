import type { AssetId } from '@kithin/engine/assets/ref';
import type { Component, Quat, Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';

export type Vec3 = [number, number, number];

/** `createSlot` that keeps `disabled` (it leaves it out): a slot that starts switched off. */
export const makeSlot = (partial: Parameters<typeof createSlot>[0]): Slot => ({ ...createSlot(partial), ...(partial.disabled ? { disabled: true } : {}) });

/** A turn of `angle` radians about the unit axis, as a quaternion (the engine's own convention: yaw +90 turns +Z into +X). */
export function quatAxis(axis: Vec3, angle: number): Quat {
	const s = Math.sin(angle / 2);
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
export const yaw = (angle: number): Quat => quatAxis([0, 1, 0], angle);
export const pitch = (angle: number): Quat => quatAxis([1, 0, 0], angle);
export const roll = (angle: number): Quat => quatAxis([0, 0, 1], angle);
/** The turn that takes +Y to the unit direction `d` (to stand something on a sphere with its axis along the way out). */
export function alignY(d: Vec3): Quat {
	const length = Math.hypot(...d);
	const n = d.map((c) => c / length) as Vec3;
	// Axis: up x n = (n.z, 0, -n.x); angle: acos(n.y).
	const sin = Math.hypot(n[2], n[0]);
	if (sin < 1e-9) return n[1] > 0 ? [0, 0, 0, 1] : [1, 0, 0, 0];
	return quatAxis([n[2] / sin, 0, -n[0] / sin], Math.acos(Math.min(1, Math.max(-1, n[1]))));
}
export const quatMul = (a: Quat, b: Quat): Quat => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];

type Extra = Partial<Pick<Slot, 'parentId' | 'rotation' | 'disabled'>> & { components?: Component[] };

/** What a surface is made of: texture maps from the pack, laid by real size. */
export interface Surface {
	albedo: AssetId;
	normal?: AssetId;
	arm?: AssetId;
	/** Metres one repeat of the maps covers. */
	size: number;
	roughness?: number;
	metallic?: number;
}

const material = (surface: Surface): Component => ({
	type: 'material',
	albedo: { kind: 'asset', assetId: surface.albedo },
	...(surface.normal ? { normal: { kind: 'asset' as const, assetId: surface.normal } } : {}),
	...(surface.arm ? { arm: { kind: 'asset' as const, assetId: surface.arm } } : {}),
	mapping: 'world',
	size: surface.size,
	...(surface.roughness === undefined ? {} : { roughness: surface.roughness }),
	...(surface.metallic === undefined ? {} : { metallic: surface.metallic })
});

export interface BoxOptions extends Extra {
	/** A box players cannot walk through (and can stand on). */
	solid?: boolean;
	opacity?: number;
	/** Drawn at its own colour whatever the light (neon, screens, bulbs). */
	unlit?: boolean;
	surface?: Surface;
}

/** A box of the given size (metres) centred at `position`. */
export function box(id: string, name: string, position: Vec3, size: Vec3, color: string, options: BoxOptions = {}): Slot {
	const { solid, opacity, unlit, surface, components = [], ...rest } = options;
	return makeSlot({
		id,
		name,
		position,
		scale: size,
		...rest,
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color, ...(opacity === undefined ? {} : { opacity }), ...(unlit ? { unlit: true } : {}) },
			...(surface ? [material(surface)] : []),
			...(solid ? [{ type: 'collider' as const, shape: 'box' as const }] : []),
			...components
		]
	});
}

/** A cylinder standing on its axis: `diameter` across, `height` tall, centred at `position`. */
export function cylinder(id: string, name: string, position: Vec3, diameter: number, height: number, color: string, options: BoxOptions = {}): Slot {
	const { solid, opacity, unlit, surface, components = [], ...rest } = options;
	return makeSlot({
		id,
		name,
		position,
		scale: [diameter, height, diameter],
		...rest,
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color, ...(opacity === undefined ? {} : { opacity }), ...(unlit ? { unlit: true } : {}) },
			...(surface ? [material(surface)] : []),
			...(solid ? [{ type: 'collider' as const, shape: 'box' as const }] : []),
			...components
		]
	});
}

export function sphere(id: string, name: string, position: Vec3, diameter: number, color: string, options: BoxOptions = {}): Slot {
	const { opacity, unlit, components = [], ...rest } = options;
	return makeSlot({
		id,
		name,
		position,
		scale: [diameter, diameter, diameter],
		...rest,
		components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color, ...(opacity === undefined ? {} : { opacity }), ...(unlit ? { unlit: true } : {}) }, ...components]
	});
}

/** An empty slot that only groups what is under it. */
export const group = (id: string, name: string, position: Vec3, options: Extra = {}): Slot =>
	makeSlot({ id, name, position, ...options, components: [{ type: 'container' }, ...(options.components ?? [])] });

/** A sign: a plane showing text. Face it so that its +Z points away from whoever reads it (see the rotation helpers). */
export function sign(id: string, name: string, position: Vec3, size: [number, number], text: Partial<Extract<Component, { type: 'textDisplay' }>>, options: Extra = {}): Slot {
	return makeSlot({
		id,
		name,
		position,
		scale: [size[0], size[1], 1],
		...options,
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#05060b' },
			{ type: 'textDisplay', lines: [], ...text },
			...(options.components ?? [])
		]
	});
}

export const pointLight = (id: string, name: string, position: Vec3, color: string, intensity: number, range: number, baked = false): Slot =>
	makeSlot({ id, name, position, components: [{ type: 'pointLight', color, intensity, range, ...(baked ? { baked: true } : {}) }] });

export const spotLight = (id: string, name: string, position: Vec3, rotation: Quat, color: string, intensity: number, range: number, angle: number, baked = false): Slot =>
	makeSlot({ id, name, position, rotation, components: [{ type: 'spotLight', color, intensity, range, angle, exponent: 2, ...(baked ? { baked: true } : {}) }] });

type UiElement = Partial<Extract<Component, { type: 'uiElement' }>>;

/** A UI element slot under a panel (or another element): `kind` and the look in `element`. */
export const ui = (id: string, parentId: string, kind: 'container' | 'text' | 'button' | 'image', element: UiElement): Slot =>
	makeSlot({ id, parentId, name: id, components: [{ type: 'uiElement', kind, ...element }] });
