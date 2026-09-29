<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import type { MountedGame } from '$lib/xr/engine';
	import XRLaunchOverlay from '$lib/xr/XRLaunchOverlay.svelte';

	let canvas: HTMLCanvasElement;
	let game: MountedGame | null = null;
	let launchState = $state<'loading' | 'vr' | 'desktop' | 'playing'>('loading');
	let launchError = $state('');

	async function enterVR(): Promise<void> {
		if (!game) return;
		launchError = '';
		try {
			await game.enterVR();
			launchState = 'playing';
		} catch (error) {
			launchState = 'vr';
			launchError = error instanceof Error ? error.message : 'Could not enter VR';
		}
	}

	onMount(async () => {
		try {
			const { mountGame } = await import('$lib/xr/engine');
			game = await mountGame(canvas, page.params.code, {
				onXRStateChange: (state) => {
					if (state === 'in-xr') launchState = 'playing';
					else if (state === 'not-in-xr' && game?.xrSupported) launchState = 'vr';
				}
			});
			launchState = game.xrSupported ? 'vr' : 'desktop';
		} catch (err) {
			// devConsoleRelay (see +layout.svelte) forwards this to the dev server terminal.
			console.error('mountGame failed', err);
			launchState = 'desktop';
		}
	});

	onDestroy(() => {
		game?.dispose();
	});
</script>

<XRLaunchOverlay state={launchState} error={launchError} onEnterVR={enterVR} onContinueDesktop={() => (launchState = 'playing')} />
<canvas bind:this={canvas} class="h-screen w-screen touch-none outline-none"></canvas>
