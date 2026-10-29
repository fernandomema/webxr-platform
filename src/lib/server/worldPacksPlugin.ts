import { createReadStream } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { listPackIds, packAssetUrl, resolvePackRequest, syncPackAssets } from '../worldPacks/core.ts';

const VIRTUAL_ID = 'virtual:world-packs';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

const MIME: Record<string, string> = {
	'.glb': 'model/gltf-binary',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.mp3': 'audio/mpeg',
	'.ogg': 'audio/ogg',
	'.wav': 'audio/wav',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm'
};

/**
 * Local world packs (`worlds/<id>/`): in the dev server, each pack is listed with the development worlds and its `assets/` folder
 * is served and addressed by content hash, with nothing copied into `static/`. In a build the module is empty, so nothing of
 * `worlds/` reaches production. See `worlds/README.md`.
 */
export function worldPacksPlugin(folder = 'worlds'): Plugin {
	let root = '';
	let serving = false;

	function source(): string {
		if (!serving) return 'export const packWorlds = [];\nexport const packAssets = {};\n';
		const worlds: string[] = [];
		const assets: Record<string, string> = {};
		for (const id of listPackIds(root)) {
			const dir = resolve(root, id);
			worlds.push(`{ id: ${JSON.stringify(id)}, load: () => import(${JSON.stringify(resolve(dir, 'world.ts'))}) }`);
			for (const [path, assetId] of Object.entries(syncPackAssets(dir).assets)) assets[assetId] ??= packAssetUrl(id, path);
		}
		return `export const packWorlds = [${worlds.join(', ')}];\nexport const packAssets = ${JSON.stringify(assets)};\n`;
	}

	return {
		name: 'world-packs',
		configResolved(config) {
			root = resolve(config.root, folder);
			serving = config.command === 'serve';
		},
		resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
		load: (id) => (id === RESOLVED_ID ? source() : undefined),
		configureServer(server) {
			server.middlewares.use('/@packs', (request, response, next) => {
				const file = resolvePackRequest(root, request.url ?? '');
				if (!file) return next();
				response.setHeader('content-type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
				response.setHeader('cache-control', 'no-cache');
				createReadStream(file).pipe(response);
			});

			// A new, removed or changed file of a pack changes the asset map, which the app reads when it starts: reload the page.
			let timer: ReturnType<typeof setTimeout> | undefined;
			const refresh = () => {
				clearTimeout(timer);
				timer = setTimeout(() => {
					for (const environment of Object.values(server.environments)) {
						const module = environment.moduleGraph.getModuleById(RESOLVED_ID);
						if (module) environment.moduleGraph.invalidateModule(module);
					}
					server.ws.send({ type: 'full-reload' });
				}, 150);
			};
			const onChange = (file: string) => {
				const inside = relative(root, file).split(sep);
				if (inside[0] === '..' || inside.length < 2) return;
				if (inside[1] === 'assets' || (inside.length === 2 && inside[1] === 'world.ts')) refresh();
			};
			server.watcher.add(root);
			server.watcher.on('add', onChange).on('unlink', onChange).on('change', (file) => {
				// Only a changed file's hash differs; a rename or new file is seen by add/unlink. world.ts edits hot-reload by themselves.
				if (relative(root, file).split(sep)[1] === 'assets') onChange(file);
			});
		}
	};
}
