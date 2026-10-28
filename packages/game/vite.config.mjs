// The Vite and SvelteKit setup of every game, used by `kithin-game` as the config file of the game it runs in (the folder it is run from).
// SvelteKit's own secondary builds read the config file again, so it has to be a file and not an inline object.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { engineStatic } from './engineStatic.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const engineSource = dirname(fileURLToPath(import.meta.resolve('@kithin/engine/package.json')));

export default defineConfig({
	plugins: [
		engineStatic(resolve('static')),
		// The engine's page and routes, and the game's own configuration (src/game.ts) under the name `$game`.
		sveltekit({
			// A game is a handful of static files: no server of its own. Kithin's services are reached over the network.
			adapter: adapter({ fallback: 'index.html' }),
			files: { appTemplate: join(packageRoot, 'app/app.html'), routes: join(packageRoot, 'app/routes') },
			alias: { $game: 'src/game' },
			typescript: {
				config(config) {
					config.compilerOptions = {
						...config.compilerOptions,
						// The engine is shipped as TypeScript source, whose imports name their .ts files.
						rewriteRelativeImportExtensions: true,
						allowJs: true,
						checkJs: true,
						esModuleInterop: true,
						skipLibCheck: true,
						strict: true,
						moduleResolution: 'bundler'
					};
					return config;
				}
			}
		})
	],
	// WebXR needs a secure context; localhost counts as one. The dev server only serves src/ and node_modules/ unless told: these
	// packages may be linked from elsewhere (a monorepo), so their real folders are allowed.
	server: { port: 5174, fs: { allow: [resolve('.'), packageRoot, engineSource] } },
	preview: { port: 5174 }
});
