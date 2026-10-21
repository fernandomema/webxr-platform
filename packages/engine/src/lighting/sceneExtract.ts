import type { Component, Slot, SlotTree } from '../ecs/types.ts';
import { compose, invert, multiply, transformDirection, transformPoint } from './matrix.ts';
import { worldBounds } from './primitives.ts';
import type { BakeLight, BakePrimitive, BakeScene, BakeSky, Mat4, PrimitiveShape, V3 } from './types.ts';

export interface ExtractOptions {
	/** Only surfaces that can touch this box (plus `margin`) are kept. */
	region?: { min: V3; max: V3 };
	/** How far beyond the region a surface may be and still matter (24 m: the baker's gathering distance). */
	margin?: number;
	/** The light the sky sends into the world (0 by default: a bunker has no sky). */
	skyIntensity?: number;
	/** What textured surfaces reflect, as a fraction of their tint: the baker cannot read the pictures (0.6). */
	texturedAlbedo?: number;
	/** A further factor on every surface's reflectance as the baker sees it, so that a world of pale colours can still bounce like concrete (1). */
	albedoScale?: number;
	/** Take every light, not only those marked `baked`. */
	allLights?: boolean;
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` as 0 to 1 channels (white for anything else). */
export function parseColor(hex: string | undefined): V3 {
	if (typeof hex !== 'string') return [1, 1, 1];
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
	if (!m) return [1, 1, 1];
	let h = m[1];
	if (h.length === 3) h = h.split('').map((c) => c + c).join('');
	return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

const find = <T extends Component['type']>(slot: Slot, type: T): Extract<Component, { type: T }> | undefined =>
	slot.components.find((c) => c.type === type) as Extract<Component, { type: T }> | undefined;

const SHAPES: readonly string[] = ['box', 'sphere', 'plane', 'ground', 'cylinder', 'disc'];

/**
 * What the renderer draws, as the baker needs it: the world matrix of every slot, the shape and colour of what blocks light,
 * the lights marked as baked, and the sky. A slot that is switched off takes its whole subtree with it.
 */
export function extractScene(tree: SlotTree, options: ExtractOptions = {}): BakeScene {
	const byId = new Map(tree.map((slot) => [slot.id, slot]));
	const worlds = new Map<string, Mat4 | null>();
	const world = (slot: Slot): Mat4 | null => {
		if (worlds.has(slot.id)) return worlds.get(slot.id) ?? null;
		worlds.set(slot.id, null); // a loop of parents ends here
		const parent = slot.parentId ? byId.get(slot.parentId) : undefined;
		const parentWorld = parent ? world(parent) : null;
		if (parent && !parentWorld) return null;
		if (slot.disabled) return null;
		const local = compose(slot.position, slot.rotation, slot.scale);
		const result = parentWorld ? multiply(local, parentWorld) : local;
		worlds.set(slot.id, result);
		return result;
	};

	const margin = options.margin ?? 24;
	const region = options.region;
	const inRegion = (min: V3, max: V3): boolean => !region || (min[0] < region.max[0] + margin && max[0] > region.min[0] - margin && min[1] < region.max[1] + margin && max[1] > region.min[1] - margin && min[2] < region.max[2] + margin && max[2] > region.min[2] - margin);

	const primitives: BakePrimitive[] = [];
	const lights: BakeLight[] = [];
	let sky: BakeSky = { top: [0, 0, 0], horizon: [0, 0, 0], bottom: [0, 0, 0], intensity: 0 };

	for (const slot of tree) {
		const m = world(slot);
		if (!m) continue;
		if (find(slot, 'avatar')) continue;
		const skybox = find(slot, 'skybox');
		if (skybox) sky = { top: parseColor(skybox.topColor), horizon: parseColor(skybox.horizonColor), bottom: parseColor(skybox.bottomColor), intensity: options.skyIntensity ?? 0 };

		const light = find(slot, 'pointLight');
		if (light && (options.allLights || light.baked)) {
			lights.push({ kind: 'point', position: transformPoint(m, [0, 0, 0]), direction: [0, -1, 0], color: parseColor(light.color).map((c) => c * Math.max(0, light.intensity)) as V3, range: Math.max(0.1, light.range), cosHalfAngle: -1, exponent: 0 });
		}

		const spot = find(slot, 'spotLight');
		if (spot && (options.allLights || spot.baked)) {
			const dir = transformDirection(m, [0, 0, 1]);
			const length = Math.hypot(dir[0], dir[1], dir[2]) || 1;
			lights.push({
				kind: 'spot',
				position: transformPoint(m, [0, 0, 0]),
				direction: [dir[0] / length, dir[1] / length, dir[2] / length],
				color: parseColor(spot.color).map((c) => c * Math.max(0, spot.intensity)) as V3,
				range: Math.max(0.1, spot.range),
				// Babylon's `angle` is the whole opening of the cone.
				cosHalfAngle: Math.cos((Math.max(1, Math.min(179, spot.angle)) * Math.PI) / 360),
				exponent: spot.exponent ?? 2
			});
		}

		const mesh = find(slot, 'meshRenderer');
		const panel = find(slot, 'uiPanel');
		let shape: PrimitiveShape | null = null, shapeMatrix = m;
		if (mesh) {
			if (mesh.meshRef.kind === 'builtin') shape = (SHAPES.includes(mesh.meshRef.id) ? mesh.meshRef.id : 'box') as PrimitiveShape;
			else shape = 'box'; // a model: a box the size of its slot (the real size comes from the file, which the baker cannot read)
		} else if (panel) {
			// A panel with no mesh of its own is a plane of its own size.
			shape = 'plane';
			const height = (panel.worldWidth ?? 1.2) * (panel.height / Math.max(1, panel.width));
			shapeMatrix = multiply(compose([0, 0, 0], [0, 0, 0, 1], [panel.worldWidth ?? 1.2, height, 1]), m);
		}
		if (!shape) continue;
		const opacity = mesh?.opacity ?? 1;
		if (opacity < 0.05) continue;
		const inverse = invert(shapeMatrix);
		if (!inverse) continue;
		const bounds = worldBounds(shape, shapeMatrix);
		if (!inRegion(bounds.min, bounds.max)) continue;
		const tint = parseColor(mesh?.color);
		const textured = !!find(slot, 'material');
		const scale = (textured ? options.texturedAlbedo ?? 0.6 : 1) * (options.albedoScale ?? 1);
		primitives.push({
			id: slot.id,
			shape,
			world: shapeMatrix,
			inverse,
			albedo: panel && !mesh ? [0.05, 0.05, 0.06] : [tint[0] * scale, tint[1] * scale, tint[2] * scale],
			emissive: null,
			opaque: opacity >= 0.5,
			...bounds
		});
	}
	// A light that cannot reach the region has nothing to do there.
	const reaches = (l: BakeLight): boolean => !region || (l.position[0] + l.range > region.min[0] && l.position[0] - l.range < region.max[0] && l.position[1] + l.range > region.min[1] && l.position[1] - l.range < region.max[1] && l.position[2] + l.range > region.min[2] && l.position[2] - l.range < region.max[2]);
	return { primitives, lights: lights.filter(reaches), sky };
}

/** A fingerprint of what a volume depends on: the surfaces within reach, the lights, the sky and the grid. Changing any of them changes it. */
export function sceneSignature(scene: BakeScene, grid: { min: V3; voxel: number; dims: [number, number, number] }, reachFrom: { min: V3; max: V3 }, margin = 24): string {
	const r = (n: number) => Math.round(n * 1000) / 1000;
	const parts: string[] = [JSON.stringify([grid.min.map(r), r(grid.voxel), grid.dims])];
	for (const p of scene.primitives) {
		if (!p.opaque) continue;
		if (p.min[0] > reachFrom.max[0] + margin || p.max[0] < reachFrom.min[0] - margin || p.min[1] > reachFrom.max[1] + margin || p.max[1] < reachFrom.min[1] - margin || p.min[2] > reachFrom.max[2] + margin || p.max[2] < reachFrom.min[2] - margin) continue;
		parts.push(`${p.shape}|${Array.from(p.world, r).join(',')}|${p.albedo.map(r).join(',')}`);
	}
	for (const l of scene.lights) parts.push(`${l.kind}|${l.position.map(r)}|${l.color.map(r)}|${r(l.range)}|${l.direction.map(r)}|${r(l.cosHalfAngle)}|${r(l.exponent)}`);
	parts.push(JSON.stringify([scene.sky.top.map(r), scene.sky.horizon.map(r), scene.sky.bottom.map(r), r(scene.sky.intensity)]));
	parts.sort();
	return fingerprint(parts.join('\n'));
}

/** 128 bits of FNV-1a, as 32 hex digits. */
export function fingerprint(text: string): string {
	const out: string[] = [];
	for (const seed of [0xcbf29ce484222325n, 0x84222325cbf29ce4n]) {
		let h = seed;
		for (let i = 0; i < text.length; i++) { h ^= BigInt(text.charCodeAt(i)); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
		out.push(h.toString(16).padStart(16, '0'));
	}
	return out.join('');
}
