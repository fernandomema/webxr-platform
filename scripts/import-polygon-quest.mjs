/** Convert the original Polygon Quest room FBX and Unity materials to a portable GLB. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshStandardMaterial } from 'three';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/import-polygon-quest.mjs <Unity Assets directory>');
const output = path.resolve('static/worlds/polygon-quest/room.glb');

// FBXLoader only needs the image element to record texture references; the GLB
// below embeds Unity colour, normal, occlusion, roughness, metal and emission maps.
globalThis.document = {
	createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(value) { this.url = value; } })
};
globalThis.FileReader = class {
	async readAsArrayBuffer(blob) {
		this.result = await blob.arrayBuffer();
		this.onloadend?.();
	}
};

const fbx = await readFile(path.join(source, 'Room.fbx'));
const root = new FBXLoader().parse(fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength), `${source}/`);
// The FBX stores centimetres. glTF and our world transforms use metres.
root.scale.setScalar(0.01);

const materialSpecs = {
	FakeMirror: 'Metal', carpet: 'carpet', walls: 'Marble', Wood: 'Wood',
	suspendedCeiling: 'Ceiling2', Floor: 'Tiles', GreenScreen: 'GreenscreenWhite',
	Ceiling: 'Concrete', Emmissive: 'Emmissive'
};
const unityMaterials = new Map();
for (const file of new Set(Object.values(materialSpecs))) {
	unityMaterials.set(file, await readFile(path.join(source, 'Materials', `${file}.mat`), 'utf8'));
}
const texturePaths = new Map();
for (const file of await readdir(path.join(source, 'Materials/Textures'))) {
	if (!file.endsWith('.meta')) continue;
	const meta = await readFile(path.join(source, 'Materials/Textures', file), 'utf8');
	const guid = meta.match(/^guid: ([0-9a-f]{32})/m)?.[1];
	if (guid) texturePaths.set(guid, path.join(source, 'Materials/Textures', file.slice(0, -5)));
}
function textureInfo(materialName, property) {
	const text = unityMaterials.get(materialName);
	const match = text?.match(new RegExp(`- ${property}:\\s*\\n\\s*m_Texture: \\{[^\\n]*guid: ([0-9a-f]{32})[^\\n]*\\n\\s*m_Scale: \\{x: ([^,]+), y: ([^}]+)\\}`));
	if (!match) return null;
	const file = texturePaths.get(match[1]);
	if (!file) throw new Error(`Missing ${property} texture for ${materialName}`);
	return { file, scale: [Number(match[2]), Number(match[3])] };
}
function floatProperty(materialName, property, fallback) {
	const match = unityMaterials.get(materialName)?.match(new RegExp(`- ${property}: ([^\\n]+)`));
	return match ? Number(match[1]) : fallback;
}
function emissionColor(materialName) {
	const match = unityMaterials.get(materialName)?.match(/- _EmissionColor: \{r: ([^,]+), g: ([^,]+), b: ([^,]+), a:/);
	return match ? match.slice(1, 4).map(Number) : [0, 0, 0];
}
const materials = new Map();
root.traverse((object) => {
	if (!object.isMesh) return;
	object.material = (Array.isArray(object.material) ? object.material : [object.material]).map((original) => {
		if (materials.has(original.name)) return materials.get(original.name);
		const sourceMaterial = materialSpecs[original.name];
		const metallic = sourceMaterial ? floatProperty(sourceMaterial, '_Metallic', 0) : 0;
		const roughness = sourceMaterial ? Math.max(0.04, 1 - floatProperty(sourceMaterial, '_Glossiness', 0)) : 0.9;
		const material = new MeshStandardMaterial({ name: original.name, roughness, metalness: metallic });
		material.side = 2; // Interior walls must remain visible if FBX winding differs from glTF.
		if (sourceMaterial) material.emissive.setRGB(...emissionColor(sourceMaterial).map((value) => Math.min(value, 1)));
		materials.set(original.name, material);
		return material;
	});
	if (object.material.length === 1) object.material = object.material[0];
});

const exported = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
const view = new DataView(exported);
const jsonLength = view.getUint32(12, true);
const gltf = JSON.parse(Buffer.from(exported, 20, jsonLength).toString('utf8'));
const binOffset = 20 + jsonLength;
const binLength = view.getUint32(binOffset, true);
const chunks = [Buffer.from(exported, binOffset + 8, binLength)];
let binSize = binLength;
const textureByFile = new Map();
const temp = await mkdtemp(path.join(os.tmpdir(), 'polygon-quest-'));
async function embedTexture(file) {
	if (textureByFile.has(file)) return textureByFile.get(file);
	const bytes = await readFile(file);
	const offset = binSize;
	chunks.push(bytes);
	binSize += bytes.length;
	const padding = (4 - binSize % 4) % 4;
	if (padding) { chunks.push(Buffer.alloc(padding)); binSize += padding; }
	gltf.bufferViews ??= [];
	const bufferView = gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }) - 1;
	gltf.images ??= [];
	const image = gltf.images.push({ bufferView, mimeType: 'image/png' }) - 1;
	gltf.textures ??= [];
	const texture = gltf.textures.push({ source: image }) - 1;
	textureByFile.set(file, texture);
	return texture;
}
for (const material of gltf.materials ?? []) {
	const sourceMaterial = materialSpecs[material.name];
	if (!sourceMaterial) continue;
	const baseColor = textureInfo(sourceMaterial, '_MainTex');
	const metallic = floatProperty(sourceMaterial, '_Metallic', 0);
	const roughness = Math.max(0.04, 1 - floatProperty(sourceMaterial, '_Glossiness', 0));
	material.pbrMetallicRoughness ??= {};
	if (baseColor) {
		const index = await embedTexture(baseColor.file);
		const info = { index };
		if (baseColor.scale.some((value) => value !== 1)) {
			info.extensions = { KHR_texture_transform: { scale: baseColor.scale } };
			gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), 'KHR_texture_transform'])];
		}
		material.pbrMetallicRoughness.baseColorTexture = info;
		const packed = JSON.parse(execFileSync('python3', [path.resolve('scripts/pack-polygon-quest-textures.py'), baseColor.file, String(metallic), String(roughness), temp], { encoding: 'utf8' }));
		const ormIndex = await embedTexture(packed.orm);
		material.pbrMetallicRoughness.metallicRoughnessTexture = { index: ormIndex };
		material.pbrMetallicRoughness.metallicFactor = 1;
		material.pbrMetallicRoughness.roughnessFactor = 1;
		material.occlusionTexture = { index: ormIndex, strength: 1 };
		if (packed.normal) material.normalTexture = { index: await embedTexture(packed.normal), scale: floatProperty(sourceMaterial, '_BumpScale', 1) };
	}
	const emission = emissionColor(sourceMaterial);
	if (emission.some((value) => value > 0)) {
		const strength = Math.max(1, ...emission);
		material.emissiveFactor = emission.map((value) => value / strength);
		if (strength > 1) {
			material.extensions ??= {};
			material.extensions.KHR_materials_emissive_strength = { emissiveStrength: strength };
			gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed ?? []), 'KHR_materials_emissive_strength'])];
		}
		const map = textureInfo(sourceMaterial, '_EmissionMap');
		if (map) material.emissiveTexture = { index: await embedTexture(map.file) };
	}
}
await rm(temp, { recursive: true, force: true });

gltf.buffers[0].byteLength = binSize;
const json = Buffer.from(JSON.stringify(gltf));
const jsonPadding = (4 - json.length % 4) % 4;
const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
const bin = Buffer.concat(chunks);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
const glb = Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin]);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, glb);
const hash = createHash('sha256').update(glb).digest('hex');
for (const file of ['src/lib/assets/builtin.ts', 'src/lib/xr/templates/polygonQuest.json']) {
	const content = await readFile(file, 'utf8');
	const updated = content.replace(/sha256:[0-9a-f]{64}/, `sha256:${hash}`);
	if (updated === content && !content.includes(`sha256:${hash}`)) throw new Error(`Missing model reference in ${file}`);
	await writeFile(file, updated);
}
const probeDir = path.resolve('static/worlds/polygon-quest/probe');
await mkdir(probeDir, { recursive: true });
execFileSync('magick', [path.join(source, 'OpenMe/ReflectionProbe-0.exr'), '-gamma', '1.35', '-depth', '8', '-crop', '128x128', '+repage', path.join(probeDir, 'face-%d.png')]);
console.log(JSON.stringify({ output, bytes: glb.length, sha256: hash, meshes: gltf.meshes?.length, materials: gltf.materials?.length, images: gltf.images?.length }, null, 2));
