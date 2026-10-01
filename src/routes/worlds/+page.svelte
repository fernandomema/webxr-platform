<script lang="ts">
	import { resolve } from '$app/paths';
	import { PLATFORM_NAME } from '$lib/platform';
	import { worldAppPath } from '$lib/worlds/appManifest';
	import { thumbnailUrl } from '$lib/assets/thumbnails';
	import type { AssetId } from '$lib/assets/ref';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let previews = $state<Record<string, string>>({});

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
		<div class="mx-auto flex max-w-[1240px] items-center justify-between px-5 py-4 sm:px-8">
			<a href={resolve('/')} aria-label="{PLATFORM_NAME} home"><img src="/assets/kithin-logo.svg" alt={PLATFORM_NAME} class="h-7 w-auto" /></a>
			<a class="rounded-full bg-bone px-4 py-2 text-sm font-medium text-ink transition hover:bg-glow" href={resolve('/play')}>Open {PLATFORM_NAME} <span aria-hidden="true">↗</span></a>
		</div>
	</header>
	<main class="mx-auto max-w-[1240px] px-5 py-12 sm:px-8">
		<h1 class="text-3xl font-semibold sm:text-4xl">Worlds</h1>
		<p class="mt-2 text-bone/60">Pick a world to step inside.</p>
		{#if data.worlds.length === 0}
			<p class="mt-12 text-bone/60">No worlds have been published yet.</p>
		{:else}
			<ul class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.worlds as world (world.id)}
					<li>
						<a href={worldAppPath(world.id)} data-sveltekit-reload class="group block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-white/25">
							<div class="aspect-video bg-white/5">
								{#if previews[world.id]}
									<img src={previews[world.id]} alt="" class="h-full w-full object-cover transition group-hover:scale-[1.03]" loading="lazy" />
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
