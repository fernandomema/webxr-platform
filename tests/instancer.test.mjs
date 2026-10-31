import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSlot } from '../packages/engine/src/ecs/types.ts';
import { validateExternalTree } from '../packages/engine/src/inventory/external.ts';
import { applyParams, findParams } from '../packages/engine/src/inventory/params.ts';
import { setupLoader } from '../packages/engine/src/xr/loaderRuntime.ts';
import { validateWorldScene } from '../packages/engine/src/worlds/package.ts';

const record = () => [
	createSlot({
		id: 'disc', name: 'Disc',
		components: [
			{ type: 'recordDisc', title: 'Untitled', author: '', labelColor: '#222222' },
			{
				type: 'params',
				params: [
					{ name: 'title', kind: 'text', default: 'Untitled' },
					{ name: 'cover', kind: 'url' },
					{ name: 'tint', kind: 'color', default: '#222222' },
					{ name: 'bad name', kind: 'text' }
				],
				bindings: [
					{ param: 'title', slot: 'disc', component: 'recordDisc', field: 'title' },
					{ param: 'cover', slot: 'disc', component: 'recordDisc', field: 'labelImage' },
					{ param: 'tint', slot: 'disc', component: 'recordDisc', field: 'labelColor' },
					{ param: 'title', slot: 'gone', component: 'recordDisc', field: 'title' },
					{ param: 'title', slot: 'disc', component: 'recordDisc', field: '__proto__' }
				]
			}
		]
	})
];
const disc = (tree) => tree[0].components.find((c) => c.type === 'recordDisc');

test('values fill the bound fields, and what does not fit falls back to the default', () => {
	const out = applyParams(record(), { title: 'Song', cover: 'https://x/c.png', tint: 'red' });
	assert.equal(disc(out.tree).title, 'Song');
	assert.equal(disc(out.tree).labelImage, 'https://x/c.png');
	assert.equal(disc(out.tree).labelColor, '#222222', 'a colour that is not one uses the default');
	assert.deepEqual(out.values, { title: 'Song', cover: 'https://x/c.png', tint: '#222222' });
	assert.equal(disc(record()).title, 'Untitled', 'the object given is not changed');
	assert.equal(findParams(record()).params.length, 3, 'a badly named parameter is dropped');
	assert.equal(findParams(record()).bindings.length, 4, 'bindings of unknown slots stay but do nothing; reserved fields are dropped');
});

test('an object without parameters is built as it is', () => {
	const plain = [createSlot({ id: 'a', name: 'a' })];
	assert.equal(applyParams(plain, { x: 1 }).tree, plain);
});

test('an instancer builds with its values, tells the host, and builds again when a value changes', async () => {
	const built = [];
	const loaded = [];
	const host = {
		isHost: () => true, isEnabled: () => true, ancestors: () => [],
		resolve: async () => ({ slots: record() }),
		load: (owner, slots) => { loaded.push(slots); return true; },
		unload: () => {},
		built: (owner, info) => built.push(info)
	};
	const binding = setupLoader('shelf', { type: 'instancer', adapter: 'cloud', id: 'rec', values: { title: 'One' } }, host);
	binding.tick();
	await new Promise((r) => setTimeout(r, 0));
	assert.equal(disc(loaded[0]).title, 'One');
	assert.deepEqual(built[0].slotIds, ['shelf::disc']);
	assert.equal(built[0].values.title, 'One');
	binding.sync({ type: 'instancer', adapter: 'cloud', id: 'rec', values: { title: 'Two' } });
	binding.tick();
	await new Promise((r) => setTimeout(r, 0));
	assert.equal(disc(loaded[1]).title, 'Two');
	binding.dispose();
});

test('a world may store an instancer, but not odd values', () => {
	const world = (values) => [createSlot({ id: 'i', name: 'i', components: [{ type: 'instancer', adapter: 'cloud', id: 'x', values }] })];
	validateWorldScene(world({ title: 'a', n: 1, on: true }));
	for (const bad of [[1], { a: {} }, { a: NaN }, { a: 'x'.repeat(4001) }]) assert.throws(() => validateWorldScene(world(bad)), /instancer/);
});

test('the parametric disc takes its title, cover, colour and audio wherever the disc shows them', async () => {
	const { buildParametricDisc } = await import('../src/lib/content/templates/recordDisc.ts');
	const { validateExternalTree } = await import('../packages/engine/src/inventory/external.ts');
	const tree = validateExternalTree(buildParametricDisc('d'));
	const { tree: out } = applyParams(tree, { title: 'Song', author: 'Band', color: '#ff0000', cover: 'https://x/c.png', audio: 'https://x/a.mp3' });
	const get = (id, type) => out.find((s) => s.id === id).components.find((c) => c.type === type);
	assert.equal(get('d', 'recordDisc').title, 'Song');
	assert.equal(get('d-label-text', 'textDisplay').title, 'Song');
	assert.deepEqual(get('d-label-text', 'textDisplay').lines, ['Band']);
	assert.equal(get('d-rim', 'meshRenderer').color, '#ff0000');
	assert.equal(get('d-label-picture', 'uiElement').src, 'https://x/c.png');
	assert.deepEqual(get('d', 'audioPlayer').source, { kind: 'url', url: 'https://x/a.mp3' });
	assert.equal(get('d', 'audioPlayer').loop, true, 'the rest of the player is kept');
	const plain = applyParams(tree, {}).tree;
	assert.equal(plain.find((s) => s.id === 'd').components.find((c) => c.type === 'recordDisc').title, 'Untitled');
});

test('the instax print takes its photo, layout and caption, and a camera photo fits as a value', async () => {
	const { buildInstaxPhoto } = await import('../src/lib/content/templates/instaxPhoto.ts');
	const { validateExternalTree } = await import('../packages/engine/src/inventory/external.ts');
	const photo = 'data:image/jpeg;base64,' + 'A'.repeat(100_000);
	const { tree } = applyParams(validateExternalTree(buildInstaxPhoto('i')), { photo, layout: 'sbs', caption: '2026-10-30' });
	const picture = tree.find((s) => s.id === 'i-picture').components.find((c) => c.type === 'stereoImage');
	assert.deepEqual([picture.source, picture.layout], [{ kind: 'url', url: photo }, 'sbs']);
	assert.deepEqual(tree.find((s) => s.id === 'i-caption').components.find((c) => c.type === 'textDisplay').lines, ['2026-10-30']);
	const world = (source, layout) => [createSlot({ id: 'p', name: 'p', components: [{ type: 'stereoImage', source, layout }] })];
	validateWorldScene(world({ kind: 'url', url: photo }, 'sbs'));
	assert.throws(() => validateWorldScene(world({ kind: 'url', url: 'x'.repeat(2049) }, 'mono')), /stereo/);
	assert.throws(() => validateWorldScene(world({ kind: 'url', url: 'a' }, 'diagonal')), /stereo/);
	assert.equal(applyParams(validateExternalTree(buildInstaxPhoto('i')), { photo: 'data:image/jpeg;base64,' + 'A'.repeat(400_000) }).values.photo, '', 'a print too large is not taken');
});

test('the print is not squashed: the picture is square and the caption as wide, whatever the card is', async () => {
	const { buildInstaxPhoto } = await import('../src/lib/content/templates/instaxPhoto.ts');
	const slots = buildInstaxPhoto('i');
	const root = slots[0];
	// A child is turned to lie flat (its x runs along the card's -x, its y along the card's -z) and then stretched by the card's scale.
	const extent = (slot) => ({ across: slot.scale[0] * root.scale[0], down: slot.scale[1] * root.scale[2] });
	const picture = extent(slots.find((s) => s.id === 'i-picture'));
	const caption = extent(slots.find((s) => s.id === 'i-caption'));
	assert.ok(Math.abs(picture.across - picture.down) < 1e-3, `square: ${picture.across} x ${picture.down}`);
	assert.ok(Math.abs(caption.across - picture.across) < 1e-3, 'the caption is as wide as the picture');
	assert.ok(picture.across < root.scale[0] && picture.down + caption.down < root.scale[2], 'both fit on the card');
});

test('a spatial photo keeps the layout and the depth is spread over what the photo holds', async () => {
	const { encodeDepth } = await import('../packages/engine/src/xr/depthPhoto.ts');
	const rgba = (values) => Float32Array.from(values.flatMap((v) => [v, v, v, 1]));
	// 2 x 2, bottom row first: a near thing, a far thing, nothing, and a middle one.
	const out = encodeDepth(rgba([0.1, 0.5, 1, 0.2]), 2, 2);
	const grey = (row, column) => out[(row * 2 + column) * 4];
	assert.equal(grey(1, 0), 255, 'the nearest is white');
	assert.equal(grey(1, 1), 0, 'the farthest that was seen is black');
	assert.equal(grey(0, 0), 0, 'what the camera saw nothing of is as far as it gets');
	assert.ok(grey(0, 1) > 0 && grey(0, 1) < 255, 'the one between is between');
	assert.ok(Math.abs(grey(0, 1) - 145) <= 2, 'spread by the logarithm of the distance: twice as far is the same step anywhere');
	assert.equal(encodeDepth(rgba([1, 1, 1, 1]), 2, 2)[0], 0, 'a picture of nothing is flat');
	const { tree } = applyParams(validateExternalTree((await import('../src/lib/content/templates/instaxPhoto.ts')).buildInstaxPhoto('i')), { photo: 'data:image/jpeg;base64,AAAA', layout: 'depth', inset: 0.1667 });
	const spatial = tree.find((s) => s.id === 'i-picture').components.find((c) => c.type === 'stereoImage');
	assert.deepEqual([spatial.layout, spatial.inset], ['depth', 0.1667]);
	validateWorldScene([createSlot({ id: 'p', name: 'p', components: [{ type: 'stereoImage', source: { kind: 'url', url: 'a' }, layout: 'depth', relief: 0.1, inset: 0.2 }] })]);
	assert.throws(() => validateWorldScene([createSlot({ id: 'p', name: 'p', components: [{ type: 'stereoImage', source: { kind: 'url', url: 'a' }, layout: 'depth', inset: 0.9 }] })]), /stereo/);
	assert.throws(() => validateWorldScene([createSlot({ id: 'p', name: 'p', components: [{ type: 'stereoImage', source: { kind: 'url', url: 'a' }, layout: 'depth', relief: 2 }] })]), /stereo/);
});
