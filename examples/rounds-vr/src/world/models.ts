import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import type { Vec3 } from './data.ts';

/** The asset id of a model of the game: the hash of its file in `static/content/models`, written by `tools/make-models.py`. */
export function modelAsset(name: string): `sha256:${string}` {
	const file = new URL(`../../static/content/models/${name}.glb`, import.meta.url);
	if (!existsSync(file)) throw new Error(`The model ${name} has not been made: run tools/make-models.py`);
	return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

/** The box a model fills, in its own coordinates (the way the engine shows it: front toward +z), read from its file. */
export function modelBounds(name: string): { min: Vec3; max: Vec3 } {
	const bytes = readFileSync(new URL(`../../static/content/models/${name}.glb`, import.meta.url));
	const jsonLength = bytes.readUInt32LE(12);
	const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as { meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { min: Vec3; max: Vec3 }[] };
	const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
		const accessor = gltf.accessors[primitive.attributes.POSITION];
		for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], accessor.min[i]); max[i] = Math.max(max[i], accessor.max[i]); }
	}
	// The file is written mirrored in z; the engine undoes that when it loads it.
	return { min: [min[0], min[1], -max[2]], max: [max[0], max[1], -min[2]] };
}

export interface ModelOptions {
	parentId?: string;
	rotation?: [number, number, number, number];
	/** How big, as a multiple of the model as it was made (1 by default). */
	scale?: number;
	/** A box collider on it: a solid thing, or the shape a grab hits. */
	solid?: boolean;
	disabled?: boolean;
}

const rotateVec = (q: [number, number, number, number], v: Vec3): Vec3 => {
	const [x, y, z, w] = q;
	const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
	return [v[0] + 2 * (w * cx + y * cz - z * cy), v[1] + 2 * (w * cy + z * cx - x * cz), v[2] + 2 * (w * cz + x * cy - y * cx)];
};

/**
 * A slot that shows one of the models, where `origin` is the origin the model was made around. The engine shows a model scaled so that
 * its largest side is 1 and centred on the slot, so the slot is scaled back by that side and moved by the model's centre.
 */
export function model(id: string, name: string, asset: string, origin: Vec3, options: ModelOptions = {}): Slot {
	const { min, max } = modelBounds(asset);
	const largest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
	const user = options.scale ?? 1;
	const rotation = options.rotation ?? [0, 0, 0, 1];
	const centre: Vec3 = [(min[0] + max[0]) / 2 * user, (min[1] + max[1]) / 2 * user, (min[2] + max[2]) / 2 * user];
	const offset = rotateVec(rotation, centre);
	const slot = createSlot({
		id,
		name,
		parentId: options.parentId ?? null,
		position: [origin[0] + offset[0], origin[1] + offset[1], origin[2] + offset[2]],
		scale: [largest * user, largest * user, largest * user],
		rotation,
		components: [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: modelAsset(asset) } }, ...(options.solid ? [{ type: 'collider' as const, shape: 'box' as const }] : [])]
	});
	return options.disabled ? { ...slot, disabled: true } : slot;
}
