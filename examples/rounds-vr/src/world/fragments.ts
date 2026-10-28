// Each map is a scene fragment: a file of its blocks and its lights that the world builds when the map is in play and takes down when it is not
// (see `@kithin/engine/assets/fragment`). The world holds only one small slot per map.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSlot, type Slot } from '@kithin/engine/ecs/types';
import { parseFragment, serializeFragment, type FragmentData } from '@kithin/engine/assets/fragment';
import { contentAssetId, contentAssetIdIfPresent } from '@kithin/engine/assets/contentFolder';
import type { AssetId } from '@kithin/engine/assets/ref';
import { MAPS, type Vec3 } from './data.ts';
import { layoutOf } from './layout.ts';
import { polyHaven } from './kit.ts';
import { styleOf } from './style.ts';

/** The game's content folder, wherever the script is run from. */
export const CONTENT = fileURLToPath(new URL('../../static/content/', import.meta.url));

/** Where the fragments are written, in the content folder. */
export const mapFragmentPath = (m: number): string => `maps/map-${m}.kfrag`;

/** Whether a point is inside a block or a pillar of the map (the blocks are as deep as the arena, so only x and y count). */
function insideBlock(m: number, x: number, y: number, margin: number): boolean {
	const map = MAPS[m];
	for (const b of map.boxes) {
		const r = (b.a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), px = x - b.x, py = y - b.y;
		if (Math.abs(px * c + py * s) < b.w / 2 + margin && Math.abs(-px * s + py * c) < b.h / 2 + margin) return true;
	}
	return map.circles.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + margin);
}

/** Where a light of a map's look can stand: its own place, or the nearest free one around it (a light inside a block lights nothing). */
function clearOf(m: number, at: Vec3): Vec3 {
	let best: Vec3 | null = null, bestDistance = Infinity;
	for (let dy = -4; dy <= 8; dy += 0.5) for (let dx = -8; dx <= 8; dx += 0.5) {
		const distance = Math.hypot(dx, dy);
		if (distance < bestDistance && !insideBlock(m, at[0] + dx, at[1] + dy, 0.4)) { best = [at[0] + dx, at[1] + dy, at[2]]; bestDistance = distance; }
	}
	return best ?? at;
}

/** The slots of a map: every block laid out as the game has it (solid, and standable: its upper surface is a floor), and the lights baked into its lighting. */
export function mapFragmentSlots(m: number): Slot[] {
	const style = styleOf(m);
	const body = polyHaven(style.body.id, style.body.size, style.body.id);
	const blocks = layoutOf(m).map((p) =>
		createSlot({
			id: p.id,
			name: `${style.place} ${p.kind === 'block' ? 'Block' : 'Pillar'}`,
			position: p.position,
			rotation: p.rotation,
			scale: p.scale,
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: p.kind === 'block' ? 'box' : 'cylinder' }, color: style.body.tint }, body, { type: 'collider', shape: 'box', standable: true }]
		})
	);
	const lights = style.lights.map((light, n) => createSlot({ id: `light-${n}`, name: 'Map Light', position: clearOf(m, light.at), components: [{ type: 'pointLight', color: light.color, intensity: light.intensity, range: light.range, baked: true }] }));
	return [...blocks, ...lights];
}

/** Writes the fragment of every map to the content folder. Returns how many files changed. */
export function writeMapFragments(folder = CONTENT): number {
	let changed = 0;
	for (let m = 0; m < MAPS.length; m++) {
		const file = join(folder, mapFragmentPath(m));
		const bytes = serializeFragment(mapFragmentSlots(m), `${MAPS[m].name} (${styleOf(m).place})`);
		mkdirSync(dirname(file), { recursive: true });
		let same = false;
		try { same = Buffer.compare(readFileSync(file), bytes) === 0; } catch { /* not there yet */ }
		if (!same) { writeFileSync(file, bytes); changed++; }
	}
	return changed;
}

/** The asset id of a map's fragment: the hash of its file. */
export const mapFragmentAsset = (m: number): AssetId => contentAssetId(mapFragmentPath(m), CONTENT);

/** The fragments of every map by asset id, for the baker. */
export function loadMapFragments(): (assetId: AssetId) => FragmentData | undefined {
	const byId = new Map<AssetId, FragmentData>();
	for (let m = 0; m < MAPS.length; m++) {
		const id = contentAssetIdIfPresent(mapFragmentPath(m), CONTENT);
		if (id) byId.set(id, parseFragment(readFileSync(join(CONTENT, mapFragmentPath(m)))));
	}
	return (assetId) => byId.get(assetId);
}
