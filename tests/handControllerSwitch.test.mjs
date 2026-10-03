import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { Bone, Logger, Matrix, MeshBuilder, NullEngine, Observable, Scene, Skeleton, StandardMaterial, TransformNode, VertexBuffer, WebXRHand } from '@babylonjs/core';
import { BindBonesParameters, PrepareDefinesForBones } from '@babylonjs/core/Materials/materialHelper.functions.js';

const source = await readFile(new URL('../src/lib/xr/interaction/handControllerSwitch.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
	.replaceAll("'@babylonjs/core'", JSON.stringify(import.meta.resolve('@babylonjs/core')));
const { setupHandControllerSwitch } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture({ textureFloat = true } = {}) {
	const engine = new NullEngine();
	// Emulate Quest's relevant capabilities; NullEngine itself does not exercise a real GPU.
	Object.assign(engine.getCaps(), { textureFloat, maxVertexTextureImageUnits: 16, maxVertexUniformVectors: 256 });
	const scene = new Scene(engine);
	const hands = new Map();
	const tracking = {
		onHandAddedObservable: new Observable(),
		getHandByHandedness(side) { return hands.get(side) ?? null; },
		getHandByControllerId(id) { return [...hands.values()].find((hand) => hand.xrController.uniqueId === id) ?? null; }
	};
	const xr = {
		baseExperience: { featuresManager: { getEnabledFeature() { return tracking; } } },
		input: { onControllerAddedObservable: new Observable() }
	};
	function mesh(name = 'hand', { needInitialSkinMatrix = false } = {}) {
		const handMesh = MeshBuilder.CreateBox(name, {}, scene);
		const skeleton = new Skeleton('skeleton #0', name, scene);
		for (let i = 0; i < 26; i++) new Bone(`bone-${i}`, skeleton, null, Matrix.Identity());
		skeleton.useTextureToStoreBoneMatrices = false; // Babylon's default hand loader explicitly selects uniforms.
		skeleton.needInitialSkinMatrix = needInitialSkinMatrix;
		handMesh.skeleton = skeleton;
		const count = handMesh.getTotalVertices();
		handMesh.setVerticesData(VertexBuffer.MatricesIndicesKind, new Float32Array(count * 4));
		const weights = new Float32Array(count * 4);
		for (let i = 0; i < count; i++) weights[i * 4] = 1;
		handMesh.setVerticesData(VertexBuffer.MatricesWeightsKind, weights);
		const material = new StandardMaterial(`${name}-material`, scene);
		handMesh.material = material;
		material.freeze();
		const dirty = material.markDirty.bind(material);
		handMesh.dirtyCalls = [];
		material.markDirty = (force) => { handMesh.dirtyCalls.push(force); dirty(force); };
		return handMesh;
	}
	function addHand(handMesh = null, side = 'left') {
		const controller = {
			uniqueId: side, inputSource: { handedness: side, hand: {} },
			pointer: new TransformNode(`${side}-pointer`, scene), onMotionControllerInitObservable: new Observable()
		};
		const joints = Array.from({ length: 25 }, (_, i) => MeshBuilder.CreateBox(`${side}-joint-${i}`, {}, scene));
		const hand = new WebXRHand(controller, joints, handMesh, null);
		hands.set(side, hand);
		tracking.onHandAddedObservable.notifyObservers(hand);
		return hand;
	}
	return { xr, tracking, mesh, addHand, dispose() { for (const hand of hands.values()) hand.dispose(); scene.dispose(); engine.dispose(); } };
}

const boneDefines = () => ({ NUM_BONE_INFLUENCERS: 0, BonesPerMesh: 0, BONETEXTURE: false, MULTIVIEW: true });

test('cached hands switch from the warning-producing uniform path to bone textures', () => {
	const f = fixture();
	const warnings = [];
	const warn = Logger.Warn;
	Logger.Warn = (message) => warnings.push(message);
	try {
		const mesh = f.mesh();
		f.addHand(mesh);
		const before = boneDefines();
		PrepareDefinesForBones(mesh, before);
		assert.equal(before.BONETEXTURE, false);
		assert.equal(before.BonesPerMesh, 27);
		assert.match(warnings[0], /26 bones.*108.*192.*multiview/);
		setupHandControllerSwitch(f.xr);
		assert.equal(mesh.skeleton.isUsingTextureForMatrices, true);
		assert.deepEqual(mesh.dirtyCalls, [true], 'even a frozen material is forced to rebuild its defines');
		const after = boneDefines();
		PrepareDefinesForBones(mesh, after);
		assert.equal(after.BONETEXTURE, true);
		assert.equal(after.BonesPerMesh, 0, 'bone matrices no longer consume the vertex uniform array');
	} finally { Logger.Warn = warn; f.dispose(); }
});

test('hands attached before their GLB loads also configure later and replacement meshes', () => {
	const f = fixture();
	try {
		setupHandControllerSwitch(f.xr);
		const hand = f.addHand();
		for (const name of ['loaded', 'replacement']) {
			const mesh = f.mesh(name);
			hand.setHandMesh(mesh, null);
			assert.equal(mesh.skeleton.isUsingTextureForMatrices, true);
			assert.deepEqual(mesh.dirtyCalls, [true]);
			hand.setHandMesh(mesh, null);
			assert.deepEqual(mesh.dirtyCalls, [true], 'repeated notifications do not recompile an unchanged hand');
		}
	} finally { f.dispose(); }
});

for (const needInitialSkinMatrix of [false, true]) {
test(`an already prepared uniform skeleton creates and binds a bone texture (initial skin matrix: ${needInitialSkinMatrix})`, () => {
	const f = fixture();
	try {
		const mesh = f.mesh('prepared', { needInitialSkinMatrix });
		mesh.skeleton.prepare(true);
		assert.equal(mesh.skeleton.getTransformMatrixTexture(mesh), undefined);
		f.addHand(mesh);
		setupHandControllerSwitch(f.xr);
		mesh.skeleton.prepare(true);
		const texture = mesh.skeleton.getTransformMatrixTexture(mesh);
		assert.ok(texture, 'the shader needs a real texture, not only BONETEXTURE=true');
		assert.deepEqual([texture.getSize().width, texture.getSize().height], [108, 1]);
		const calls = [];
		BindBonesParameters(mesh, {
			getUniformIndex() { return 0; },
			setTexture(name, value) { calls.push([name, value]); },
			setFloat2(name, width, height) { calls.push([name, width, height]); },
			setMatrices() { assert.fail('bone matrices must not be sent as vertex uniforms'); }
		});
		assert.deepEqual(calls, [['boneSampler', texture], ['boneTextureInfo', 108, 1]]);
	} finally { f.dispose(); }
});
}

test('cached left and right hands retain bone textures across session re-entry', () => {
	const f = fixture();
	try {
		setupHandControllerSwitch(f.xr);
		for (const side of ['left', 'right']) {
			const mesh = f.mesh(side);
			const first = f.addHand(mesh, side);
			mesh.skeleton.prepare(true);
			const texture = mesh.skeleton.getTransformMatrixTexture(mesh);
			first.dispose();
			assert.equal(first.onHandMeshSetObservable.observers.length, 0);
			// Babylon's loader resets this flag even when reusing a cached GLB on the next session.
			mesh.skeleton.useTextureToStoreBoneMatrices = false;
			f.addHand(mesh, side);
			mesh.skeleton.prepare(true);
			assert.equal(mesh.skeleton.isUsingTextureForMatrices, true);
			assert.equal(mesh.skeleton.getTransformMatrixTexture(mesh), texture, 'an existing bone texture can be reused');
			assert.deepEqual(mesh.dirtyCalls, [true, true]);
		}
	} finally { f.dispose(); }
});

test('switching between hands and controllers still hides the other representation', () => {
	const f = fixture();
	try {
		setupHandControllerSwitch(f.xr);
		const hand = f.addHand();
		const controller = hand.xrController;
		const rootMesh = f.mesh('controller');
		controller.motionController = { rootMesh };
		f.tracking.onHandAddedObservable.notifyObservers(hand);
		assert.equal(rootMesh.isEnabled(), false);
		const handMesh = f.mesh();
		hand.setHandMesh(handMesh, null);
		f.xr.input.onControllerAddedObservable.notifyObservers(controller);
		controller.onMotionControllerInitObservable.notifyObservers(controller.motionController);
		assert.equal(handMesh.isEnabled(), false);
	} finally { f.dispose(); }
});

test('hardware without float bone textures retains Babylon\'s supported uniform fallback', () => {
	const f = fixture({ textureFloat: false });
	try {
		setupHandControllerSwitch(f.xr);
		const mesh = f.mesh();
		f.addHand(mesh);
		assert.equal(mesh.skeleton.useTextureToStoreBoneMatrices, true);
		assert.equal(mesh.skeleton.isUsingTextureForMatrices, false);
	} finally { f.dispose(); }
});
