// What `kithin-game dev` does besides serving: noticing that something the page is made from changed, and saying so when what is being
// served is out of date. Plain functions over folders, so that they can be tested without a server.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** The newest modification time (ms) of the files under `folder` that matter to the page (sources, not caches), and which file it is. */
export function newestFile(folder, accept = (path) => /\.(ts|js|mjs|svelte|json|wasm)$/.test(path)) {
	let newest = { time: 0, file: null };
	const walk = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (accept(path)) {
				const time = statSync(path).mtimeMs;
				if (time > newest.time) newest = { time, file: path };
			}
		}
	};
	if (existsSync(folder)) walk(folder);
	return newest;
}

/**
 * Whether Vite's prebundled dependencies (its cache in the game's `node_modules/.vite`) were made before the engine's sources last
 * changed: it then serves an old engine until the cache is rebuilt (`kithin-game dev --force`). Returns the warning to show, or null.
 */
export function staleEngineCache({ root, engineRoot }) {
	const metadata = join(root, 'node_modules/.vite/deps/_metadata.json');
	if (!existsSync(metadata)) return null;
	const built = statSync(metadata).mtimeMs;
	const engine = newestFile(join(engineRoot, 'src'));
	if (engine.time <= built) return null;
	const file = relative(engineRoot, engine.file).split(sep).join('/');
	const minutes = Math.max(1, Math.round((engine.time - built) / 60000));
	return `The engine changed (${file}) ${minutes} min after Vite prebundled the game's dependencies, so the page may be running an older engine. Restart with "kithin-game dev --force" to rebuild them.`;
}

/** The `kithin` section of a game's package.json: `{ "world": { "script": "world", "watch": ["src/world"] } }`. */
export function readGameConfig(root) {
	const file = join(root, 'package.json');
	const pkg = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
	const world = pkg.kithin?.world;
	return {
		scripts: pkg.scripts ?? {},
		world: world ? { script: world.script ?? 'world', watch: world.watch ?? ['src/world'] } : null
	};
}

/** Runs `run` once after `delay` ms of quiet, then again if something changed while it ran. */
export function debounced(run, delay = 150) {
	let timer = null, running = false, again = false;
	const fire = async () => {
		timer = null;
		if (running) { again = true; return; }
		running = true;
		try { await run(); } finally { running = false; }
		if (again) { again = false; schedule(); }
	};
	const schedule = () => { clearTimeout(timer); timer = setTimeout(fire, delay); };
	return schedule;
}

/** Whether `file` is inside `folder` (and not the folder itself). */
const under = (file, folder) => {
	const path = relative(folder, file);
	return path !== '' && !path.startsWith('..') && !path.startsWith(sep) && !/^[a-zA-Z]:/.test(path);
};

/**
 * While `dev` runs: a change in the world's code builds the world again, a change in the content folder lists it again, and the page
 * reloads either way. `server` is Vite's dev server (`watcher` to listen on files, `ws` to tell the page); `buildWorld` returns whether it built.
 * Returns the function that handles one changed file, which a test can call directly.
 */
export function watchGame({ server, root, content, watch, buildWorld, bundleContent, log = console.log, delay = 150 }) {
	const reload = (why) => { log(`kithin-game: ${why}; reloading`); server.ws.send({ type: 'full-reload' }); };
	const rebuild = debounced(() => {
		if (buildWorld()) { bundleContent(); reload('the world changed'); }
		else log('kithin-game: the world did not build; the page keeps the last good one.');
	}, delay);
	const relist = debounced(() => { bundleContent(); reload('the content changed'); }, delay);
	const folders = watch.map((path) => resolve(root, path));
	for (const folder of folders) server.watcher.add(folder);
	server.watcher.add(content);
	const changed = (file) => {
		const path = resolve(file);
		if (folders.some((folder) => under(path, folder))) rebuild();
		// The bundle and its .gitignore are written by us: not a change to react to.
		else if (under(path, content) && !/[\\/](bundle\.json|\.gitignore)$/.test(path)) relist();
	};
	for (const event of ['add', 'change', 'unlink']) server.watcher.on(event, changed);
	return changed;
}
