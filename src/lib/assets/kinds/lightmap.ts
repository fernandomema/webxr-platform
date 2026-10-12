import { MAGIC, VolumeFormatError, readHeader } from '../../lighting/format.ts';
import type { LightmapManifest } from '../manifest.ts';
import { AssetImportError, type AssetKindDef } from './types.ts';

/** A baked lighting volume (see `lighting/format.ts`): about a megabyte for a room, a few for a hall. */
export const LIGHTMAP_MAX_BYTES = 16 * 1024 * 1024;

const isVec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

export const lightmapKind: AssetKindDef<LightmapManifest> = {
	type: 'lightmap',
	label: 'Lighting',
	defaultName: 'Baked lighting',
	formats: [{ format: 'lvol', extensions: ['.lvol'], mimeType: 'application/x-lighting-volume' }],
	maxBytes: LIGHTMAP_MAX_BYTES,
	headBytes: 4,
	sniff(head) {
		if (head.byteLength < 4) return null;
		return new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0, true) === MAGIC ? 'lvol' : null;
	},
	analyze(bytes) {
		try {
			const header = readHeader(bytes);
			return { format: 'lvol', dims: header.spec.dims, voxel: header.spec.voxel, min: header.spec.min, signature: header.signature };
		} catch (error) {
			if (error instanceof VolumeFormatError) throw new AssetImportError('invalid-lighting', error.message);
			throw error;
		}
	},
	validate(m) {
		if (!Array.isArray(m.dims) || m.dims.length !== 3 || m.dims.some((n) => !Number.isInteger(n) || n < 1 || n > 2048)) throw new Error('Invalid lighting volume size');
		if (m.dims[0] * m.dims[1] * m.dims[2] > 2_800_000) throw new Error('The lighting volume has too many voxels');
		if (typeof m.voxel !== 'number' || !(m.voxel > 0) || m.voxel > 100) throw new Error('Invalid lighting voxel size');
		if (!isVec(m.min)) throw new Error('Invalid lighting volume origin');
		if (typeof m.signature !== 'string' || !/^[0-9a-f]{32}$/.test(m.signature)) throw new Error('Invalid lighting signature');
	}
};
