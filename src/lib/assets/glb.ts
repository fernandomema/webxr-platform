import type { Vec3 } from '../ecs/types';
import { AssetImportError } from './kinds/types.ts';
import { ASSET_LIMITS } from './limits.ts';

/**
 * Reads a binary glTF just far enough to decide whether it is safe and cheap
 * enough to use, and to learn its bounds. It never decodes textures or
 * geometry, and it has no Babylon dependency, so it runs (and is tested) in Node.
 */
export type GlbErrorCode =
	| 'too-large' | 'not-glb' | 'version' | 'length' | 'json' | 'extension' | 'external-uri'
	| 'empty' | 'bounds' | 'too-many-triangles' | 'too-many-images';

export class GlbError extends AssetImportError {
	declare readonly code: GlbErrorCode;
	constructor(code: GlbErrorCode, message: string) {
		super(code, message);
		this.name = 'GlbError';
	}
}

export interface GlbStats {
	bounds: { min: Vec3; max: Vec3 };
	triangles: number;
	meshes: number;
	materials: number;
	textures: number;
	images: number;
	/** Joint (bone) names of the model's skins, deduplicated. Absent when the model has no skin. */
	skeleton?: { joints: string[] };
}

export interface GlbLimits {
	maxBytes: number;
	maxTriangles: number;
	maxImages: number;
}

/**
 * These load their decoders from a CDN by default, and a headset on a LAN
 * cannot reach one (the same trap as the controller profiles), so a model that
 * needs them would silently never appear. Rejected up front with a clear message.
 * KHR_draco_mesh_compression is not here: its decoder is served from /static/draco.
 */
const NEEDS_EXTERNAL_DECODER = ['EXT_meshopt_compression', 'KHR_texture_basisu'];

/** Required extensions that only change how already-loaded data is interpreted. */
const SUPPORTED_REQUIRED = new Set([
	'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_materials_pbrSpecularGlossiness', 'KHR_texture_transform',
	'KHR_lights_punctual', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_specular',
	'KHR_materials_sheen', 'KHR_materials_volume', 'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion',
	'KHR_materials_variants', 'KHR_mesh_quantization', 'KHR_draco_mesh_compression', 'EXT_texture_webp', 'EXT_mesh_gpu_instancing', 'KHR_materials_diffuse_transmission'
]);

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const MAX_NODE_DEPTH = 64;

interface Gltf {
	asset?: { version?: string };
	extensionsUsed?: string[];
	extensionsRequired?: string[];
	scene?: number;
	scenes?: { nodes?: number[] }[];
	nodes?: { name?: string; children?: number[]; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
	skins?: { joints?: number[] }[];
	meshes?: { primitives?: { attributes?: Record<string, number>; indices?: number; mode?: number }[] }[];
	accessors?: { count?: number; min?: number[]; max?: number[] }[];
	materials?: unknown[];
	textures?: unknown[];
	images?: { uri?: string }[];
	buffers?: { uri?: string; byteLength?: number }[];
}

export function parseGlb(bytes: Uint8Array, limits: GlbLimits = ASSET_LIMITS): GlbStats {
	if (bytes.byteLength > limits.maxBytes) {
		throw new GlbError('too-large', `The model is ${(bytes.byteLength / 1048576).toFixed(1)} MB; the limit is ${(limits.maxBytes / 1048576).toFixed(0)} MB.`);
	}
	if (bytes.byteLength < 20) throw new GlbError('not-glb', 'This is not a .glb file.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== MAGIC) throw new GlbError('not-glb', 'This is not a .glb file.');
	if (view.getUint32(4, true) !== 2) throw new GlbError('version', 'Only glTF 2.0 binaries are supported.');
	if (view.getUint32(8, true) !== bytes.byteLength) throw new GlbError('length', 'The file is truncated or has extra data.');

	// Chunks: the first must be JSON; a BIN chunk may follow.
	let json: Gltf | undefined;
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const length = view.getUint32(offset, true);
		const type = view.getUint32(offset + 4, true);
		const start = offset + 8;
		if (start + length > bytes.byteLength) throw new GlbError('length', 'A chunk runs past the end of the file.');
		if (type === CHUNK_JSON && !json) {
			try {
				json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length))) as Gltf;
			} catch {
				throw new GlbError('json', 'The model description is not valid JSON.');
			}
		}
		offset = start + ((length + 3) & ~3);
	}
	if (!json || typeof json !== 'object') throw new GlbError('json', 'The model has no description chunk.');
	if (json.asset?.version && json.asset.version !== '2.0') throw new GlbError('version', 'Only glTF 2.0 binaries are supported.');

	const used = json.extensionsUsed ?? [];
	const required = json.extensionsRequired ?? [];
	const forbidden = [...used, ...required].find((name) => NEEDS_EXTERNAL_DECODER.includes(name));
	if (forbidden) {
		throw new GlbError('extension', `This model uses ${forbidden}, which needs a decoder downloaded from the internet. Re-export it without compression.`);
	}
	const unsupported = required.find((name) => !SUPPORTED_REQUIRED.has(name));
	if (unsupported) throw new GlbError('extension', `This model requires ${unsupported}, which is not supported.`);

	for (const entry of [...(json.buffers ?? []), ...(json.images ?? [])]) {
		if (entry.uri !== undefined && !entry.uri.startsWith('data:')) {
			throw new GlbError('external-uri', 'The model refers to external files. Export it as a single self-contained .glb.');
		}
	}

	const images = json.images?.length ?? 0;
	if (images > limits.maxImages) throw new GlbError('too-many-images', `The model has ${images} images; the limit is ${limits.maxImages}.`);

	const { bounds, triangles } = measure(json, limits);
	const joints = jointNames(json);
	return {
		bounds,
		triangles,
		meshes: json.meshes?.length ?? 0,
		materials: json.materials?.length ?? 0,
		textures: json.textures?.length ?? 0,
		images,
		...(joints.length ? { skeleton: { joints } } : {})
	};
}

const MAX_JOINTS = 512;

function jointNames(json: Gltf): string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	for (const skin of json.skins ?? []) {
		for (const index of skin.joints ?? []) {
			const name = json.nodes?.[index]?.name;
			if (typeof name !== 'string' || !name || seen.has(name)) continue;
			seen.add(name);
			names.push(name.slice(0, 128));
			if (names.length >= MAX_JOINTS) return names;
		}
	}
	return names;
}

// --- geometry measurement ---------------------------------------------------

type Mat4 = number[]; // column-major, like glTF

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
	const out = new Array<number>(16).fill(0);
	for (let column = 0; column < 4; column++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
			out[column * 4 + row] = sum;
		}
	}
	return out;
}

function nodeMatrix(node: NonNullable<Gltf['nodes']>[number]): Mat4 {
	if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
	const [tx, ty, tz] = node.translation ?? [0, 0, 0];
	const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale ?? [1, 1, 1];
	const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
	return [
		(1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
		2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
		2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
		tx, ty, tz, 1
	];
}

function measure(json: Gltf, limits: GlbLimits): { bounds: GlbStats['bounds']; triangles: number } {
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	let triangles = 0;

	const visitMesh = (meshIndex: number, world: Mat4) => {
		for (const primitive of json.meshes?.[meshIndex]?.primitives ?? []) {
			const position = json.accessors?.[primitive.attributes?.POSITION ?? -1];
			if (!position) continue;
			if (!position.min || !position.max || position.min.length < 3 || position.max.length < 3) {
				throw new GlbError('bounds', 'A mesh has no position bounds, so its size cannot be measured.');
			}
			const count = primitive.indices !== undefined ? (json.accessors?.[primitive.indices]?.count ?? 0) : (position.count ?? 0);
			const mode = primitive.mode ?? 4;
			triangles += mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
			if (triangles > limits.maxTriangles) throw new GlbError('too-many-triangles', `The model has more than ${limits.maxTriangles.toLocaleString('en-US')} triangles.`);
			for (let corner = 0; corner < 8; corner++) {
				const x = corner & 1 ? position.max[0] : position.min[0];
				const y = corner & 2 ? position.max[1] : position.min[1];
				const z = corner & 4 ? position.max[2] : position.min[2];
				const wx = world[0] * x + world[4] * y + world[8] * z + world[12];
				const wy = world[1] * x + world[5] * y + world[9] * z + world[13];
				const wz = world[2] * x + world[6] * y + world[10] * z + world[14];
				min[0] = Math.min(min[0], wx); min[1] = Math.min(min[1], wy); min[2] = Math.min(min[2], wz);
				max[0] = Math.max(max[0], wx); max[1] = Math.max(max[1], wy); max[2] = Math.max(max[2], wz);
			}
		}
	};

	const visitNode = (index: number, parent: Mat4, depth: number, path: Set<number>) => {
		const node = json.nodes?.[index];
		if (!node || depth > MAX_NODE_DEPTH || path.has(index)) return;
		const world = multiply(parent, nodeMatrix(node));
		if (node.mesh !== undefined) visitMesh(node.mesh, world);
		path.add(index);
		for (const child of node.children ?? []) visitNode(child, world, depth + 1, path);
		path.delete(index);
	};

	const sceneNodes = json.scenes?.[json.scene ?? 0]?.nodes;
	if (sceneNodes) for (const index of sceneNodes) visitNode(index, IDENTITY, 0, new Set());
	else (json.meshes ?? []).forEach((_, meshIndex) => visitMesh(meshIndex, IDENTITY));

	const finite = [...min, ...max].every(Number.isFinite);
	if (!finite || triangles === 0) throw new GlbError('empty', 'The model has no geometry.');
	return { bounds: { min, max }, triangles };
}
