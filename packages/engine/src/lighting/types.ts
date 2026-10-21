export type V3 = [number, number, number];

/** A 4x4 matrix as Babylon holds it: 16 numbers, row-major, row vectors (a point is multiplied on the left), translation in 12..14. */
export type Mat4 = Float64Array;

export type PrimitiveShape = 'box' | 'sphere' | 'cylinder' | 'plane' | 'ground' | 'disc';

/** What the baker sees of a surface: its shape in the world, how it looks, and whether it blocks light. */
export interface BakePrimitive {
	id: string;
	shape: PrimitiveShape;
	/** Local to world. */
	world: Mat4;
	/** World to local. */
	inverse: Mat4;
	/** Colour that light bounces with (0 to 1 per channel). */
	albedo: V3;
	/** Light it gives out by itself (a lamp panel), or null. */
	emissive: V3 | null;
	/** Whether it stops light: translucent and invisible things do not. */
	opaque: boolean;
	/** World-space bounds. */
	min: V3;
	max: V3;
}

export interface BakeLight {
	kind: 'point' | 'spot';
	position: V3;
	/** Unit vector the cone points along (spot only). */
	direction: V3;
	/** Colour times intensity, as the renderer feeds it to the shader. */
	color: V3;
	range: number;
	/** Cosine of half the cone angle (spot only). */
	cosHalfAngle: number;
	exponent: number;
}

export interface BakeSky {
	top: V3;
	horizon: V3;
	bottom: V3;
	/** How much of the sky's light reaches the world. */
	intensity: number;
}

export interface BakeScene {
	primitives: BakePrimitive[];
	lights: BakeLight[];
	sky: BakeSky;
}

/** The grid a volume is baked on: `dims` voxels of side `voxel`, the first one's corner at `min`. */
export interface VolumeSpec {
	min: V3;
	voxel: number;
	dims: [number, number, number];
}

/** A baked volume: for each voxel, six colours, one per axis direction (+X, -X, +Y, -Y, +Z, -Z), as irradiance in the renderer's units. */
export interface BakedVolume {
	spec: VolumeSpec;
	/** `voxelCount * 6 * 3` floats: index `((face * nz + z) * ny + y) * nx + x` times 3. */
	data: Float32Array;
}

export const FACE_DIRECTIONS: readonly V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export const voxelCount = (spec: VolumeSpec): number => spec.dims[0] * spec.dims[1] * spec.dims[2];
/** Where a voxel's colour for a face starts in `BakedVolume.data`. */
export const slotIndex = (spec: VolumeSpec, face: number, x: number, y: number, z: number): number =>
	(((face * spec.dims[2] + z) * spec.dims[1] + y) * spec.dims[0] + x) * 3;
