import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FOLDER_DEPTH, folderChain, isInventoryVisibility, isPubliclyReadable } from '../packages/engine/src/inventory/visibility.ts';

const folders = new Map([
	['root', { parentId: null, visibility: 'private' }],
	['shared', { parentId: 'root', visibility: 'public' }],
	['deep', { parentId: 'shared', visibility: 'private' }],
	['mine', { parentId: 'root', visibility: 'private' }]
]);

test('an item is private unless it or a folder above it is public', () => {
	assert.equal(isPubliclyReadable({}, []), false, 'no visibility set is private');
	assert.equal(isPubliclyReadable({ visibility: 'private' }, folderChain('mine', folders)), false);
	assert.equal(isPubliclyReadable({ visibility: 'public' }, folderChain('mine', folders)), true, 'public on the item itself');
	assert.equal(isPubliclyReadable({ visibility: 'private' }, folderChain('shared', folders)), true, 'directly in a public folder');
	assert.equal(isPubliclyReadable({}, folderChain('deep', folders)), true, 'a public folder makes its subfolders public too');
});

test('an item at the root has no folders above it', () => {
	assert.deepEqual(folderChain(null, folders), []);
	assert.equal(isPubliclyReadable({}, folderChain(null, folders)), false);
});

test('the chain goes nearest first, and ends at an unknown folder or a loop', () => {
	assert.deepEqual(folderChain('deep', folders).map((f) => f.parentId), ['shared', 'root', null]);
	assert.deepEqual(folderChain('gone', folders), []);
	const loop = new Map([['a', { parentId: 'b' }], ['b', { parentId: 'a' }]]);
	assert.equal(folderChain('a', loop).length, 2, 'each folder of a loop is visited once');
	const long = new Map(Array.from({ length: MAX_FOLDER_DEPTH + 20 }, (_, i) => [String(i), { parentId: String(i + 1) }]));
	assert.equal(folderChain('0', long).length, MAX_FOLDER_DEPTH);
});

test('only the two known visibilities are accepted', () => {
	assert.ok(isInventoryVisibility('private') && isInventoryVisibility('public'));
	for (const bad of ['', 'Public', 'unlisted', null, undefined, 1, {}]) assert.equal(isInventoryVisibility(bad), false);
});
