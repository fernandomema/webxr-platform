import { test } from 'node:test';
import assert from 'node:assert/strict';

// The surface draws with Babylon's GUI, which needs a page; what it draws is worked out by a function that does not.
const { textDisplayRows } = await import('../packages/engine/src/xr/textDisplaySurface.ts').catch(() => ({}));

test('a text display says its background, title and lines, each with its own colour and size', { skip: !textDisplayRows }, () => {
	const plain = textDisplayRows({ type: 'textDisplay', title: 'T', lines: ['a', 'b'] });
	assert.equal(plain.background, '#0f172a');
	assert.deepEqual(plain.rows.map((r) => [r.text, r.color, r.size]), [['T', '#facc15', 40], ['a', 'white', 30], ['b', 'white', 30]]);
	const styled = textDisplayRows({ type: 'textDisplay', title: 'T', lines: ['a', 'b', 'c'], color: '#111111', background: '#00000000', titleColor: '#ff0000', lineColor: '#00ff00', lineColors: ['#0000ff'], lineSizes: [2], scale: 2 }, 1);
	assert.equal(styled.background, '#00000000', 'background wins over color, and may be transparent');
	assert.deepEqual(styled.rows.map((r) => [r.text, r.color, r.size]), [['T', '#ff0000', 80], ['a', '#0000ff', 120], ['b', '#00ff00', 60], ['c', '#00ff00', 60]]);
});

const { autoTextScale } = await import('../packages/engine/src/xr/textDisplaySurface.ts').catch(() => ({}));

test('text with room to spare grows to fill its sign, and never shrinks below the standard size', { skip: !autoTextScale }, () => {
	const short = { type: 'textDisplay', lines: ['Bay 1'] };
	assert.ok(autoTextScale(short, 3, 1) > 3, 'one short line on a wide board is made much larger');
	assert.ok(autoTextScale(short, 3, 1) <= 4);
	const crowded = { type: 'textDisplay', title: 'T', lines: Array.from({ length: 12 }, (_, i) => `line number ${i} with some words`) };
	assert.equal(autoTextScale(crowded, 1, 1), 1, 'a sign that is full at the standard size keeps it');
	assert.ok(autoTextScale({ type: 'textDisplay', lines: ['x'.repeat(200)] }, 1, 1) >= 1);
});
