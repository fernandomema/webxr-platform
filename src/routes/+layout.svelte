<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';

	let { children } = $props();

	// Mobile/headset devtools console — no way to plug in real DevTools on a
	// Quest, so this gives a floating console/network/elements panel instead.
	// `import.meta.env.DEV` (not $app/environment's `dev`) so Vite inlines a
	// literal `false` in production and the whole branch — including the
	// dynamic import — is dead-code-eliminated out of the build.
	onMount(() => {
		// Not inside an iframe: the XR panels are pages drawn onto a surface, and a floating console would be drawn onto them.
		if (import.meta.env.DEV && window.self === window.top) {
			import('eruda')
				.then(({ default: eruda }) => eruda.init())
				.catch((err) => console.error('failed to load eruda', err));
			// Also mirrors console.warn/error + uncaught errors to the terminal
			// running `npm run dev` — see src/lib/devConsoleRelay.ts.
			import('$lib/devConsoleRelay')
				.then((m) => m.initDevConsoleRelay())
				.catch((err) => console.error('failed to load devConsoleRelay', err));
		}
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
