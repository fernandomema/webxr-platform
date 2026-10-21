import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// WebXR needs a secure context; localhost counts as one.
	server: { port: 5174 }
});
