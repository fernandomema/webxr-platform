import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The engine is a package other projects build on: it must not reach into the site that happens to host it, and everything it
// asks of a platform goes through platformFetch, so a game on another origin can point it somewhere else.
const root = new URL('../packages/engine/src/', import.meta.url).pathname;

async function sources(dir = root) {
	const found = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await sources(path)));
		else if (/\.(ts|svelte)$/.test(entry.name)) found.push(path);
	}
	return found;
}
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no file of the engine imports from the site (the $lib, $app and $env aliases, or src/lib)', async () => {
	for (const file of await sources()) {
		const text = strip(await readFile(file, 'utf8'));
		assert.doesNotMatch(text, /from\s+['"]\$(lib|app|env)\b/, `${file} imports from the site`);
		assert.doesNotMatch(text, /from\s+['"][^'"]*\/src\/lib\//, `${file} reaches into src/lib`);
		assert.doesNotMatch(text, /from\s+['"][^'"]*\/content\/templates\//, `${file} imports the site's worlds`);
		assert.doesNotMatch(text, /import\([^)]*['"]\$lib/, `${file} imports from the site`);
	}
});

test('every request to the platform goes through platformFetch', async () => {
	for (const file of await sources()) {
		if (file.endsWith('platform/config.ts')) continue;
		const text = strip(await readFile(file, 'utf8'));
		assert.doesNotMatch(text, /(?<![.\w])fetch\(\s*[`'"]\/(?!\/)/, `${file} fetches a path of its own origin directly`);
	}
});

test('the engine ships nothing of the site: no built-in worlds, no site pages', async () => {
	for (const file of await sources()) {
		const text = strip(await readFile(file, 'utf8'));
		assert.doesNotMatch(text, /getBuiltinWorld|BUILTIN_WORLDS/, `${file} knows the site's worlds`);
	}
});
