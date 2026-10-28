import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AssetId } from './ref.ts';

/**
 * For the scripts that build a game's worlds (Node): the asset id of a file of its content folder, by path. The id is the hash of the
 * file's bytes, so nobody writes one by hand, and it is always the file's present one (it is read again when the file changes).
 */
export function contentAssetId(path: string, folder = join(process.cwd(), 'static/content')): AssetId {
	const file = resolve(folder, path);
	if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`The content folder has no file "${path}" (looked in ${resolve(folder)})`);
	return hashedFile(file);
}

/** The asset id of a file if it exists, else null: for what may not have been made yet (a bake). */
export function contentAssetIdIfPresent(path: string, folder = join(process.cwd(), 'static/content')): AssetId | null {
	const file = resolve(folder, path);
	return existsSync(file) && statSync(file).isFile() ? hashedFile(file) : null;
}

const cache = new Map<string, { mtimeMs: number; size: number; id: AssetId }>();

function hashedFile(file: string): AssetId {
	const stat = statSync(file);
	const known = cache.get(file);
	if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) return known.id;
	const id = `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}` as AssetId;
	cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, id });
	return id;
}
