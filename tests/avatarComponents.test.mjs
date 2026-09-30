import test from 'node:test';
import assert from 'node:assert/strict';
import { componentSchema } from '../src/lib/studio/schema/components.ts';

test('avatar and boneAttach have studio schemas that create their own type', () => {
	assert.equal(componentSchema('avatar').create().type, 'avatar');
	assert.deepEqual(componentSchema('avatar').create().bones, {});
	assert.equal(componentSchema('boneAttach').create().type, 'boneAttach');
});
