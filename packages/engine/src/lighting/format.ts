import type { BakedVolume, VolumeSpec } from './types.ts';
import { slotIndex, voxelCount } from './types.ts';

/**
 * The file a bake is kept in. A 64-byte header, then the payload: for every voxel and each of the six faces an RGBA texel
 * (R, G, B = the colour as `sqrt(value / range)` in a byte, A = 255), in the order a 3D texture of size
 * `nx x ny x (nz * 6)` wants it (x runs fastest, then y, then z, then the face), optionally deflated.
 */
export const MAGIC = 0x4c564f4c; // 'LVOL' read as a little-endian number
export const FORMAT_VERSION = 1;
export const HEADER_BYTES = 64;
/** The most voxels a file may hold: a bound on what a remote world can make a device allocate (about 64 MB of texture). */
export const MAX_VOXELS = 2_800_000;

/** A way to deflate and inflate (raw deflate): Node's zlib in scripts and tests, the browser's streams in the app. */
export interface Codec {
	compress(bytes: Uint8Array): Uint8Array;
	decompress(bytes: Uint8Array): Uint8Array;
}

export interface VolumeHeader {
	version: number;
	deflated: boolean;
	spec: VolumeSpec;
	/** What a byte of 255 stands for. */
	range: number;
	/** A fingerprint (32 hex digits) of the scene the volume was baked from. */
	signature: string;
	payloadBytes: number;
	rawBytes: number;
}

export class VolumeFormatError extends Error {}

const hexToBytes = (hex: string): Uint8Array => Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2) || '00', 16));
const bytesToHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** The range that suits a volume: the brightest value it holds, kept within bounds. */
export function rangeFor(data: Float32Array): number {
	let max = 0;
	for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
	return Math.min(16, Math.max(0.25, max));
}

/** The texels of a volume as bytes, in the order of the 3D texture. */
export function toTexels(volume: BakedVolume, range: number): Uint8Array {
	const { spec, data } = volume;
	const texels = voxelCount(spec) * 6;
	const out = new Uint8Array(texels * 4);
	for (let t = 0; t < texels; t++) {
		for (let c = 0; c < 3; c++) {
			const v = Math.max(0, Math.min(1, data[t * 3 + c] / range));
			out[t * 4 + c] = Math.round(255 * Math.sqrt(v));
		}
		out[t * 4 + 3] = 255;
	}
	return out;
}

/** Back from texels to values, for tests and tools. */
export function fromTexels(texels: Uint8Array, spec: VolumeSpec, range: number): BakedVolume {
	const count = voxelCount(spec) * 6;
	const data = new Float32Array(count * 3);
	for (let t = 0; t < count; t++) for (let c = 0; c < 3; c++) { const b = texels[t * 4 + c] / 255; data[t * 3 + c] = b * b * range; }
	return { spec, data };
}

function pack(volume: BakedVolume, signature: string, range: number, payload: Uint8Array, rawLength: number, deflated: boolean): Uint8Array {
	const { spec } = volume;
	const out = new Uint8Array(HEADER_BYTES + payload.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, MAGIC, true);
	view.setUint8(4, FORMAT_VERSION);
	view.setUint8(5, deflated ? 1 : 0);
	for (let k = 0; k < 3; k++) view.setUint32(8 + k * 4, spec.dims[k], true);
	for (let k = 0; k < 3; k++) view.setFloat32(20 + k * 4, spec.min[k], true);
	view.setFloat32(32, spec.voxel, true);
	view.setFloat32(36, range, true);
	out.set(hexToBytes(signature), 40);
	view.setUint32(56, payload.length, true);
	view.setUint32(60, rawLength, true);
	out.set(payload, HEADER_BYTES);
	return out;
}

function checkSize(volume: BakedVolume): void {
	if (voxelCount(volume.spec) > MAX_VOXELS) throw new VolumeFormatError(`A volume of ${voxelCount(volume.spec)} voxels is too big (the most is ${MAX_VOXELS})`);
}

export function encode(volume: BakedVolume, signature: string, codec?: Codec): Uint8Array {
	checkSize(volume);
	const range = rangeFor(volume.data);
	const raw = toTexels(volume, range);
	return pack(volume, signature, range, codec ? codec.compress(raw) : raw, raw.length, Boolean(codec));
}

/** The same in the browser, where deflating is asynchronous. */
export async function encodeAsync(volume: BakedVolume, signature: string): Promise<Uint8Array> {
	checkSize(volume);
	const range = rangeFor(volume.data);
	const raw = toTexels(volume, range);
	const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
	return pack(volume, signature, range, new Uint8Array(await new Response(stream).arrayBuffer()), raw.length, true);
}

/** Reads and checks the header; throws `VolumeFormatError` for anything that is not a volume this code can use. */
export function readHeader(bytes: Uint8Array): VolumeHeader {
	if (bytes.length < HEADER_BYTES) throw new VolumeFormatError('Too short to be a lighting volume');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== MAGIC) throw new VolumeFormatError('Not a lighting volume');
	const version = view.getUint8(4);
	if (version !== FORMAT_VERSION) throw new VolumeFormatError(`Lighting volume version ${version} is not supported`);
	const dims: [number, number, number] = [view.getUint32(8, true), view.getUint32(12, true), view.getUint32(16, true)];
	const min: [number, number, number] = [view.getFloat32(20, true), view.getFloat32(24, true), view.getFloat32(28, true)];
	const voxel = view.getFloat32(32, true), range = view.getFloat32(36, true);
	if (dims.some((n) => n < 1 || n > 2048) || !(voxel > 0) || !(range > 0) || !min.every(Number.isFinite)) throw new VolumeFormatError('The lighting volume header is not valid');
	if (dims[0] * dims[1] * dims[2] > MAX_VOXELS) throw new VolumeFormatError('The lighting volume is too big');
	const payloadBytes = view.getUint32(56, true), rawBytes = view.getUint32(60, true);
	if (rawBytes !== dims[0] * dims[1] * dims[2] * 6 * 4 || HEADER_BYTES + payloadBytes !== bytes.length) throw new VolumeFormatError('The lighting volume has the wrong length');
	return { version, deflated: view.getUint8(5) === 1, spec: { min, voxel, dims }, range, signature: bytesToHex(bytes.subarray(40, 56)), payloadBytes, rawBytes };
}

/** The texels of a file, inflated if need be (synchronously: Node). */
export function decodeTexels(bytes: Uint8Array, codec?: Codec): { header: VolumeHeader; texels: Uint8Array } {
	const header = readHeader(bytes);
	const payload = bytes.subarray(HEADER_BYTES);
	let texels = payload;
	if (header.deflated) {
		if (!codec) throw new VolumeFormatError('A deflated lighting volume needs a codec');
		texels = codec.decompress(payload);
	}
	if (texels.length !== header.rawBytes) throw new VolumeFormatError('The lighting volume payload has the wrong size');
	return { header, texels };
}

/** The same in the browser, where inflating is asynchronous. */
export async function decodeTexelsAsync(bytes: Uint8Array): Promise<{ header: VolumeHeader; texels: Uint8Array }> {
	const header = readHeader(bytes);
	const payload = bytes.subarray(HEADER_BYTES);
	let texels = payload;
	if (header.deflated) {
		const stream = new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
		texels = new Uint8Array(await new Response(stream).arrayBuffer());
	}
	if (texels.length !== header.rawBytes) throw new VolumeFormatError('The lighting volume payload has the wrong size');
	return { header, texels };
}

export function decode(bytes: Uint8Array, codec?: Codec): { header: VolumeHeader; volume: BakedVolume } {
	const { header, texels } = decodeTexels(bytes, codec);
	return { header, volume: fromTexels(texels, header.spec, header.range) };
}

export { slotIndex };
