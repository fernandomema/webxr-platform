// Local world packs (worlds/<id>/). Run with: npm run pack -- <command> [id]. See worlds/README.md.
import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const worlds = join(root, 'worlds');
const lib = (path) => pathToFileURL(join(root, 'src/lib/worldPacks', path)).href;
const { PACK_ID_PATTERN, listPackIds, readCookie, readPublishedId, saveCookie, savePublishedId, syncPackAssets } = await import(lib('core.ts'));

const [command, id, ...rest] = process.argv.slice(2);

/** `--host` / `KITHIN_HOST`, as the origin of the platform. */
async function hostOf(flagged) {
	const host = flagged ?? process.env.KITHIN_HOST;
	if (!host) fail('Which platform? Set KITHIN_HOST (https://your-site.com) or pass --host <address>.');
	return (await import(lib('publish.ts'))).normalizeHost(host);
}
const flag = (name) => {
	const at = process.argv.indexOf(`--${name}`);
	return at >= 0 ? process.argv[at + 1] : undefined;
};

function need(id) {
	if (!id) fail('Missing the pack id. Example: npm run pack -- ' + command + ' my-world');
	if (!PACK_ID_PATTERN.test(id)) fail(`"${id}" is not a valid id: lowercase letters, digits and dashes.`);
	return id;
}
function fail(message) {
	console.error(message);
	process.exit(1);
}
const titleOf = (id) => id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

const TEMPLATE = (id, name) => `import { createSlot } from '@kithin/engine/ecs/types';
import type { PackWorld } from '../../src/lib/worldPacks/types.ts';
// Files in ./assets are addressed with asset('models/chair.glb'): it returns the id a scene uses (generated in ./assets.ts).
// import { asset } from './assets.ts';

// Packs run in the dev server and in Node (\`npm run pack -- export\`): import the engine as '@kithin/engine/…' and the app's
// own code by a relative path (../../src/lib/…), not with the $lib alias. Relative imports end in .ts.

export default {
	name: ${JSON.stringify(name)},
	description: 'A world made in a local pack.',
	build: () => [
		createSlot({ id: 'spawn', name: 'Spawn', position: [0, 0, 0], components: [{ type: 'spawnPoint' }] }),
		createSlot({
			id: 'floor',
			name: 'Floor',
			position: [0, -0.05, 0],
			components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'ground' }, color: '#3f3f46' }, { type: 'collider', shape: 'box' }]
		})
	]
} satisfies PackWorld;
`;

switch (command) {
	case 'new': {
		need(id);
		const dir = join(worlds, id);
		if (existsSync(dir)) fail(`worlds/${id} already exists.`);
		mkdirSync(join(dir, 'assets'), { recursive: true });
		writeFileSync(join(dir, 'world.ts'), TEMPLATE(id, rest.join(' ') || titleOf(id)));
		syncPackAssets(dir);
		console.log(`Created worlds/${id}. Start the dev server (npm run dev): it is listed under Development.`);
		break;
	}
	case 'list': {
		for (const pack of listPackIds(worlds)) console.log(`${pack}  (${Object.keys(syncPackAssets(join(worlds, pack)).assets).length} assets)`);
		break;
	}
	case 'sync': {
		for (const pack of id ? [need(id)] : listPackIds(worlds)) {
			const { changed, assets } = syncPackAssets(join(worlds, pack));
			console.log(`${pack}: ${Object.keys(assets).length} assets${changed ? ', assets.ts updated' : ''}`);
		}
		break;
	}
	case 'export': {
		need(id);
		const dir = join(worlds, id);
		if (!existsSync(join(dir, 'world.ts'))) fail(`worlds/${id}/world.ts does not exist.`);
		syncPackAssets(dir);
		const { exportPack } = await import(lib('export.ts'));
		const { default: world } = await import(pathToFileURL(join(dir, 'world.ts')).href);
		const result = await exportPack(dir, world);
		const out = join(dir, 'dist');
		mkdirSync(out, { recursive: true });
		writeFileSync(join(out, result.fileName), result.bytes);
		console.log(`worlds/${id}/dist/${result.fileName}  (${(statSync(join(out, result.fileName)).size / 1e6).toFixed(1)} MB, ${result.assetCount} assets)`);
		for (const path of result.skipped) console.warn(`  skipped assets/${path}: not a file type the engine accepts`);
		for (const missing of result.missing) console.warn(`  missing asset ${missing}: the scene uses it but no file in assets/ has that hash`);
		if (result.missing.length) process.exitCode = 1;
		break;
	}
	case 'login': {
		// The cookie of a browser session that is signed in: DevTools > Network > any request to the site > the `cookie` request header.
		const host = await hostOf(id?.startsWith('--') ? undefined : id);
		const { whoami } = await import(lib('publish.ts'));
		const cookie = process.env.KITHIN_COOKIE || (await createInterface({ input: process.stdin, output: process.stdout }).question(`Paste the cookie header of a signed-in session on ${host}: `)).trim();
		const user = await whoami({ host, cookie }).catch((error) => fail(error.message));
		if (!user) fail('That cookie is not a signed-in session.');
		saveCookie(worlds, host, cookie);
		console.log(`Saved for ${host}: signed in as ${user.name || user.email}.`);
		process.exit(0);
		break;
	}
	case 'whoami': {
		const host = await hostOf(flag('host'));
		const cookie = readCookie(worlds, host);
		if (!cookie) fail(`No cookie for ${host}. Run: npm run pack -- login ${host}`);
		const { whoami } = await import(lib('publish.ts'));
		const user = await whoami({ host, cookie }).catch((error) => fail(error.message));
		console.log(user ? `${host}: signed in as ${user.name || user.email} (${user.email})` : `${host}: the saved cookie has expired. Run: npm run pack -- login ${host}`);
		break;
	}
	case 'publish': {
		need(id);
		const host = await hostOf(flag('host'));
		const cookie = readCookie(worlds, host);
		if (!cookie) fail(`No cookie for ${host}. Run: npm run pack -- login ${host}`);
		const dir = join(worlds, id);
		if (!existsSync(join(dir, 'world.ts'))) fail(`worlds/${id}/world.ts does not exist.`);
		syncPackAssets(dir);
		const { publishPack, PublishError } = await import(lib('publish.ts'));
		const { default: world } = await import(pathToFileURL(join(dir, 'world.ts')).href);
		// Without --new, a world published before from this pack gets a new revision instead of a second world.
		const publishedId = process.argv.includes('--new') ? undefined : (flag('world') ?? readPublishedId(dir, host) ?? undefined);
		try {
			const result = await publishPack(dir, world, { host, cookie }, {
				publishedId,
				onProgress: (done, total, name) => name && process.stdout.write(`\rUploading ${done + 1}/${total}: ${name.slice(0, 40).padEnd(40)}`)
			});
			process.stdout.write('\r'.padEnd(70) + '\r');
			savePublishedId(dir, host, result.id);
			console.log(`${result.created ? 'Published' : 'Revision ' + result.revision + ' of'} "${result.name}": ${host}/play/${result.id}`);
			console.log(`  files: ${result.uploaded} uploaded, ${result.existing} already there`);
			for (const path of result.skipped) console.warn(`  skipped assets/${path}: not a file type the engine accepts`);
			for (const missing of result.notInPack) console.warn(`  ${missing} is used by the scene but is not in assets/ (the platform already had it)`);
		} catch (error) {
			if (!(error instanceof PublishError)) throw error;
			console.error(error.message);
			for (const missing of error.missing) console.error(`  missing on the platform: ${missing}`);
			process.exit(1);
		}
		break;
	}
	default:
		fail('Usage: npm run pack -- <new <id> [name] | list | sync [id] | export <id> | login <host> | whoami | publish <id> [--host <host>] [--new] [--world <publishedId>]>');
}
