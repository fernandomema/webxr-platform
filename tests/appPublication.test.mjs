import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicationFor } from '../packages/engine/src/xr/appPublication.ts';

test('a world published on Kithin keeps its own saved data, whatever app opens it', () => {
	assert.deepEqual(publicationFor({ kind: 'published', worldId: 'w1', revisionId: 'r1' }, 'app1'), { publicationId: 'w1', revisionId: 'r1' });
	assert.deepEqual(publicationFor({ kind: 'published', worldId: 'w1' }, null), { publicationId: 'w1', revisionId: null });
});

test('every other world of a game takes the game’s app, so all its levels share one set', () => {
	assert.deepEqual(publicationFor(undefined, 'app1'), { publicationId: 'app1', revisionId: null });
	assert.deepEqual(publicationFor({ kind: 'inventory', adapterId: 'local', itemId: 'x' }, 'app1'), { publicationId: 'app1', revisionId: null });
});

test('without an app or a publication there is nothing to save to', () => {
	assert.equal(publicationFor(undefined, null), null);
});
