#!/usr/bin/env node
// Runs a game made of static/ and src/game.ts. Everything else (the page, the routes, the SvelteKit and Vite setup) is in this package,
// so updating it updates every game:
//   kithin-game dev | build | preview | check | lint   [--port <n>] [--host] [--force]
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from '@kithin/engine/bin/bundle.mjs';
import { readGameConfig, staleEngineCache, watchGame } from '../devTools.mjs';
import { engineStaticFolder } from '../engineStatic.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engineRoot = dirname(fileURLToPath(import.meta.resolve('@kithin/engine/package.json')));
const root = process.cwd();
const content = join(root, 'static/content');
const config = readGameConfig(root);

/** `--port 5175`, `--host` (listen on the network, for a headset) and `--force` (rebuild Vite's cache of dependencies). */
function flags(args) {
	const port = args.indexOf('--port');
	return { port: port >= 0 ? Number(args[port + 1]) : undefined, host: args.includes('--host') || undefined, force: args.includes('--force') || undefined };
}

/** The setup of every game is this package's vite.config.mjs; `--port`, `--host` and `--force` are the only things a game picks. */
const viteConfig = (options = {}) => ({
	configFile: join(packageRoot, 'vite.config.mjs'),
	root,
	...(options.force && { optimizeDeps: { force: true } }),
	server: { ...(options.port && { port: options.port }), ...(options.host && { host: options.host }) },
	preview: { ...(options.port && { port: options.port }), ...(options.host && { host: options.host }) }
});

/** Builds the world files from the game's code, when it declares how (`"kithin": { "world": { "script": "world" } }` in package.json). */
function buildWorld() {
	if (!config.world) return true;
	if (!config.scripts[config.world.script]) { console.error(`kithin-game: package.json has no script "${config.world.script}" to build the worlds.`); return false; }
	return spawnSync('npm', ['run', '--silent', config.world.script], { cwd: root, stdio: 'inherit' }).status === 0;
}

/** Lists static/content in its bundle.json; returns whether the list changed. */
function bundleContent() {
	if (!existsSync(content)) return;
	buildBundle(content);
	// Listed from the content folder on every run: not the game's to keep.
	const ignore = '# Written by kithin-game.\n/bundle.json\n';
	if (!existsSync(join(content, '.gitignore')) || readFileSync(join(content, '.gitignore'), 'utf8') !== ignore) writeFileSync(join(content, '.gitignore'), ignore);
}

/** What has to exist before Vite starts: the world files, the content bundle and the tsconfig for the editor. */
function prepare() {
	if (!buildWorld()) process.exit(1);
	bundleContent();
	if (!existsSync(join(root, 'tsconfig.json'))) writeFileSync(join(root, 'tsconfig.json'), '{\n\t"extends": "./.svelte-kit/tsconfig.json"\n}\n');
}

/** The world files in static/content/worlds, with the scene of each. */
function readWorlds() {
	const folder = join(content, 'worlds');
	if (!existsSync(folder)) return [];
	return readdirSync(folder).filter((name) => name.endsWith('.json')).map((name) => ({ id: name.slice(0, -5), world: JSON.parse(readFileSync(join(folder, name), 'utf8')) }));
}

/** Runs the world lints on every world of the game; prints what they find and returns the number of errors. */
async function lintWorlds(server) {
	const { lintWorld } = await server.ssrLoadModule('@kithin/engine/worlds/lint');
	const { parseFragment } = await server.ssrLoadModule('@kithin/engine/assets/fragment');
	const bundle = existsSync(join(content, 'bundle.json')) ? JSON.parse(readFileSync(join(content, 'bundle.json'), 'utf8')) : { assets: {} };
	const fragments = (id) => {
		const path = bundle.assets[id];
		if (!path) return undefined;
		try { return parseFragment(readFileSync(join(content, path))); } catch { return undefined; }
	};
	let errors = 0, warnings = 0;
	const worlds = readWorlds();
	for (const { id, world } of worlds) {
		const names = new Map(world.scene.map((slot) => [slot.id, slot.name]));
		for (const finding of lintWorld(world.scene, { fragments })) {
			if (finding.severity === 'error') errors++; else warnings++;
			console.log(`${finding.severity === 'error' ? 'error  ' : 'warning'} ${id}: ${finding.rule}  ${finding.message} [${names.get(finding.slotId) ?? finding.slotId}]`);
		}
	}
	console.log(`world lint: ${worlds.length} world${worlds.length === 1 ? '' : 's'}, ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`);
	return errors;
}

/** Vite without a page: its only purpose is that it writes SvelteKit's types and loads TypeScript for us. */
async function quietServer(vite, options) {
	return vite.createServer({ ...viteConfig(options), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
}

const [command = 'dev', ...args] = process.argv.slice(2);
const options = flags(args);
if (!existsSync(join(root, 'src/game.ts'))) {
	console.error('kithin-game: src/game.ts not found. A game declares itself there: export default defineGame({ name: "My game" }) from @kithin/game.');
	process.exit(1);
}
prepare();
const vite = await import('vite');

if (command === 'dev') {
	const stale = options.force ? null : staleEngineCache({ root, engineRoot });
	if (stale) console.warn(`kithin-game: warning: ${stale}`);
	const server = await vite.createServer(viteConfig(options));
	await server.listen();
	server.printUrls();
	watchGame({ server, root, content, watch: config.world?.watch ?? [], buildWorld, bundleContent });
} else if (command === 'build') {
	await vite.build(viteConfig(options));
	// The engine's static files are served from its package in development: a build needs them beside the page.
	cpSync(engineStaticFolder, join(root, 'build'), { recursive: true });
} else if (command === 'preview') {
	const server = await vite.preview(viteConfig(options));
	server.printUrls();
} else if (command === 'lint') {
	const server = await quietServer(vite, options);
	const errors = await lintWorlds(server);
	await server.close();
	process.exit(errors > 0 ? 1 : 0);
} else if (command === 'check') {
	// Starting Vite writes .svelte-kit/tsconfig.json (SvelteKit's sync), which the editor and svelte-check read.
	const server = await quietServer(vite, options);
	const errors = await lintWorlds(server);
	await server.close();
	const require = createRequire(import.meta.url);
	const checker = join(dirname(require.resolve('svelte-check/package.json')), 'bin/svelte-check');
	const checked = spawnSync(process.execPath, [checker, '--tsconfig', './tsconfig.json'], { cwd: root, stdio: 'inherit' }).status ?? 1;
	process.exit(errors > 0 ? 1 : checked);
} else {
	console.error(`kithin-game: unknown command "${command}". Use dev, build, preview, check or lint.`);
	process.exit(1);
}
