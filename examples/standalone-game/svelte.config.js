import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
export default {
	kit: {
		// A game is a handful of static files: no server of its own. Kithin's services are reached over the network.
		adapter: adapter({ fallback: 'index.html' })
	}
};
