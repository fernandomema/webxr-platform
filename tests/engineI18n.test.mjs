import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { engineLocale, registerTranslations, setEngineLocale, translate, onEngineLocaleChange } from '../packages/engine/src/xr/i18n/locale.ts';
import es from '../packages/engine/src/xr/i18n/es.ts';

afterEach(() => setEngineLocale(null));

test('the engine speaks English unless told otherwise, and shows a text it has no translation for as written', () => {
	setEngineLocale('en');
	assert.equal(translate('Preparing your space'), 'Preparing your space');
	setEngineLocale('es');
	assert.equal(translate('Preparing your space'), 'Preparando tu espacio');
	assert.equal(translate('A text nobody translated'), 'A text nobody translated');
});

test('a language the engine has no translations for falls back to English, and region codes are reduced to the language', () => {
	setEngineLocale('es-MX');
	assert.equal(engineLocale(), 'es');
	setEngineLocale('xx');
	assert.equal(engineLocale(), 'en');
});

test('{name} in a text is replaced, and an unknown one is left as it is', () => {
	setEngineLocale('es');
	assert.equal(translate('{label} (equipped)', { label: 'Pistola' }), 'Pistola (equipado)');
	setEngineLocale('en');
	assert.equal(translate('{a} and {b}', { a: 1 }), '1 and {b}');
});

test('an app can add a language, and listeners hear about changes', () => {
	let heard = 0;
	const stop = onEngineLocaleChange(() => heard++);
	registerTranslations('fr', { Paused: 'En pause' });
	setEngineLocale('fr');
	assert.equal(translate('Paused'), 'En pause');
	assert.ok(heard >= 2);
	stop();
});

test('every Spanish text is written for a text the engine really shows', async () => {
	const { readFile } = await import('node:fs/promises');
	const root = new URL('../packages/engine/src/xr/', import.meta.url);
	const sources = (await Promise.all(['XRLaunchOverlay.svelte', 'interaction/desktop/DesktopHud.svelte', 'PlayShell.svelte'].map((file) => readFile(new URL(file, root), 'utf8')))).join('\n');
	for (const english of Object.keys(es)) assert.ok(sources.includes(`'${english}'`), `"${english}" is used`);
});
