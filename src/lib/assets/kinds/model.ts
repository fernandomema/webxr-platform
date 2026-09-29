import { parseGlb, type GlbLimits } from '../glb.ts';
import { ASSET_LIMITS } from '../limits.ts';
import type { ModelManifest } from '../manifest.ts';
import type { AssetKindDef } from './types.ts';

const MAGIC = 0x46546c67; // "glTF"

const isVec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

export const modelKind: AssetKindDef<ModelManifest> = {
	type: 'model',
	label: 'Models',
	defaultName: 'Model',
	formats: [{ format: 'glb', extensions: ['.glb'], mimeType: 'model/gltf-binary' }],
	maxBytes: ASSET_LIMITS.maxBytes,
	headBytes: 12,
	sniff(head) {
		if (head.byteLength < 4) return null;
		return new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0, true) === MAGIC ? 'glb' : null;
	},
	analyze(bytes, _fileName, limits) {
		const stats = parseGlb(bytes, (limits as GlbLimits | undefined) ?? ASSET_LIMITS);
		return {
			format: 'glb',
			bounds: stats.bounds,
			triangles: stats.triangles,
			meshes: stats.meshes,
			materials: stats.materials,
			textures: stats.textures
		};
	},
	validate(m) {
		if (!m.bounds || !isVec(m.bounds.min) || !isVec(m.bounds.max)) throw new Error('Invalid model bounds');
		for (const key of ['triangles', 'meshes', 'materials', 'textures'] as const) {
			if (!Number.isInteger(m[key]) || (m[key] as number) < 0) throw new Error(`Invalid model ${key}`);
		}
		if ((m.triangles as number) > ASSET_LIMITS.maxTriangles) throw new Error('The model has too many triangles');
	},
	summary: (m) => ({ bounds: m.bounds })
};
