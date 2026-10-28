// Serves the engine's static files (Draco decoder, controller profiles, base avatar, input icons) straight from the engine package, so a
// game does not carry a copy of them. `kithin-game build` adds them to the build.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const engineStaticFolder = join(dirname(fileURLToPath(import.meta.resolve('@kithin/engine/package.json'))), 'static');

const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.md': 'text/markdown', '.txt': 'text/plain' };

/** The file of the engine's static folder a request names, if there is one. */
export function engineStaticFile(url) {
	const path = normalize(join(engineStaticFolder, decodeURIComponent((url ?? '').split('?')[0])));
	return path.startsWith(engineStaticFolder + sep) && existsSync(path) && statSync(path).isFile() ? path : null;
}

/** A game's own static folder wins over the engine's, as it would if the files were copied there. */
export function engineStatic(gameStatic) {
	const middleware = (request, response, next) => {
		const file = engineStaticFile(request.url);
		if (!file || engineStaticFileOf(gameStatic, request.url)) return next();
		response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
		response.setHeader('Content-Length', statSync(file).size);
		createReadStream(file).pipe(response);
	};
	return {
		name: 'kithin-engine-static',
		configureServer: (server) => void server.middlewares.use(middleware),
		configurePreviewServer: (server) => void server.middlewares.use(middleware)
	};
}

const engineStaticFileOf = (folder, url) => {
	const path = normalize(join(folder, decodeURIComponent((url ?? '').split('?')[0])));
	return path.startsWith(folder + sep) && existsSync(path) && statSync(path).isFile();
};
