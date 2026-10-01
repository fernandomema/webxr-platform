<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { MountedGame } from '$lib/xr/engine';
	import XRLaunchOverlay from '$lib/xr/XRLaunchOverlay.svelte';
	import type { WorldPackage } from '$lib/worlds/types';

	interface Props {
		/** Join this live room. */
		roomCode?: string;
		/** Open this published world on its own (the world played as an installed app). */
		worldId?: string;
	}

	let { roomCode, worldId }: Props = $props();

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

	/** Meta: inside an installed PWA, tapping the app icon counts as the user action a VR session needs. */
	const launchedAsApp = () => (window as unknown as { getDigitalGoodsService?: unknown }).getDigitalGoodsService !== undefined;

	onMount(async () => {
		try {
			const initialWorld = worldId ? await loadWorld(worldId) : undefined;
			const { mountGame } = await import('$lib/xr/engine');
			game = await mountGame(canvas, roomCode, {
				initialWorld,
				onXRStateChange: (state) => {
					if (state === 'in-xr') launchState = 'playing';
					else if (state === 'not-in-xr' && game?.xrSupported) launchState = 'vr';
				}
			});
			launchState = game.xrSupported ? 'vr' : 'desktop';
			if (game.xrSupported && launchedAsApp()) void enterVR();
		} catch (err) {
			// devConsoleRelay (see +layout.svelte) forwards this to the dev server terminal.
			console.error('mountGame failed', err);
			launchState = 'desktop';
		}
	});

	async function loadWorld(id: string): Promise<WorldPackage> {
		const response = await fetch(`/api/published-worlds/${encodeURIComponent(id)}`);
		if (!response.ok) throw new Error('Could not load the published world');
		return (await response.json()) as WorldPackage;
	}

	onDestroy(() => {
		game?.dispose();
	});
</script>

<XRLaunchOverlay state={launchState} error={launchError} onEnterVR={enterVR} onContinueDesktop={() => (launchState = 'playing')} />
<canvas bind:this={canvas} class="h-screen w-screen touch-none outline-none"></canvas>
