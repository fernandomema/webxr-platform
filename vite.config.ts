import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { wuchale } from 'wuchale/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { signalingDevPlugin } from './src/lib/server/wsDevPlugin.ts';

export default defineConfig({
	plugins: [
		wuchale(),
		tailwindcss(),
		// WebXR requires a secure context: plain http only works on localhost,
		// never over a LAN IP (needed to test on a real headset). Self-signed —
		// the headset's browser will show a one-time "not private" warning to
		// click through; only applies to `vite dev`/`preview`, not the build.
		basicSsl(),
		signalingDevPlugin(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	]
});
