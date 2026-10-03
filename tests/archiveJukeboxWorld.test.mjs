import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_JUKEBOX, buildArchiveJukebox, loadArchiveLogic } from '../src/lib/xr/templates/archiveJukebox.ts';
import { readFile } from 'node:fs/promises';
import { isBuiltinMeshId } from '../src/lib/assets/ref.ts';

const logic = loadArchiveLogic();
const tree = buildArchiveJukebox();
const byId = new Map(tree.map((slot) => [slot.id, slot]));
const find = (slot, type) => slot.components.find((c) => c.type === type);

test('the jukebox is a development world', async () => {
	const source = await readFile(new URL('../src/lib/xr/templates/builtinWorlds.ts', import.meta.url), 'utf8');
	assert.ok(/DEV_WORLD_IDS[^=]*=\s*\[([^\]]*)\]/.exec(source)[1].includes('archive-jukebox'));
	assert.match(source, /id: 'archive-jukebox'/);
});

test('the scene is valid: unique ids, known parents, built-in meshes', () => {
	assert.equal(byId.size, tree.length);
	for (const slot of tree) {
		if (slot.parentId !== null) assert.ok(byId.has(slot.parentId), `${slot.id} has its parent`);
		const mesh = find(slot, 'meshRenderer');
		if (mesh) assert.ok(mesh.meshRef.kind === 'builtin' && isBuiltinMeshId(mesh.meshRef.id));
	}
	assert.ok(find(byId.get(ARCHIVE_JUKEBOX.panelId), 'codeBlock'));
	assert.equal(tree.filter((slot) => slot.id.startsWith('aj-row-')).length, ARCHIVE_JUKEBOX.rows);
});

test('the script compiles', () => {
	const { code } = find(byId.get(ARCHIVE_JUKEBOX.panelId), 'codeBlock');
	assert.doesNotThrow(() => new Function('ctx', `return (function () {${code}\n})();`));
});

test('search urls ask for audio and escape the query', () => {
	const url = new URL(logic.searchUrl('bach & "cello"', 2, 6));
	assert.equal(url.origin + url.pathname, 'https://archive.org/advancedsearch.php');
	assert.equal(url.searchParams.get('q'), '(bach & "cello") AND mediatype:audio');
	assert.equal(url.searchParams.get('page'), '2');
	assert.equal(url.searchParams.get('rows'), '6');
	assert.equal(new URL(logic.searchUrl('  ', 1, 6)).searchParams.get('q'), 'mediatype:audio');
});

test('search answers are read, whatever shape title and creator come in', () => {
	const { total, items } = logic.parseSearch({ response: { numFound: 40, docs: [{ identifier: 'a', title: ['A song'], creator: ['X', 'Y'] }, { identifier: 'b' }, { title: 'no id' }] } });
	assert.equal(total, 40);
	assert.deepEqual(items, [{ id: 'a', title: 'A song', creator: 'X' }, { id: 'b', title: 'b', creator: '' }]);
	assert.deepEqual(logic.parseSearch(null), { total: 0, items: [] });
});

test('an item lists its songs in one format, preferring MP3', () => {
	const files = logic.audioFiles({
		files: [
			{ name: 'b.flac', format: 'Flac', size: '100' },
			{ name: 'b.mp3', format: 'VBR MP3', size: '10' },
			{ name: 'a.mp3', format: 'VBR MP3', title: 'First', size: '10' },
			{ name: 'a_64kb.mp3', format: '64Kbps MP3' },
			{ name: 'cover.jpg', format: 'JPEG' },
			{ name: 'huge.mp3', format: 'VBR MP3', size: String(200 * 1024 * 1024) }
		]
	});
	assert.deepEqual(files.map((file) => [file.name, file.title]), [['a.mp3', 'First'], ['b.mp3', 'b']]);
	assert.deepEqual(logic.audioFiles({ files: [{ name: 'x.ogg', format: 'Ogg Vorbis' }, { name: 'x.flac', format: 'Flac' }] }).map((file) => file.name), ['x.ogg']);
	assert.deepEqual(logic.audioFiles({ files: [{ name: 'movie.mp4', format: 'MPEG4' }] }), []);
	assert.deepEqual(logic.audioFiles(undefined), []);
});

test('file urls go through the CORS host with every part escaped', () => {
	assert.equal(logic.fileUrl('my item', 'disc 1/Track #1.mp3'), 'https://cors.archive.org/cors/my%20item/disc%201/Track%20%231.mp3');
	assert.equal(logic.metadataUrl('a/b'), 'https://archive.org/metadata/a%2Fb');
});

test('pressing a song spawns a whole disc pointing at its file', async () => {
	const { code } = find(byId.get(ARCHIVE_JUKEBOX.panelId), 'codeBlock');
	const spawned = [];
	const fields = new Map();
	const meta = { files: [{ name: 'One "1".mp3', format: 'VBR MP3', title: 'One \\ "1"' }] };
	const ctx = {
		net: { fetchJson: async (url) => (url.includes('advancedsearch') ? { response: { numFound: 1, docs: [{ identifier: 'item-1', title: 'Album', creator: 'Band' }] } } : meta) },
		world: { spawn: (slot) => spawned.push(slot), setComponentField: (id, type, field, value) => fields.set(`${id}.${field}`, value) }
	};
	const handlers = new Function('ctx', `return (function () {${code}\n})();`)(ctx);
	handlers.onUIEvent({ type: 'press', slotId: ARCHIVE_JUKEBOX.searchId });
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(fields.get('aj-row-0.visible'), true);
	assert.equal(fields.get('aj-row-1.visible'), false);
	assert.match(fields.get('aj-row-0.text'), /Album/);
	handlers.onUIEvent({ type: 'press', slotId: 'aj-row-0' });
	await new Promise((resolve) => setTimeout(resolve, 5));
	const root = spawned.find((slot) => slot.parentId === null);
	assert.ok(root && find(root, 'insertable') && find(root, 'grabbable'));
	assert.equal(find(root, 'audioPlayer').source.url, 'https://cors.archive.org/cors/item-1/One%20%221%22.mp3');
	assert.equal(find(root, 'recordDisc').title, 'One \\ "1"');
	assert.equal(spawned.length, 10);
	assert.ok(spawned.every((slot) => slot.id.startsWith('aj-disc-') && (slot.parentId === null || slot.parentId === root.id)));
	assert.equal(new Set(spawned.map((slot) => slot.id)).size, spawned.length);
	assert.ok(!JSON.stringify(spawned).includes('__'), 'no token is left');
});
