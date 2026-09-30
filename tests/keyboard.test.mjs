import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutProblems, placeKeys, keyLabel, keyVariants } from '../src/lib/xr/keyboard/layout.ts';
import { initialEditorState, pressKey, pickCandidate, shownText, switchLayout } from '../src/lib/xr/keyboard/editor.ts';
import { registerComposer, EMPTY_COMPOSITION } from '../src/lib/xr/keyboard/composer.ts';

const load = (id) => JSON.parse(readFileSync(new URL(`../src/lib/xr/keyboard/layouts/${id}.json`, import.meta.url), 'utf8'));
const es = load('es');
const en = load('en');
const find = (layout, page, predicate) => layout.pages[page].flat().find(predicate);
const letter = (layout, c) => find(layout, layout.firstPage, (k) => k.text === c);
const action = (layout, name, page = layout.firstPage) => find(layout, page, (k) => k.action === name);

function typeAll(layout, keys, state = initialEditorState(layout)) {
	for (const key of keys) state = pressKey(state, layout, key).state;
	return state;
}

test('the shipped layouts are complete: every page exists, every key types or does something', () => {
	for (const layout of [es, en]) assert.deepEqual(layoutProblems(layout), [], layout.id);
	assert.ok(letter(es, 'ñ'), 'Spanish has ñ');
	for (const layout of [es, en]) {
		for (const name of ['backspace', 'enter', 'shift', 'space', 'layout', 'page', 'left', 'right']) assert.ok(action(layout, name), `${layout.id} has ${name}`);
	}
});

test('a broken layout is reported, not silently used', () => {
	const broken = { id: 'x', name: 'X', short: 'X', firstPage: 'nope', pages: { a: [[{ label: '?' }], [{ action: 'page', page: 'missing' }]] } };
	const problems = layoutProblems(broken);
	assert.ok(problems.some((p) => p.includes('first page')));
	assert.ok(problems.some((p) => p.includes('neither types')));
	assert.ok(problems.some((p) => p.includes('does not exist')));
});

test('keys are laid out in centred rows, wide keys taking more room', () => {
	const { keys, width, height } = placeKeys(es.pages.letters);
	assert.equal(height, es.pages.letters.length);
	const top = keys.filter((k) => k.row === 0);
	assert.ok(Math.abs(top[0].x - top[0].width / 2 + width / 2) < 1e-9 || top[0].x - top[0].width / 2 >= -width / 2);
	const space = keys.find((k) => k.key.action === 'space');
	assert.ok(space.width > 1);
	// No two keys of a row overlap.
	for (let r = 0; r < height; r++) {
		const row = keys.filter((k) => k.row === r).sort((a, b) => a.x - b.x);
		for (let i = 1; i < row.length; i++) assert.ok(row[i].x - row[i].width / 2 >= row[i - 1].x + row[i - 1].width / 2 - 1e-9);
	}
});

test('typing, deleting and the three states of shift', () => {
	const shift = action(es, 'shift');
	let state = typeAll(es, [shift, letter(es, 'h'), letter(es, 'o'), letter(es, 'l'), letter(es, 'a')]);
	assert.equal(shownText(state), 'Hola', 'one tap of shift capitalises one letter');
	state = typeAll(es, [action(es, 'backspace')], state);
	assert.equal(shownText(state), 'Hol');
	state = typeAll(es, [shift, shift, letter(es, 'a'), letter(es, 'ñ')], state);
	assert.equal(shownText(state), 'HolAÑ', 'two taps lock it');
	assert.equal(state.shift, 'locked');
	state = typeAll(es, [shift, letter(es, 'o')], state);
	assert.equal(shownText(state), 'HolAÑo', 'a third tap releases it');
	assert.equal(keyLabel(letter(es, 'ñ'), true), 'Ñ');
});

test('holding a key offers its variants, in the case shift asks for', () => {
	const e = letter(es, 'e');
	assert.deepEqual(keyVariants(e, false).slice(0, 2), ['é', 'è']);
	assert.deepEqual(keyVariants(e, true).slice(0, 1), ['É']);
	let state = pressKey(initialEditorState(es), es, e, 'é').state;
	state = pressKey({ ...state, shift: 'once' }, es, e, 'é').state;
	assert.equal(shownText(state), 'éÉ');
});

test('enter submits, close closes, the layout key asks for the next layout, and deleting handles any character', () => {
	assert.equal(pressKey(initialEditorState(es), es, action(es, 'enter')).effect, 'submit');
	assert.equal(pressKey(initialEditorState(es), es, { action: 'close' }).effect, 'close');
	assert.equal(pressKey(initialEditorState(es), es, action(es, 'layout')).effect, 'next-layout');
	const state = pressKey(initialEditorState(es, 'a😀'), es, action(es, 'backspace')).state;
	assert.equal(state.text, 'a', 'an emoji is one character, not two halves');
	assert.equal(shownText(pressKey(initialEditorState(es), es, action(es, 'space')).state), ' ');
});

test('the text never grows past maxLength', () => {
	const state = typeAll(es, Array(5).fill(letter(es, 'x')), initialEditorState(es, '', 3));
	assert.equal(state.text, 'xxx');
});

test('the page keys switch between letters and symbols', () => {
	const toSymbols = action(es, 'page');
	let state = pressKey(initialEditorState(es), es, toSymbols).state;
	assert.equal(state.page, 'symbols');
	state = pressKey(state, es, action(es, 'page', 'symbols')).state;
	assert.equal(state.page, 'letters');
});

test('a composing input method (like pinyin) plugs in without changing the keyboard', () => {
	// A toy composer: letters build a syllable, 'ni' offers 你 and 尼; space or a pick commits.
	registerComposer({
		id: 'toy',
		type: (c, text) => (text === ' ' ? { commit: c.candidates[0] ?? c.preedit, composition: EMPTY_COMPOSITION } : { commit: '', composition: { preedit: c.preedit + text, candidates: c.preedit + text === 'ni' ? ['你', '尼'] : [] } }),
		backspace: (c) => (c.preedit ? { handled: true, composition: { preedit: c.preedit.slice(0, -1), candidates: [] } } : { handled: false, composition: c }),
		pick: (c, i) => ({ commit: c.candidates[i] ?? '', composition: EMPTY_COMPOSITION }),
		flush: (c) => ({ commit: c.preedit, composition: EMPTY_COMPOSITION })
	});
	const toy = { ...es, id: 'toy', composer: 'toy' };
	let state = typeAll(toy, [letter(es, 'n'), letter(es, 'i')]);
	assert.equal(state.text, '');
	assert.equal(shownText(state), 'ni');
	assert.deepEqual(state.composition.candidates, ['你', '尼']);
	state = pickCandidate(state, toy, 1).state;
	assert.equal(state.text, '尼');
	state = typeAll(toy, [letter(es, 'n'), action(es, 'backspace'), action(es, 'backspace')], state);
	assert.equal(shownText(state), '', 'backspace first shortens the syllable, then deletes text');
	state = typeAll(toy, [letter(es, 'm')], state);
	assert.equal(switchLayout(state, toy, es).text, 'm', 'switching layout keeps what was being composed');
});

import { parseKeyboardPresence } from '../src/lib/xr/keyboard/presence.ts';

test('another player\'s keyboard is read off presence only when it is a sane pose and size', () => {
	const good = parseKeyboardPresence({ position: [1, 1.1, -0.4], rotation: [0, 0, 0, 2], width: 0.6, depth: 0.35 });
	assert.deepEqual(good.rotation, [0, 0, 0, 1], 'the rotation is normalised');
	assert.equal(parseKeyboardPresence(undefined), undefined);
	assert.equal(parseKeyboardPresence({ position: [1, 1, 'x'], rotation: [0, 0, 0, 1], width: 1, depth: 1 }), undefined);
	assert.equal(parseKeyboardPresence({ position: [1, 1, 1], rotation: [0, 0, 0, 0], width: 1, depth: 1 }), undefined);
	assert.equal(parseKeyboardPresence({ position: [1, 1, 1], rotation: [0, 0, 0, 1], width: 1e6, depth: -3 }).width, 1.5, 'an absurd size is clamped');
	// Nothing about the keys or the text can ride along.
	assert.deepEqual(Object.keys(parseKeyboardPresence({ position: [0, 0, 0], rotation: [0, 0, 0, 1], width: 0.5, depth: 0.3, text: 'secret' })).sort(), ['depth', 'position', 'rotation', 'width']);
});

test('the keyboard frame template has every part the keyboard fits, and a close key', () => {
	const frame = JSON.parse(readFileSync(new URL('../src/lib/xr/templates/keyboard.json', import.meta.url), 'utf8'));
	const byName = (name) => frame.find((slot) => slot.name === name);
	const root = frame.find((slot) => slot.parentId === null);
	assert.ok(root.components.some((c) => c.type === 'grabbable'), 'it can be picked up and moved');
	for (const name of ['Body', 'Keys', 'Preview', 'Close', 'Handle']) assert.equal(byName(name)?.parentId, root.id, `${name} hangs from the keyboard`);
	assert.equal(byName('Close').components.find((c) => c.type === 'keyboardKey').key.action, 'close');
	assert.equal(new Set(frame.map((slot) => slot.id)).size, frame.length);
});

test('the arrows move the cursor, and typing and deleting happen where it is', () => {
	const left = action(es, 'left'), right = action(es, 'right'), back = action(es, 'backspace');
	let state = typeAll(es, [letter(es, 'c'), letter(es, 'a'), letter(es, 'a')]);
	state = typeAll(es, [left, left, letter(es, 's')], state);
	assert.equal(shownText(state), 'csaa');
	assert.equal(state.cursor, 2);
	state = typeAll(es, [back], state);
	assert.equal(shownText(state), 'caa', 'backspace deletes the character before the cursor');
	state = typeAll(es, [right, right, right, right, letter(es, 'r')], state);
	assert.equal(shownText(state), 'caar', 'the cursor stops at the end');
	state = typeAll(es, Array(9).fill(left), state);
	assert.equal(state.cursor, 0, 'and at the start');
	assert.equal(shownText(typeAll(es, [back], state)), 'caar', 'nothing to delete before the start');
	assert.equal(initialEditorState(es, 'hola').cursor, 4, 'it starts at the end of the text it is given');
});

test('text typed in the middle still respects maxLength, and an unfinished composition settles before the cursor moves', () => {
	let state = initialEditorState(es, 'abc', 4);
	state = typeAll(es, [action(es, 'left'), letter(es, 'x'), letter(es, 'y')], state);
	assert.equal(state.text, 'abxc');
	const toy = { ...es, id: 'toy', composer: 'toy' };
	state = typeAll(toy, [letter(es, 'n'), letter(es, 'i')], initialEditorState(toy, 'ab'));
	state = typeAll(toy, [action(es, 'left')], state);
	assert.equal(state.text, 'abni');
	assert.equal(state.composition.preedit, '');
	assert.equal(state.cursor, 3);
});
