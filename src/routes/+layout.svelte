<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { page } from '$app/state';

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

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&amp;family=Inter:wght@300;400;500;600&amp;display=swap" />
	<link rel="icon" type="image/svg+xml" sizes="any" href={favicon} />
	<link rel="shortcut icon" type="image/svg+xml" href={favicon} />
	<!-- A world played as its own app (/play/<id>) supplies its own manifest and colour through its page data. -->
	<link rel="manifest" href={(page.data as { app?: { manifestHref?: string } }).app?.manifestHref ?? '/manifest.webmanifest'} />
	<meta name="theme-color" content={(page.data as { app?: { themeColor?: string } }).app?.themeColor ?? '#07070c'} />
	<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
</svelte:head>
{@render children()}
