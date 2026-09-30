import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAvatarTree, AvatarRejected, MAX_AVATAR_SLOTS } from '../src/lib/xr/avatar/sanitize.ts';

const ASSET = `sha256:${'a'.repeat(64)}`;
const root = (extra = []) => ({
	id: 'r', parentId: null, name: 'Avatar', position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
	components: [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: ASSET } }, { type: 'avatar', height: 1.6, bones: { head: 'Head' }, ownerId: 'someone-else' }, ...extra]
});
const child = (id, parentId, components = []) => ({ id, parentId, name: id, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components });
const rejects = (tree) => assert.throws(() => sanitizeAvatarTree(tree), AvatarRejected);

test('a valid avatar keeps its structure and loses ownerId and socket occupants', () => {
	const tree = sanitizeAvatarTree([
		child('s', 'r', [{ type: 'boneAttach', bone: 'RightShoulder' }, { type: 'socket', accepts: ['tool'], radius: 0.15, snap: { position: [0, 0, 0], rotation: [0, 0, 0] }, occupantId: 'stolen' }]),
		root()
	]);
	assert.equal(tree[0].id, 'r');
	assert.equal(tree[0].components.find((c) => c.type === 'avatar').ownerId, undefined);
	assert.equal(tree[1].components.find((c) => c.type === 'socket').occupantId, undefined);
	assert.equal(tree[1].components.find((c) => c.type === 'boneAttach').bone, 'RightShoulder');
});

test('components outside the allowlist are dropped', () => {
	const tree = sanitizeAvatarTree([root([{ type: 'codeBlock', code: 'alert(1)' }, { type: 'worldPortal', world: {} }])]);
	assert.deepEqual(tree[0].components.map((c) => c.type), ['meshRenderer', 'avatar']);
});

test('structural problems are rejected', () => {
	rejects(null);
	rejects([]);
	rejects([root(), { ...root(), id: 'r2' }]); // two roots
	rejects([root(), child('c', 'missing')]);
	rejects([root(), child('a', 'b'), child('b', 'a')]); // a cycle that never reaches the root
	rejects([root(), root()]); // duplicate id
	rejects([{ ...root(), components: [{ type: 'avatar', height: 1.6, bones: {} }] }]); // no model
	rejects([{ ...root(), components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' } }, { type: 'avatar', height: 1, bones: {} }] }]); // not a model asset
	rejects([root(), ...Array.from({ length: MAX_AVATAR_SLOTS }, (_, i) => child(`c${i}`, 'r'))]);
});

test('bad numbers fall back to safe defaults', () => {
	const tree = sanitizeAvatarTree([{ ...root(), position: [NaN, 0, 0], components: [{ type: 'meshRenderer', meshRef: { kind: 'asset', assetId: ASSET } }, { type: 'avatar', height: 99, bones: {} }] }]);
	assert.deepEqual(tree[0].position, [0, 0, 0]);
	assert.equal(tree[0].components.find((c) => c.type === 'avatar').height, 3);
});

import { buildAvatarTree, eyeHeightOf } from '../src/lib/xr/avatar/build.ts';

test('buildAvatarTree makes a tree the host accepts, with sockets on recognised bones', () => {
	const joints = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'RightShoulder', 'LeftUpperLeg', 'LeftHand', 'RightHand'];
	const tree = buildAvatarTree({ assetId: ASSET, name: 'Bot', joints, bounds: { min: [-0.5, 0, -0.1], max: [0.5, 1.78, 0.1] } });
	assert.equal(tree[0].components.find((c) => c.type === 'avatar').height, 1.66);
	assert.deepEqual(tree.slice(1).map((s) => s.components.find((c) => c.type === 'boneAttach').bone), ['RightShoulder', 'LeftUpperLeg']);
	assert.equal(sanitizeAvatarTree(tree).length, 3);
	assert.equal(buildAvatarTree({ assetId: ASSET, name: 'Bot', joints: ['bone_1'] }).length, 1, 'no known bones, no sockets');
	assert.equal(eyeHeightOf(undefined), 1.6);
});

test('buildAvatarTree honours a hand-edited bone map, height and socket choice', () => {
	const tree = buildAvatarTree(
		{ assetId: ASSET, name: 'Bot', joints: ['Hips', 'Head'] },
		{ bones: { head: 'Head', leftHand: 'HandL', rightHand: 'HandR', chest: 'Ribs' }, height: 1.8, sockets: { shoulder: true, hip: false } }
	);
	const avatar = tree[0].components.find((c) => c.type === 'avatar');
	assert.equal(avatar.height, 1.8);
	assert.equal(avatar.bones.leftHand, 'HandL');
	assert.deepEqual(tree.slice(1).map((s) => s.name), ['Shoulder Socket']);
	assert.equal(buildAvatarTree({ assetId: ASSET, name: 'Bot', joints: ['Hips', 'Head'] }, { sockets: false }).length, 1);
});
