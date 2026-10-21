import assert from 'node:assert/strict';
import test from 'node:test';
import { hasIcons, layoutRichText, parseRichText } from '../src/lib/xr/richText.ts';

const measure = (text) => text.length * 10;
const layout = (text, over = {}) => layoutRichText(parseRichText(text), { width: 400, fontSize: 20, align: 'left', measure, ...over });
const shape = (result) => result.lines.map((line) => line.placements.map((p) => (p.item.kind === 'icon' ? `<${p.item.name}>` : p.item.text)).join(' '));

test('a text with no pictures is words, and one with pictures says so', () => {
	assert.equal(hasIcons('Just words'), false);
	assert.equal(hasIcons('Press [[keyboard_tab]]'), true);
	assert.equal(hasIcons('[[Bad Name]] and [x]'), false);
	assert.equal(hasIcons(undefined), false);
	assert.deepEqual(parseRichText('a b').map((item) => item.text), ['a', 'b']);
});

test('pictures go where they are written, between the words, and keep to the letters they touch', () => {
	const items = parseRichText('Move with [[a]][[b]]. Press [[c]] now');
	assert.deepEqual(items.map((item) => (item.kind === 'icon' ? `<${item.name}>` : item.text)), ['Move', 'with', '<a>', '<b>', '.', 'Press', '<c>', 'now']);
	assert.deepEqual(items.map((item) => item.spaceBefore), [false, true, true, false, false, true, true, true]);
});

test('lines break at the width, and what is written against a picture never starts a line alone', () => {
	assert.deepEqual(shape(layout('one two three four five six', { width: 120 })), ['one two', 'three four', 'five six']);
	assert.deepEqual(shape(layout('click [[mouse_left]]. Then more', { width: 130 })), ['click <mouse_left> .', 'Then more']);
	const tight = layout('abc [[x]].', { width: 62 });
	assert.deepEqual(shape(tight), ['abc', '<x> .'], 'the full stop goes with its picture');
});

test('a new line starts where the text says', () => {
	assert.deepEqual(shape(layout('first line\nsecond [[k]] line')), ['first line', 'second <k> line']);
	assert.deepEqual(shape(layout('a\n\nb')), ['a', '', 'b']);
});

test('a line with a picture is as tall as the picture, and the others as a line of letters', () => {
	const result = layout('words\nand [[k]] here', { iconSize: 40, lineHeight: 25 });
	assert.deepEqual(result.lines.map((line) => line.height), [25, 40]);
	assert.equal(result.height, 65);
	assert.equal(result.iconSize, 40);
	assert.equal(layout('x', { fontSize: 20 }).iconSize, 26, 'a picture is a little bigger than a letter by default');
});

test('words are separated by a space and pictures take their own size', () => {
	const result = layout('ab [[k]] cd', { iconSize: 30 });
	const [ab, k, cd] = result.lines[0].placements;
	assert.deepEqual([ab.x, ab.width], [0, 20]);
	assert.equal(k.gap, 10);
	assert.deepEqual([k.x, k.width], [30, 40]);
	assert.deepEqual([cd.x, cd.gap], [70, 10]);
});

test('text can sit on the left, in the middle or on the right of its box', () => {
	const at = (align) => layout('ab cd', { width: 200, align }).lines[0].placements[0].x;
	assert.equal(at('left'), 0);
	assert.equal(at('center'), (200 - 50) / 2);
	assert.equal(at('right'), 200 - 50);
});

test('a word wider than the box is kept whole on a line of its own', () => {
	assert.deepEqual(shape(layout('short enormouslylongword end', { width: 100 })), ['short', 'enormouslylongword', 'end']);
});

test('empty text is one empty line', () => {
	const result = layout('');
	assert.equal(result.lines.length, 1);
	assert.equal(result.lines[0].placements.length, 0);
});
