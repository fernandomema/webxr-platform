<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import type { MountedGame } from '$lib/xr/engine';

	let canvas: HTMLCanvasElement;
	let game: MountedGame | null = null;

	onMount(async () => {
		try {
			const { mountGame } = await import('$lib/xr/engine');
			game = await mountGame(canvas, page.params.code);
		} catch (err) {
			// devConsoleRelay (see +layout.svelte) forwards this to the dev server terminal.
			console.error('mountGame failed', err);
		}
	});

	onDestroy(() => {
		game?.dispose();
	});
</script>

<canvas bind:this={canvas} class="h-screen w-screen touch-none outline-none"></canvas>
