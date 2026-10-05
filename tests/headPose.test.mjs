import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraRotation } from '../src/lib/xr/avatar/headPose.ts';

const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test('a headset camera sends its own quaternion', () => {
	const camera = { rotationQuaternion: { asArray: () => [0.1, 0.2, 0.3, 0.9] } };
	assert.deepEqual(cameraRotation(camera), [0.1, 0.2, 0.3, 0.9]);
});

test('a desktop camera, turned by Euler angles, sends the rotation they make (not an identity)', () => {
	const yawed = cameraRotation({ rotationQuaternion: null, rotation: { x: 0, y: Math.PI / 2, z: 0 } });
	assert.ok(near(yawed, [0, Math.SQRT1_2, 0, Math.SQRT1_2]), `got ${yawed}`);
	const pitched = cameraRotation({ rotationQuaternion: null, rotation: { x: Math.PI / 2, y: 0, z: 0 } });
	assert.ok(near(pitched, [Math.SQRT1_2, 0, 0, Math.SQRT1_2]), `got ${pitched}`);
});

test('a camera with no rotation at all looks straight ahead', () => {
	assert.deepEqual(cameraRotation({}), [0, 0, 0, 1]);
});
