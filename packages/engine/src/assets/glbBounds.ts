import type { Vec3 } from '../ecs/types.ts';

/** The box a model fills, in the file's own units and axes (or, with `babylon`, as the engine shows it: the loader mirrors z). */
export interface GlbBounds {
	min: Vec3;
	max: Vec3;
	/** `max - min`. */
	size: Vec3;
	/** The middle of the box. */
	center: Vec3;
}

interface Gltf {
	scene?: number;
	scenes?: { nodes?: number[] }[];
	nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
	meshes?: { primitives: { attributes: { POSITION?: number } }[] }[];
	accessors?: { min?: number[]; max?: number[] }[];
}

type Mat = number[]; // 4x4, column-major, like glTF
const identity = (): Mat => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const multiply = (a: Mat, b: Mat): Mat => {
	const out = new Array<number>(16).fill(0);
	for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
	return out;
};
const local = (node: NonNullable<Gltf['nodes']>[number]): Mat => {
	if (node.matrix?.length === 16) return node.matrix;
	const [tx, ty, tz] = node.translation ?? [0, 0, 0];
	const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale ?? [1, 1, 1];
	const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
	const xx = qx * x2, xy = qx * y2, xz = qx * z2, yy = qy * y2, yz = qy * z2, zz = qz * z2, wx = qw * x2, wy = qw * y2, wz = qw * z2;
	return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0, (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, tx, ty, tz, 1];
};

/**
 * Reads the box a glTF binary (.glb) fills from its own header, without decoding any geometry: the position accessors' `min`/`max` of
 * every mesh, carried through the node transforms. For tools and world builders that must size or place a model before the engine has
 * loaded it (the engine shows a model with its largest side 1 unless the slot asks for `modelScale: 'native'`).
 * `babylon` (the default) gives the box as the engine shows it, with z mirrored as its loader does.
 */
export function readGlbBounds(bytes: Uint8Array, options: { babylon?: boolean } = {}): GlbBounds | null {
	if (bytes.length < 20) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) return null; // 'glTF' and a 'JSON' first chunk
	const jsonLength = view.getUint32(12, true);
	let gltf: Gltf;
	try {
		gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf;
	} catch {
		return null;
	}
	const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
	const visit = (index: number, parent: Mat, depth: number): void => {
		const node = gltf.nodes?.[index];
		if (!node || depth > 64) return;
		const world = multiply(parent, local(node));
		const mesh = node.mesh === undefined ? undefined : gltf.meshes?.[node.mesh];
		for (const primitive of mesh?.primitives ?? []) {
			const accessor = primitive.attributes.POSITION === undefined ? undefined : gltf.accessors?.[primitive.attributes.POSITION];
			if (!accessor?.min || !accessor.max) continue;
			for (let corner = 0; corner < 8; corner++) {
				const p = [corner & 1 ? accessor.max[0] : accessor.min[0], corner & 2 ? accessor.max[1] : accessor.min[1], corner & 4 ? accessor.max[2] : accessor.min[2]];
				for (let k = 0; k < 3; k++) {
					const v = world[k] * p[0] + world[4 + k] * p[1] + world[8 + k] * p[2] + world[12 + k];
					min[k] = Math.min(min[k], v);
					max[k] = Math.max(max[k], v);
				}
			}
		}
		for (const child of node.children ?? []) visit(child, world, depth + 1);
	};
	const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? (gltf.nodes ?? []).map((_, n) => n);
	for (const root of roots) visit(root, identity(), 0);
	if (!min.every(Number.isFinite)) return null;
	const box = options.babylon === false ? { min, max } : { min: [min[0], min[1], -max[2]] as Vec3, max: [max[0], max[1], -min[2]] as Vec3 };
	return {
		...box,
		size: [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]],
		center: [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2]
	};
}
