import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { readGlbBounds } from '../packages/engine/src/assets/glbBounds.ts';

/** A glb with a JSON chunk only, enough for the header. */
function glb(json) {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
	padded.set(text);
	const out = new Uint8Array(20 + padded.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
	view.setUint32(12, padded.length, true); view.setUint32(16, 0x4e4f534a, true);
	out.set(padded, 20);
	return out;
}
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} vs ${b}`));

test('the box a model fills is read from its header, through the node transforms, as the engine shows it', () => {
	const bytes = glb({
		scene: 0, scenes: [{ nodes: [0] }],
		nodes: [{ children: [1], translation: [10, 0, 0] }, { mesh: 0, scale: [2, 2, 2] }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
		accessors: [{ min: [-1, 0, -1], max: [1, 3, 2] }]
	});
	const b = readGlbBounds(bytes);
	near(b.min, [8, 0, -4]); near(b.max, [12, 6, 2]);
	near(b.size, [4, 6, 6]); near(b.center, [10, 3, -1]);
	const raw = readGlbBounds(bytes, { babylon: false });
	near(raw.min, [8, 0, -2]); near(raw.max, [12, 6, 4]);
});

test('what is not a glb, or has no geometry, is null; and every model of the repository is read', () => {
	assert.equal(readGlbBounds(new Uint8Array(40)), null);
	assert.equal(readGlbBounds(glb({ nodes: [], meshes: [] })), null);
	const folder = new URL('../examples/rounds-vr/static/content/models/', import.meta.url);
	for (const file of readdirSync(folder).filter((f) => f.endsWith('.glb'))) {
		const b = readGlbBounds(readFileSync(new URL(file, folder)));
		assert.ok(b && b.size.every((n) => n > 0), file);
	}
});
