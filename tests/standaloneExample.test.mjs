import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWorldPackage } from '../packages/engine/src/worlds/package.ts';

// examples/standalone-game is the proof that a game can be built on the package with static files only.
const content = new URL('../examples/standalone-game/static/content/', import.meta.url).pathname;

test('the example game’s world is a valid world package', () => {
	validateWorldPackage(JSON.parse(readFileSync(join(content, 'worlds/hello.json'), 'utf8')));
});

test('the bundle tool lists the example game’s world', () => {
	const folder = mkdtempSync(join(tmpdir(), 'example-'));
	cpSync(content, folder, { recursive: true });
	execFileSync('node', [new URL('../packages/engine/bin/bundle.mjs', import.meta.url).pathname, folder]);
	const manifest = JSON.parse(readFileSync(join(folder, 'bundle.json'), 'utf8'));
	assert.deepEqual(manifest.worlds.map((world) => world.id), ['hello']);
	assert.equal(manifest.home, 'hello');
});
