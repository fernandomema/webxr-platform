#!/usr/bin/env node
// Lists the files of a game's content folder in a bundle.json the engine can load (see loadBundle):
//   kithin-engine-bundle <folder> [--out <folder>/bundle.json]   (`kithin-game` does this itself, on every start and while it watches)
// The folder holds `worlds/*.json` (world packages) and any other files (models, pictures, sounds), which are found by the
// SHA-256 of their bytes: the content address the scenes use to name them.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function* walk(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) yield* walk(path);
		else yield path;
	}
}

/**
 * Lists a content folder in a bundle manifest and writes it to `out` (the folder's own `bundle.json` by default). Returns the manifest.
 * `names` gives every file's address relative to the folder and its content hash, so code that builds worlds (or loads them) can name a
 * file instead of carrying its hash: `bundle.names['models/rock.glb']`.
 */
export function buildBundle(folderPath, outPath) {
	const folder = resolve(folderPath);
	const out = resolve(outPath ?? join(folder, 'bundle.json'));
	const url = (path) => relative(resolve(out, '..'), path).split(sep).join('/');
	const manifest = { formatVersion: 1, assets: {}, names: {}, worlds: [] };
	for (const path of [...walk(folder)].sort()) {
		if (resolve(path) === out || basename(path) === '.gitignore') continue;
		const inWorlds = relative(folder, path).split(sep)[0] === 'worlds';
		if (inWorlds && extname(path) === '.json') {
			const world = JSON.parse(readFileSync(path, 'utf8'));
			if (world.formatVersion !== 1 || !Array.isArray(world.scene)) throw new Error(`${path} is not a world package`);
			const id = basename(path, '.json');
			manifest.worlds.push({ id, name: world.name ?? id, ...(world.description ? { description: world.description } : {}), url: url(path) });
		} else if (statSync(path).isFile()) {
			const hash = `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
			manifest.assets[hash] = url(path);
			manifest.names[relative(folder, path).split(sep).join('/')] = hash;
		}
	}
	if (manifest.worlds.length > 0) manifest.home = manifest.worlds[0].id;
	const text = JSON.stringify(manifest, null, '\t') + '\n';
	// Left alone when nothing changed, so that a watcher of the folder does not see its own work.
	if (!existsSync(out) || readFileSync(out, 'utf8') !== text) writeFileSync(out, text);
	return { manifest, out };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const outIndex = args.indexOf('--out');
	const { manifest, out } = buildBundle(args.find((arg) => !arg.startsWith('--')) ?? '.', outIndex >= 0 ? args[outIndex + 1] : undefined);
	console.log(`${out}: ${Object.keys(manifest.assets).length} files, ${manifest.worlds.length} worlds`);
}
