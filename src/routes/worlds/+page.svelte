<script lang="ts">
	import PanoramaView from '$lib/worlds/PanoramaView.svelte';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { PLATFORM_NAME } from '$lib/platform';
	import { worldAppPath } from '$lib/worlds/appManifest';
	import { thumbnailUrl } from '$lib/assets/thumbnails';
	import type { AssetId } from '$lib/assets/ref';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let previews = $state<Record<string, string>>({});
	let officialPreviews = $state<Record<string, string>>({});

	// The official worlds' 360° previews are drawn in the browser (once, then kept on this device), so the scenes are only
	// loaded here, after the page is up, never sent from the server.
	onMount(() => {
		let cancelled = false;
		void (async () => {
			try {
				const [{ getBuiltinWorld }, { builtinPreview }, { thumbnailUrl: urlOf }] = await Promise.all([
					import('$lib/xr/templates/builtinWorlds'),
					import('$lib/worlds/builtinPreview'),
					import('$lib/assets/thumbnails')
				]);
				for (const entry of data.official) {
					const world = getBuiltinWorld(entry.id);
					if (!world || cancelled) continue;
					const assetId = await builtinPreview(world);
					const url = assetId ? await urlOf(assetId) : null;
					if (url && !cancelled) officialPreviews[entry.id] = url;
				}
			} catch {
				// no preview: the card keeps its gradient
			}
		})();
		return () => { cancelled = true; };
	});

	$effect(() => {
		for (const world of data.worlds) {
			if (!world.thumbnailAssetId) continue;
			void thumbnailUrl(world.thumbnailAssetId as AssetId).then((url) => {
				if (url) previews[world.id] = url;
			});
		}
	});
</script>

<svelte:head>
	<title>Worlds · {PLATFORM_NAME}</title>
	<meta name="description" content="Explore the worlds published on {PLATFORM_NAME}." />
</svelte:head>

<div class="min-h-screen bg-ink text-bone antialiased">
	<header class="border-b border-white/6">
		<div class="mx-auto flex max-w-[var(--page-width)] items-center justify-between px-5 py-4 sm:px-8">
			<a href={resolve('/')} aria-label="{PLATFORM_NAME} home"><img src="/assets/kithin-logo.svg" alt={PLATFORM_NAME} class="h-7 w-auto" /></a>
			<a class="rounded-full bg-bone px-4 py-2 text-sm font-medium text-ink transition hover:bg-glow" href={resolve('/play')}>Open {PLATFORM_NAME} <span aria-hidden="true">↗</span></a>
		</div>
	</header>
	<main class="mx-auto max-w-[var(--page-width)] px-5 py-12 sm:px-8">
		<h1 class="text-3xl font-semibold sm:text-4xl">Worlds</h1>
		<p class="mt-2 text-bone/60">Pick a world to step inside.</p>
		{#if data.official.length > 0}
			<h2 class="mt-10 font-display text-xl font-medium tracking-[-0.02em]"><span class="text-glow">●</span> Official</h2>
			<p class="mt-1 text-sm text-bone/45">Made by the {PLATFORM_NAME} team.</p>
			<ul class="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.official as world (world.id)}
					<li>
						<a href={`/play?world=${encodeURIComponent(world.id)}`} data-sveltekit-reload class="group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-white/25">
							<div class="aspect-video bg-gradient-to-br from-iris/20 to-ember/15">
								{#if officialPreviews[world.id]}
									<PanoramaView src={officialPreviews[world.id]} class="h-full w-full object-cover" />
								{/if}
							</div>
							<div class="flex flex-1 flex-col p-4">
								<h3 class="font-medium">{world.name}</h3>
								<p class="mt-1 line-clamp-2 text-sm text-bone/55">{world.description}</p>
								<span class="mt-auto pt-3 text-sm text-bone/70 transition group-hover:text-bone">Enter <span aria-hidden="true">→</span></span>
							</div>
						</a>
					</li>
				{/each}
			</ul>
			<h2 class="mt-12 font-display text-xl font-medium tracking-[-0.02em]"><span class="text-mint">●</span> Community</h2>
			<p class="mt-1 text-sm text-bone/45">Published by players.</p>
		{/if}
		{#if data.worlds.length === 0}
			<p class="mt-6 text-bone/60">No worlds have been published yet.</p>
		{:else}
			<ul class="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.worlds as world (world.id)}
					<li>
						<a href={worldAppPath(world.id)} data-sveltekit-reload class="group block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-white/25">
							<div class="aspect-video bg-white/5">
								{#if previews[world.id]}
									<PanoramaView src={previews[world.id]} class="h-full w-full object-cover" />
								{/if}
							</div>
							<div class="p-4">
								<h2 class="truncate font-medium">{world.name}</h2>
								<p class="mt-1 text-xs text-bone/50">v{world.latestRevision} · {new Date(world.updatedAt).toLocaleDateString()}</p>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</main>
</div>
