#!/usr/bin/env node
// Lists the files of a game's content folder in a bundle.json the engine can load (see loadBundle):
//   kithin-engine-bundle <folder> [--out <folder>/bundle.json]
// The folder holds `worlds/*.json` (world packages) and any other files (models, pictures, sounds), which are found by the
// SHA-256 of their bytes: the content address the scenes use to name them.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const folder = resolve(args.find((arg) => !arg.startsWith('--')) ?? '.');
const outIndex = args.indexOf('--out');
const out = resolve(outIndex >= 0 ? args[outIndex + 1] : join(folder, 'bundle.json'));

function* walk(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) yield* walk(path);
		else yield path;
	}
}

const url = (path) => relative(resolve(out, '..'), path).split(sep).join('/');
const manifest = { formatVersion: 1, assets: {}, worlds: [] };
for (const path of [...walk(folder)].sort()) {
	if (resolve(path) === out) continue;
	const inWorlds = relative(folder, path).split(sep)[0] === 'worlds';
	if (inWorlds && extname(path) === '.json') {
		const world = JSON.parse(readFileSync(path, 'utf8'));
		if (world.formatVersion !== 1 || !Array.isArray(world.scene)) throw new Error(`${path} is not a world package`);
		const id = basename(path, '.json');
		manifest.worlds.push({ id, name: world.name ?? id, ...(world.description ? { description: world.description } : {}), url: url(path) });
	} else if (statSync(path).isFile()) {
		manifest.assets[`sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`] = url(path);
	}
}
if (manifest.worlds.length > 0) manifest.home = manifest.worlds[0].id;
writeFileSync(out, JSON.stringify(manifest, null, '\t') + '\n');
console.log(`${out}: ${Object.keys(manifest.assets).length} files, ${manifest.worlds.length} worlds`);
