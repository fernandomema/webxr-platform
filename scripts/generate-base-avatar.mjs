// Builds static/avatars/base.glb: a plain blocky humanoid with a full skeleton, used for players
// who have not chosen an avatar. Run with `node scripts/generate-base-avatar.mjs`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// glTF space: +Y up, the model faces +Z, its left side is +X. Translations are relative to the parent.
// Per finger: name, knuckle offset from the hand joint (for the left hand; mirrored for the right), segment lengths, and whether it points forward (thumb) or out to the side.
const FINGERS = [
	['Thumb', [0.03, -0.006, 0.04], [0.03, 0.025], true],
	['Index', [0.12, 0, 0.03], [0.035, 0.025], false],
	['Middle', [0.12, 0, 0.01], [0.04, 0.028], false],
	['Ring', [0.12, 0, -0.01], [0.036, 0.026], false],
	['Little', [0.12, 0, -0.03], [0.03, 0.02], false]
];

const BONES = [
	['Hips', null, [0, 0.95, 0]],
	['Spine', 'Hips', [0, 0.12, 0]],
	['Chest', 'Spine', [0, 0.15, 0]],
	['Neck', 'Chest', [0, 0.25, 0]],
	['Head', 'Neck', [0, 0.08, 0]],
	...['Left', 'Right'].flatMap((side) => {
		const s = side === 'Left' ? 1 : -1;
		return [
			[`${side}Shoulder`, 'Chest', [0.04 * s, 0.2, 0]],
			[`${side}UpperArm`, `${side}Shoulder`, [0.14 * s, 0, 0]],
			[`${side}LowerArm`, `${side}UpperArm`, [0.28 * s, 0, 0]],
			[`${side}Hand`, `${side}LowerArm`, [0.26 * s, 0, 0]],
			[`${side}UpperLeg`, 'Hips', [0.09 * s, -0.05, 0]],
			[`${side}LowerLeg`, `${side}UpperLeg`, [0, -0.42, 0]],
			[`${side}Foot`, `${side}LowerLeg`, [0, -0.42, 0]],
			...FINGERS.flatMap(([finger, knuckle, lengths, alongZ]) => {
				const names = [1, 2, 3].map((n) => `${side}Hand${finger}${n}`);
				return names.map((name, i) => [
					name,
					i === 0 ? `${side}Hand` : names[i - 1],
					i === 0 ? [knuckle[0] * s, knuckle[1], knuckle[2]] : alongZ ? [0, 0, lengths[i - 1]] : [lengths[i - 1] * s, 0, 0]
				]);
			})
		];
	})
];

const world = new Map();
for (const [name, parent, t] of BONES) {
	const base = parent ? world.get(parent) : [0, 0, 0];
	world.set(name, [base[0] + t[0], base[1] + t[1], base[2] + t[2]]);
}

// [bone, centre, size, material]: every box is rigidly skinned to one bone.
const SKIN = 0, MARK = 1;
const PARTS = [
	['Hips', [0, 0.95, 0], [0.3, 0.16, 0.19], SKIN],
	['Spine', [0, 1.1, 0], [0.28, 0.2, 0.18], SKIN],
	['Chest', [0, 1.33, 0], [0.34, 0.28, 0.2], SKIN],
	['Neck', [0, 1.5, 0], [0.08, 0.1, 0.08], SKIN],
	['Head', [0, 1.66, 0], [0.2, 0.24, 0.22], SKIN],
	['Head', [0, 1.65, 0.125], [0.05, 0.05, 0.05], MARK], // a nose, so it is clear where it faces
	...['Left', 'Right'].flatMap((side) => {
		const s = side === 'Left' ? 1 : -1;
		return [
			[`${side}UpperArm`, [0.32 * s, 1.42, 0], [0.28, 0.08, 0.08], SKIN],
			[`${side}LowerArm`, [0.59 * s, 1.42, 0], [0.26, 0.07, 0.07], SKIN],
			[`${side}Hand`, [0.78 * s, 1.42, 0], [0.12, 0.03, 0.09], MARK],
			[`${side}UpperLeg`, [0.09 * s, 0.69, 0], [0.13, 0.42, 0.13], SKIN],
			[`${side}LowerLeg`, [0.09 * s, 0.27, 0], [0.1, 0.42, 0.1], SKIN],
			[`${side}Foot`, [0.09 * s, 0.03, 0.05], [0.1, 0.06, 0.22], MARK]
		];
	})
];

// Finger segments: thin boxes along each joint, the last one running a little past its joint to make a fingertip.
const TIP = 0.02;
for (const side of ['Left', 'Right']) {
	const sign = side === 'Left' ? 1 : -1;
	for (const [finger, , lengths, alongZ] of FINGERS) {
		[1, 2, 3].forEach((n, i) => {
			const bone = `${side}Hand${finger}${n}`;
			const start = world.get(bone);
			const length = i < 2 ? lengths[i] : TIP;
			const centre = alongZ ? [start[0], start[1], start[2] + length / 2] : [start[0] + (sign * length) / 2, start[1], start[2]];
			PARTS.push([bone, centre, alongZ ? [0.014, 0.014, length] : [length, 0.014, 0.014], MARK]);
		});
	}
}

const boneIndex = new Map(BONES.map(([name], i) => [name, i]));

function primitive(material) {
	const positions = [], normals = [], joints = [], weights = [], indices = [];
	const faces = [
		[[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
		[[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
		[[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
		[[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
		[[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
		[[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]]
	];
	for (const [bone, c, size, mat] of PARTS) {
		if (mat !== material) continue;
		for (const [normal, corners] of faces) {
			const start = positions.length / 3;
			for (const k of corners) {
				positions.push(c[0] + (k[0] * size[0]) / 2, c[1] + (k[1] * size[1]) / 2, c[2] + (k[2] * size[2]) / 2);
				normals.push(...normal);
				joints.push(boneIndex.get(bone), 0, 0, 0);
				weights.push(1, 0, 0, 0);
			}
			indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
		}
	}
	return { positions, normals, joints, weights, indices };
}

const chunks = []; // { data: TypedArray, target?: number }
const bufferViews = [], accessors = [];
function addAccessor(array, componentType, type, count, extra = {}, target) {
	const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
	const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
	padded.set(bytes);
	const offset = chunks.reduce((sum, c) => sum + c.byteLength, 0);
	chunks.push(padded);
	bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
	accessors.push({ bufferView: bufferViews.length - 1, componentType, count, type, ...extra });
	return accessors.length - 1;
}
const minMax = (array) => {
	const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < array.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], array[i + k]); max[k] = Math.max(max[k], array[i + k]); }
	return { min, max };
};

const primitives = [];
for (const material of [SKIN, MARK]) {
	const p = primitive(material);
	const positions = new Float32Array(p.positions);
	const count = positions.length / 3;
	primitives.push({
		attributes: {
			POSITION: addAccessor(positions, 5126, 'VEC3', count, minMax(positions), 34962),
			NORMAL: addAccessor(new Float32Array(p.normals), 5126, 'VEC3', count, {}, 34962),
			JOINTS_0: addAccessor(new Uint8Array(p.joints), 5121, 'VEC4', count, {}, 34962),
			WEIGHTS_0: addAccessor(new Float32Array(p.weights), 5126, 'VEC4', count, {}, 34962)
		},
		indices: addAccessor(new Uint16Array(p.indices), 5123, 'SCALAR', p.indices.length, {}, 34963),
		material
	});
}

// Inverse bind matrices: bones have no rotation, so each is a translation by minus the bone's rest position.
const ibm = new Float32Array(BONES.length * 16);
BONES.forEach(([name], i) => {
	const [x, y, z] = world.get(name);
	ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
});
const ibmAccessor = addAccessor(ibm, 5126, 'MAT4', BONES.length);

// Node indices: 0 = the skinned body, 1.. = bones in BONES order (Hips = 1).
const nodes = [
	{ name: 'Body', mesh: 0, skin: 0 },
	...BONES.map(([name, , translation]) => ({ name, translation }))
];
BONES.forEach(([name], i) => {
	const kids = BONES.flatMap(([, parent], j) => (parent === name ? [1 + j] : []));
	if (kids.length) nodes[1 + i].children = kids;
});

const json = {
	asset: { version: '2.0', generator: 'webxr-platform base avatar' },
	scene: 0,
	scenes: [{ nodes: [0, 1] }],
	nodes,
	meshes: [{ name: 'Body', primitives }],
	skins: [{ skeleton: 1, joints: BONES.map((_, i) => 1 + i), inverseBindMatrices: ibmAccessor }],
	materials: [
		{ name: 'Body', pbrMetallicRoughness: { baseColorFactor: [0.36, 0.55, 0.95, 1], metallicFactor: 0, roughnessFactor: 0.85 } },
		{ name: 'Mark', pbrMetallicRoughness: { baseColorFactor: [0.98, 0.75, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.85 } }
	],
	accessors,
	bufferViews,
	buffers: [{ byteLength: chunks.reduce((sum, c) => sum + c.byteLength, 0) }]
};

const bin = new Uint8Array(json.buffers[0].byteLength);
let at = 0;
for (const c of chunks) { bin.set(c, at); at += c.byteLength; }
const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
const jsonPadded = new Uint8Array(Math.ceil(jsonBytes.byteLength / 4) * 4).fill(0x20);
jsonPadded.set(jsonBytes);
const total = 12 + 8 + jsonPadded.byteLength + 8 + bin.byteLength;
const out = new Uint8Array(total);
const view = new DataView(out.buffer);
view.setUint32(0, 0x46546c67, true);
view.setUint32(4, 2, true);
view.setUint32(8, total, true);
view.setUint32(12, jsonPadded.byteLength, true);
view.setUint32(16, 0x4e4f534a, true);
out.set(jsonPadded, 20);
const binStart = 20 + jsonPadded.byteLength;
view.setUint32(binStart, bin.byteLength, true);
view.setUint32(binStart + 4, 0x004e4942, true);
out.set(bin, binStart + 8);

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../static/avatars/base.glb');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out);
console.log(`Wrote ${target} (${out.byteLength} bytes, ${BONES.length} bones)`);
