/**
 * The GLSL that reads a baked lighting volume (see `lighting/`) and adds it to what a lit material draws. It is plain text, made
 * from the volumes the world has, so that it can be checked without a graphics card.
 *
 * All the volumes of a world sit side by side in one 3D texture, the "atlas": volume `i` starts at texel `x = atlasX`, is
 * `nx` wide and `ny` high, and has six slabs of `nz` slices one after another in depth (the faces +X, -X, +Y, -Y, +Z, -Z). A
 * point is read by clamping to the centres of the texels inside its own volume, so that filtering never mixes two volumes or
 * two faces. The colour is stored as `sqrt(value / range)`.
 */

export const MAX_VOLUMES = 12;

export interface VolumeLayout {
	min: [number, number, number];
	voxel: number;
	dims: [number, number, number];
	/** Where the volume starts in the atlas, in texels along x. */
	atlasX: number;
	/** What a byte of 255 stands for. */
	range: number;
}

/** The uniforms every material gets, in the order they are declared. */
export const UNIFORMS = [...Array.from({ length: MAX_VOLUMES }, (_, i) => `lvT${i}`), 'lvParams'] as const;

/** A GLSL float literal: always with a point or an exponent, never a bare integer (which GLSL will not take for a float). */
const f = (n: number): string => {
	const text = String(Number(n.toPrecision(8)));
	return /[.e]/i.test(text) ? text : `${text}.0`;
};
const v4 = (a: number, b: number, c: number, d: number) => `vec4(${f(a)}, ${f(b)}, ${f(c)}, ${f(d)})`;

/** The uniforms, declared the way a material without uniform buffers wants them. */
export const FRAGMENT_UNIFORMS = `#ifdef IRRADIANCE_VOLUME\n${UNIFORMS.map((name) => `uniform vec4 ${name};`).join('\n')}\n#endif`;

/** The sampler, the tables of the volumes and the functions that read them (global scope of the fragment shader). */
export function definitions(volumes: readonly VolumeLayout[], atlas: readonly [number, number, number]): string {
	const n = volumes.length;
	if (n === 0 || n > MAX_VOLUMES) return '';
	const table = (rows: string[]) => rows.join(', ');
	const tints = Array.from({ length: n }, (_, i) => `\tif (i == ${i}) return lvT${i}.rgb;`).join('\n');
	return `#ifdef IRRADIANCE_VOLUME
uniform highp sampler3D lvAtlas;
const int LV_COUNT = ${n};
const vec3 LV_ATLAS = vec3(${f(atlas[0])}, ${f(atlas[1])}, ${f(atlas[2])});
const vec4 LV_A[${n}] = vec4[${n}](${table(volumes.map((v) => v4(v.min[0], v.min[1], v.min[2], v.voxel)))});
const vec4 LV_B[${n}] = vec4[${n}](${table(volumes.map((v) => v4(v.dims[0], v.dims[1], v.dims[2], v.atlasX)))});
const float LV_RANGE[${n}] = float[${n}](${table(volumes.map((v) => f(v.range)))});
vec3 lvTint(int i) {
${tints}
	return vec3(1.0);
}
vec3 lvFace(int i, vec3 cell, int face) {
	vec4 b = LV_B[i];
	vec3 c = clamp(cell, vec3(0.5), b.xyz - vec3(0.5));
	vec3 uvw = vec3((b.w + c.x) / LV_ATLAS.x, c.y / LV_ATLAS.y, (float(face) * b.z + c.z) / LV_ATLAS.z);
	vec3 t = texture(lvAtlas, uvw).rgb;
	return t * t * LV_RANGE[i];
}
vec3 lvIrradiance(vec3 p, vec3 n) {
	for (int i = 0; i < LV_COUNT; i++) {
		vec4 a = LV_A[i];
		vec4 b = LV_B[i];
		vec3 cell = (p + n * (a.w * 0.5) - a.xyz) / a.w;
		if (cell.x < 0.0 || cell.y < 0.0 || cell.z < 0.0 || cell.x > b.x || cell.y > b.y || cell.z > b.z) continue;
		vec3 w = n * n;
		vec3 sx = lvFace(i, cell, n.x >= 0.0 ? 0 : 1);
		vec3 sy = lvFace(i, cell, n.y >= 0.0 ? 2 : 3);
		vec3 sz = lvFace(i, cell, n.z >= 0.0 ? 4 : 5);
		return (sx * w.x + sy * w.y + sz * w.z) * lvTint(i);
	}
	return vec3(lvParams.y);
}
#endif`;
}

/** Added to what a Standard material has worked out, once its lights are done: after the clamp, so that it keeps its brightness. */
export const STANDARD_BEFORE_FOG = `#ifdef IRRADIANCE_VOLUME
{
	vec3 lvI = lvIrradiance(vPositionW, normalW) * lvParams.z;
	if (lvParams.x > 1.5) {
		lvI = vec3(0.0);
	}
	if (lvParams.x > 0.5 && lvParams.x < 1.5) {
		color.rgb = lvI;
	} else {
		color.rgb += lvI * baseColor.rgb * diffuseColor * baseAmbientColor;
	}
}
#endif`;

/** The same for a PBR material, where the ambient term is the place for light that comes from everywhere. */
export const PBR_BEFORE_COMPOSITION = `#ifdef IRRADIANCE_VOLUME
#ifndef UNLIT
{
	vec3 lvI = lvIrradiance(vPositionW, normalW) * lvParams.z;
	if (lvParams.x > 1.5) {
		lvI = vec3(0.0);
	}
	if (lvParams.x > 0.5 && lvParams.x < 1.5) {
		finalAmbient = lvI;
		finalDiffuse = vec3(0.0);
	} else {
		finalAmbient += lvI * surfaceAlbedo.rgb * aoOut.ambientOcclusionColor;
	}
}
#endif
#endif`;

/** Where the pieces go in the two shaders: the points of the shaders that Babylon leaves open for plugins. */
export const INJECTION_POINTS = {
	StandardMaterial: { definitions: 'CUSTOM_FRAGMENT_DEFINITIONS', code: 'CUSTOM_FRAGMENT_BEFORE_FOG' },
	PBRMaterial: { definitions: 'CUSTOM_FRAGMENT_DEFINITIONS', code: 'CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION' }
} as const;

export function customCode(materialClass: string, volumes: readonly VolumeLayout[], atlas: readonly [number, number, number]): Record<string, string> | null {
	const points = (INJECTION_POINTS as Record<string, { definitions: string; code: string }>)[materialClass];
	if (!points || volumes.length === 0 || volumes.length > MAX_VOLUMES) return null;
	return { [points.definitions]: definitions(volumes, atlas), [points.code]: materialClass === 'PBRMaterial' ? PBR_BEFORE_COMPOSITION : STANDARD_BEFORE_FOG };
}

/** One volume to pack: its numbers and its texels, laid out as `lighting/format.ts` says (x fastest, then y, then z, then the face). */
export interface PackInput {
	min: [number, number, number];
	voxel: number;
	dims: [number, number, number];
	range: number;
	texels: Uint8Array;
}

/** How big the atlas of some volumes is: side by side in x, as high as the highest, as deep as the deepest (six faces of slices). */
export function atlasSize(volumes: readonly { dims: [number, number, number] }[]): [number, number, number] {
	let width = 0, height = 1, depth = 1;
	for (const v of volumes) { width += v.dims[0]; height = Math.max(height, v.dims[1]); depth = Math.max(depth, v.dims[2] * 6); }
	return [width, height, depth];
}

/** Puts volumes side by side along x in one block of texels: the data of the atlas, its size and the layout of each volume in it. */
export function packAtlas(volumes: readonly PackInput[]): { data: Uint8Array; size: [number, number, number]; layouts: VolumeLayout[] } {
	const [width, height, depth] = atlasSize(volumes);
	const data = new Uint8Array(width * height * depth * 4);
	const layouts: VolumeLayout[] = [];
	let x0 = 0;
	for (const v of volumes) {
		const [nx, ny, nz] = v.dims;
		for (let z = 0; z < nz * 6; z++) {
			for (let y = 0; y < ny; y++) {
				const from = (z * ny + y) * nx * 4;
				data.set(v.texels.subarray(from, from + nx * 4), ((z * height + y) * width + x0) * 4);
			}
		}
		layouts.push({ min: v.min, voxel: v.voxel, dims: v.dims, atlasX: x0, range: v.range });
		x0 += nx;
	}
	return { data, size: [width, height, depth], layouts };
}
