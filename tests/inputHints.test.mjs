import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from '@babylonjs/core';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { INPUT_HINT_NAMES, INPUT_ICON_NAMES, iconsAsWords, inputHint, inputIconUrl, resolveInputHints } from '../src/lib/xr/inputHints.ts';
import { plainUiText, uiText } from '../src/lib/xr/uiLocale.ts';
import { yawFacing } from '../src/lib/xr/ui/panelFacing.ts';

test('a text shows the controls of the device in hand, as pictures, in the language of the reader', () => {
	const text = 'Press {dash} → Worlds. To pick it up, {grab}.';
	assert.equal(resolveInputHints(text, 'en', 'desktop'), 'Press [[keyboard_tab]] → Worlds. To pick it up, press [[keyboard_e]].');
	assert.equal(resolveInputHints(text, 'en', 'xr'), 'Press [[quest_button_menu]] → Worlds. To pick it up, squeeze [[quest_grip_right]].');
	assert.equal(resolveInputHints('Pulsa {dash}.', 'es', 'xr'), 'Pulsa [[quest_button_menu]].');
	assert.equal(resolveInputHints('Pulsa {dash}.', 'es', 'desktop'), 'Pulsa [[keyboard_tab]].');
	assert.equal(resolveInputHints('Move with {move}', 'en', 'desktop'), 'Move with [[keyboard_w]][[keyboard_a]][[keyboard_s]][[keyboard_d]]');
	assert.equal(resolveInputHints('{use}', 'fr', 'xr'), 'pull [[quest_trigger_right]]', 'a language it does not have reads English');
});

test('a place that cannot draw pictures gets their names in words', () => {
	assert.equal(iconsAsWords('Press [[keyboard_tab]] or [[quest_button_menu]]'), 'Press [Tab] or [menu button]');
	assert.equal(iconsAsWords('No pictures'), 'No pictures');
	assert.equal(iconsAsWords('[[unknown_picture]]'), '[[unknown_picture]]');
	const element = { text: 'Press {dash}', translations: { es: { text: 'Pulsa {dash}' } } };
	assert.equal(plainUiText(element, { locale: 'es', device: 'xr' }), 'Pulsa [menu button]');
});

test('every picture a hint can draw is a file, and every file of the pack that is used is credited', async () => {
	for (const name of INPUT_ICON_NAMES) assert.ok(existsSync(new URL(`../static${inputIconUrl(name)}`, import.meta.url)), `${name}.png exists`);
	const used = new Set();
	for (const name of INPUT_HINT_NAMES) for (const device of ['desktop', 'xr']) for (const locale of ['en', 'es']) for (const [, icon] of inputHint(name, device, locale).matchAll(/\[\[([a-z0-9_]+)\]\]/g)) used.add(icon);
	for (const icon of used) assert.ok(INPUT_ICON_NAMES.includes(icon), `${icon} is a known picture`);
	assert.match(await readFile(new URL('../static/assets/inputs/LICENSE.txt', import.meta.url), 'utf8'), /Creative Commons Zero/);
});

test('what is not a known control is left alone', () => {
	assert.equal(resolveInputHints('No hints here', 'en', 'xr'), 'No hints here');
	assert.equal(resolveInputHints('Keep {this} and {DASH} and {}', 'en', 'xr'), 'Keep {this} and {DASH} and {}');
	assert.equal(inputHint('nope', 'xr', 'en'), undefined);
});

test('every control has a word for each device in both languages, and the two devices differ', () => {
	for (const name of INPUT_HINT_NAMES) {
		for (const locale of ['en', 'es']) {
			const desktop = inputHint(name, 'desktop', locale);
			const xr = inputHint(name, 'xr', locale);
			assert.ok(desktop && xr, `${name} in ${locale}`);
			assert.notEqual(desktop, xr, `${name} reads differently on a computer and in a headset`);
			assert.match(desktop + xr, /\[\[[a-z0-9_]+\]\].*\[\[[a-z0-9_]+\]\]|\[\[[a-z0-9_]+\]\]/, `${name} is drawn as pictures`);
		}
	}
});

test('a UI text is translated first and then given the controls of the device', () => {
	const element = { text: 'Press {dash}', translations: { es: { text: 'Pulsa {dash}' } } };
	assert.equal(uiText(element, { locale: 'es', device: 'xr' }), 'Pulsa [[quest_button_menu]]');
	assert.equal(uiText(element, { locale: 'en', device: 'desktop' }), 'Press [[keyboard_tab]]');
	assert.equal(uiText(element, undefined), 'Press {dash}', 'without a context it is the text as written');
	assert.equal(uiText({}, { locale: 'en', device: 'xr' }), undefined);
});

/** Where the readable side (-Z) of a plane turned by `yaw` points. */
const readableSide = (yaw) => new Vector3(0, 0, -1).applyRotationQuaternion(Quaternion.FromEulerAngles(0, yaw, 0));

test('a panel turned to face a viewer shows them its readable side, wherever they stand', () => {
	for (const viewer of [{ x: 0, z: 5 }, { x: 0, z: -5 }, { x: 4, z: 0 }, { x: -4, z: 0 }, { x: 3, z: 3 }, { x: -2, z: -6 }, { x: 0.001, z: 0.2 }]) {
		const panel = { x: 1, z: 1 };
		const side = readableSide(yawFacing(panel, viewer));
		const toViewer = new Vector3(viewer.x - panel.x, 0, viewer.z - panel.z).normalize();
		assert.ok(Vector3.Dot(side, toViewer) > 0.999, `facing ${JSON.stringify(viewer)}`);
	}
});
