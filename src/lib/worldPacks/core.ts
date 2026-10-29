/**
 * Local world packs: `worlds/<id>/world.ts` plus `worlds/<id>/assets/**`. Plain Node code, shared by the Vite plugin (dev server)
 * and the `npm run pack` command, so both see the same packs and the same asset ids.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

export const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** The folders of `root` that are packs: a valid id and a `world.ts`. */
export function listPackIds(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && PACK_ID_PATTERN.test(entry.name) && existsSync(join(root, entry.name, 'world.ts')))
		.map((entry) => entry.name)
		.sort();
}

const hashes = new Map<string, { stamp: string; id: string }>();

/** `sha256:<hex>` of a file's bytes: the id the engine gives that file as an asset. Remembered while the file does not change. */
export function assetIdOfFile(file: string): string {
	const stat = statSync(file);
	const stamp = `${stat.size}:${stat.mtimeMs}`;
	const known = hashes.get(file);
	if (known?.stamp === stamp) return known.id;
	const id = `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
	hashes.set(file, { stamp, id });
	return id;
}

function walk(dir: string, base = ''): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(join(dir, base), { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const path = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) found.push(...walk(dir, path));
		else if (entry.isFile()) found.push(path);
	}
	return found;
}

/** Every file under the pack's `assets/` folder: its path inside it (with `/`) and its asset id, in path order. */
export function scanPackAssets(packDir: string): Record<string, string> {
	const dir = join(packDir, 'assets');
	if (!existsSync(dir)) return {};
	const assets: Record<string, string> = {};
	for (const path of walk(dir).sort()) assets[path] = assetIdOfFile(join(dir, ...path.split('/')));
	return assets;
}

/** The text of the pack's `assets.ts`: typed paths, so the editor completes `asset('models/…')` and flags a path that does not exist. */
export function renderAssetsModule(assets: Record<string, string>): string {
	const rows = Object.entries(assets).map(([path, id]) => `\t${JSON.stringify(path)}: ${JSON.stringify(id)}`);
	return `// Generated from the files in ./assets by \`npm run pack -- sync\` and by the dev server. Do not edit.
import type { AssetId } from '@kithin/engine/assets/ref';

export const ASSETS = {${rows.length ? `\n${rows.join(',\n')}\n` : ''}} as const satisfies Record<string, AssetId>;

export type AssetPath = keyof typeof ASSETS;

/** The id a scene uses for the file at \`assets/<path>\`. */
export const asset = (path: AssetPath): AssetId => ASSETS[path];
`;
}

/** Rewrites the pack's `assets.ts` if the files changed. */
export function syncPackAssets(packDir: string): { changed: boolean; assets: Record<string, string> } {
	const assets = scanPackAssets(packDir);
	const file = join(packDir, 'assets.ts');
	const next = renderAssetsModule(assets);
	if (existsSync(file) && readFileSync(file, 'utf8') === next) return { changed: false, assets };
	writeFileSync(file, next);
	return { changed: true, assets };
}

/** The URL the dev server serves a pack's file at. */
export const packAssetUrl = (packId: string, path: string) => `/@packs/${packId}/assets/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Where the dev server maps a request under `/@packs` to, or null when it is not a file of a pack's `assets/` folder. */
export function resolvePackRequest(root: string, url: string): string | null {
	let parts: string[];
	try {
		parts = decodeURIComponent(url.split('?')[0]).split('/').filter(Boolean);
	} catch {
		return null;
	}
	if (parts.length < 3 || parts[1] !== 'assets' || !PACK_ID_PATTERN.test(parts[0])) return null;
	const base = join(root, parts[0], 'assets');
	const file = join(base, ...parts.slice(2));
	if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) return null;
	return file;
}

export function ensureDir(dir: string): string {
	mkdirSync(dir, { recursive: true });
	return dir;
}

type Table = Record<string, string>;

function readTable(file: string): Table {
	try {
		return JSON.parse(readFileSync(file, 'utf8')) as Table;
	} catch {
		return {};
	}
}

/** The cookie saved for a platform address (`worlds/.auth.json`, ignored by git), unless `KITHIN_COOKIE` says otherwise. */
export function readCookie(root: string, host: string, env: Record<string, string | undefined> = process.env): string | null {
	return env.KITHIN_COOKIE || readTable(join(root, '.auth.json'))[host] || null;
}

export function saveCookie(root: string, host: string, cookie: string): void {
	const file = join(root, '.auth.json');
	writeFileSync(file, `${JSON.stringify({ ...readTable(file), [host]: cookie }, null, '\t')}\n`, { mode: 0o600 });
}

/** The id a pack's world has on a platform (`worlds/<id>/publish.json`), so publishing again adds a revision instead of a second world. */
export function readPublishedId(packDir: string, host: string): string | null {
	return readTable(join(packDir, 'publish.json'))[host] || null;
}

export function savePublishedId(packDir: string, host: string, publishedId: string): void {
	const file = join(packDir, 'publish.json');
	writeFileSync(file, `${JSON.stringify({ ...readTable(file), [host]: publishedId }, null, '\t')}\n`);
}
