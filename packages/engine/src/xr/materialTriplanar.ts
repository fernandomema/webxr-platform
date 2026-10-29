/**
 * Triplanar projection for a material: instead of the mesh's own coordinates, each map is projected along the three axes and the
 * three are blended by where the surface faces, so the picture keeps its real size on any shape, turned any way, and a model
 * that has no suitable coordinates still shows it. In `world` space the pattern is fixed in the scene; in `local` space it is
 * fixed to the object (it moves and turns with it). One repeat covers `size` metres in both; fixed to the object it can also be
 * fitted, so each side holds a whole number of repeats and whole tiles meet the edges.
 *
 * Every face reads the picture the same way round (the projection along an axis is the same on both of its sides, like Babylon's
 * own TriPlanarMaterial), so a pattern keeps its phase along the edge two faces share.
 *
 * The weights are plain maths, kept here so they run in Node; the shader below does the same on the graphics card.
 */

/** How sharply the projections separate: higher keeps them apart (less blending at the corners of a surface). */
export const TRIPLANAR_SHARPNESS = 4;

/** The share of each of the three projections for a surface facing `normal`; they add up to 1. */
export function triplanarWeights(normal: readonly [number, number, number], sharpness = TRIPLANAR_SHARPNESS): [number, number, number] {
	const raw = normal.map((value) => Math.abs(value) ** sharpness) as [number, number, number];
	const total = raw[0] + raw[1] + raw[2];
	return total > 0 ? [raw[0] / total, raw[1] / total, raw[2] / total] : [0, 1, 0];
}

/**
 * Repeats per metre along each axis of an object that is `extent` metres across, for pictures `size` metres wide. Fitted, each
 * axis holds a whole number of repeats (never fewer than one), so the picture starts and ends on a whole tile at every edge; an
 * axis shorter than half a repeat keeps its real size.
 */
export function repeatsPerMetre(extent: readonly [number, number, number], size: number, fit: boolean): [number, number, number] {
	const metres = size > 0 ? size : 1;
	return extent.map((length) => {
		if (!(length > 0)) return 1 / metres;
		const real = length / metres;
		return (fit && real >= 0.5 ? Math.max(1, Math.round(real)) : real) / length;
	}) as [number, number, number];
}

/**
 * Where, in repeats, the picture starts at the object's corner. With whole repeats on every side the same stretch of the
 * picture meets at every edge, so the faces on either side of it show the same thing, mirrored. Starting half a cell in puts
 * that meeting line through the middle of the cells instead of along their borders: a cell is bent over the edge rather than
 * showing as two side by side, and a checker reads as continuous round the whole object. `cells` is how many cells the picture
 * has along one side (2 for a 2 by 2 checker).
 */
export function edgeOffset(cells: number): number {
	return cells >= 1 ? 0.5 / cells : 0;
}

/**
 * The uniforms the shader reads. `triParams`: y = 1 in local space, z = sharpness, w = where the picture starts across (u), in
 * repeats; `triOrigin.w` is where it starts up (v). `triScale`: repeats per metre on each axis. */
export const TRIPLANAR_UNIFORMS = [
	{ name: 'triParams', size: 4, type: 'vec4' },
	{ name: 'triOrigin', size: 4, type: 'vec4' },
	{ name: 'triScale', size: 4, type: 'vec4' },
	{ name: 'triRot', size: 16, type: 'mat4' }
] as const;

export const TRIPLANAR_SAMPLER = 'triNormalSampler';

/**
 * Declarations for a shader that does not use uniform buffers (they are declared by the buffer otherwise, and this text is not
 * used). The sampler is not part of a buffer either way, so the shader declares it itself.
 */
export const TRIPLANAR_DECLARATIONS = 'uniform vec4 triParams;\nuniform vec4 triOrigin;\nuniform vec4 triScale;\nuniform mat4 triRot;';

/**
 * Before the shader's main: every read of a map (colour, and the occlusion / roughness / metallic one) goes through the
 * three-way projection. The position is in metres, in the scene or relative to the object turned with it.
 */
export const TRIPLANAR_DEFINITIONS = `
uniform sampler2D ${TRIPLANAR_SAMPLER};
#ifdef TRIPLANAR
vec3 _triPosition() {
	vec3 p = triParams.y > 0.5 ? (vPositionW - triOrigin.xyz) * mat3(triRot) : vPositionW;
	return p * triScale.xyz;
}
vec3 _triSurface(vec3 n) {
	return triParams.y > 0.5 ? n * mat3(triRot) : n;
}
vec2 _triStart() {
	return vec2(triParams.w, triOrigin.w);
}
vec3 _triWeights(vec3 n) {
	vec3 w = pow(abs(n), vec3(triParams.z));
	return w / max(w.x + w.y + w.z, 0.0001);
}
vec4 _triRead(sampler2D samp) {
#ifdef NORMAL
	vec3 n = _triSurface(normalize(vNormalW));
#else
	vec3 n = _triSurface(normalize(cross(dFdx(vPositionW), dFdy(vPositionW))));
#endif
	vec3 p = _triPosition();
	vec3 w = _triWeights(n);
	vec2 o = _triStart();
	vec4 cx = texture2D(samp, vec2(p.z, p.y) + o);
	vec4 cy = texture2D(samp, vec2(p.x, p.z) + o);
	vec4 cz = texture2D(samp, vec2(p.x, p.y) + o);
	return cx * w.x + cy * w.y + cz * w.z;
}
#undef TEXRD
#define TEXRD(s, uv) _triRead(s)
#endif
`;

/**
 * After the shader has its own normal: the normal map is blended by "whiteout" in the surface's frame (each projection's
 * tangent normal is swizzled to the axis it was projected along), so the bumps lie the right way on every face.
 */
export const TRIPLANAR_NORMAL_CODE = `
#if defined(TRIPLANAR) && defined(TRIPLANAR_NORMAL)
{
	vec3 triN = _triSurface(normalize(normalW));
	vec3 triP = _triPosition();
	vec3 triW = _triWeights(triN);
	vec2 triO = _triStart();
	vec3 tx = texture2D(${TRIPLANAR_SAMPLER}, vec2(triP.z, triP.y) + triO).xyz * 2.0 - 1.0;
	vec3 ty = texture2D(${TRIPLANAR_SAMPLER}, vec2(triP.x, triP.z) + triO).xyz * 2.0 - 1.0;
	vec3 tz = texture2D(${TRIPLANAR_SAMPLER}, vec2(triP.x, triP.y) + triO).xyz * 2.0 - 1.0;
	tx = vec3(tx.xy + triN.zy, abs(tx.z) * triN.x);
	ty = vec3(ty.xy + triN.xz, abs(ty.z) * triN.y);
	tz = vec3(tz.xy + triN.xy, abs(tz.z) * triN.z);
	vec3 triResult = normalize(tx.zyx * triW.x + ty.xzy * triW.y + tz.xyz * triW.z);
	normalW = triParams.y > 0.5 ? mat3(triRot) * triResult : triResult;
}
#endif
`;
