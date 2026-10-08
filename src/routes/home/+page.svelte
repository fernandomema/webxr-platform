<script lang="ts">
	import PanoramaView from '$lib/worlds/PanoramaView.svelte';
	import { resolve } from '$app/paths';
	import { PLATFORM_NAME } from '$lib/platform';
	import { worldAppPath } from '$lib/worlds/appManifest';
	import { thumbnailUrl } from '$lib/assets/thumbnails';
	import type { AssetId } from '$lib/assets/ref';
	import { listRecentProjects, type RecentProject } from '$lib/inventory/recent';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let previews = $state<Record<string, string>>({});
	// Saved projects live in this browser (and in the cloud), so they can only be listed here, not on the server.
	let creating = $state<RecentProject[]>([]);
	let creatingLoaded = $state(false);

	$effect(() => {
		if (!data.user) { creatingLoaded = true; return; }
		void listRecentProjects({ worldId: null, userId: data.user.id }, 10)
			.then((projects) => { creating = projects; })
			.catch(() => { creating = []; })
			.finally(() => { creatingLoaded = true; });
	});

	const kindLabel = (project: RecentProject): string => project.item.kind === 'world' ? 'World' : project.item.kind === 'avatar' ? 'Avatar' : 'Object';

	const sections = $derived([
		{ id: 'visited', title: 'Recently visited', blurb: 'Pick up where you left off.', worlds: data.visited, tone: 'text-sky', empty: 'Worlds you open will show up here.', show: Boolean(data.user) },
		{ id: 'picks', title: 'Staff picks', blurb: 'Hand-picked by the team.', worlds: data.picks, tone: 'text-glow', empty: 'No staff picks yet.', show: true },
		{ id: 'popular', title: 'Popular worlds', blurb: 'Where people have been playing lately.', worlds: data.popular, tone: 'text-ember', empty: 'Nobody has played a published world this month.', show: true },
		{ id: 'newest', title: 'New worlds', blurb: 'Fresh from the community.', worlds: data.newest, tone: 'text-mint', empty: 'No worlds have been published yet.', show: true }
	]);

	$effect(() => {
		const ids = [...data.visited, ...data.picks, ...data.popular, ...data.newest, ...creating.map((project) => project.item)];
		for (const entry of ids) {
			if (!entry.thumbnailAssetId) continue;
			void thumbnailUrl(entry.thumbnailAssetId as AssetId).then((url) => {
				if (url) previews[entry.thumbnailAssetId as string] = url;
			});
		}
	});

	const ago = (iso: string): string => {
		const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
		if (minutes < 60) return `${minutes} min ago`;
		if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
		return `${Math.round(minutes / 60 / 24)} d ago`;
	};

	const hour = new Date().getHours();
	const greeting = hour < 6 ? 'Still up' : hour < 13 ? 'Good morning' : hour < 20 ? 'Good afternoon' : 'Good evening';
	const initial = $derived((data.user?.name.trim()[0] ?? '?').toUpperCase());
</script>

<svelte:head>
	<title>Home · {PLATFORM_NAME}</title>
	<meta name="description" content="Pick where to go next on {PLATFORM_NAME}." />
</svelte:head>

<div class="grain relative min-h-screen overflow-hidden bg-ink text-bone antialiased">
	<div class="pointer-events-none absolute inset-0" aria-hidden="true">
		<div class="absolute -top-40 left-1/2 h-[42rem] w-[70rem] -translate-x-1/2 rounded-full bg-iris/20 blur-[120px]"></div>
		<div class="absolute -right-40 bottom-0 h-[30rem] w-[40rem] rounded-full bg-ember/15 blur-[120px]"></div>
		<div class="absolute -left-40 top-1/2 h-[26rem] w-[30rem] rounded-full bg-sky/10 blur-[120px]"></div>
	</div>

	<header class="relative mx-auto flex max-w-[var(--page-width)] items-center justify-between px-5 py-5 sm:px-8">
		<a href={resolve('/')} aria-label="{PLATFORM_NAME} landing"><img src="/assets/kithin-logo.svg" alt={PLATFORM_NAME} class="h-8 w-auto" /></a>
		<div class="flex items-center gap-3">
		<a href="/wiki" class="rounded-full px-3 py-2 text-sm text-bone/60 transition hover:text-bone">Wiki</a>
		{#if data.user}
			<a href={resolve('/settings')} class="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 py-1.5 pl-4 pr-1.5 text-sm backdrop-blur transition hover:bg-white/10">
				<span class="max-w-[10rem] truncate text-bone/80">{data.user.name}</span>
				{#if data.user.image}
					<img src={data.user.image} alt="" class="h-8 w-8 rounded-full object-cover" />
				{:else}
					<span class="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-iris to-ember font-display text-sm font-semibold text-ink">{initial}</span>
				{/if}
			</a>
		{:else}
			<a class="rounded-full bg-bone px-4 py-2 text-sm font-medium text-ink transition hover:bg-glow" href={resolve('/login?next=/home')}>Sign in</a>
		{/if}
		</div>
	</header>

	<main class="relative mx-auto max-w-[var(--page-width)] px-5 pb-16 pt-6 sm:px-8 sm:pt-10">
		<p class="font-display text-[11px] uppercase tracking-[0.26em] text-bone/45">{data.user ? greeting : 'Welcome'}</p>
		<h1 class="mt-3 font-display text-[clamp(2.4rem,6vw,4.4rem)] font-medium leading-[0.95] tracking-[-0.04em]">
			{data.user ? data.user.name : `Welcome to ${PLATFORM_NAME}`}<span class="text-glow">.</span>
		</h1>
		<p class="mt-3 text-bone/55">Who's in? Pick where to go.</p>

		<div class="mt-10 grid gap-4 md:grid-cols-6 md:grid-rows-[minmax(15rem,auto)_minmax(10rem,auto)]">
			<!-- Play -->
			<a href="/play" data-sveltekit-reload class="group relative isolate flex min-h-[18rem] flex-col justify-end overflow-hidden rounded-3xl border border-white/10 bg-ink-2 p-7 transition hover:border-white/30 md:col-span-4">
				<img src="/assets/kithin-blank-banner.png" alt="" class="absolute inset-0 -z-20 h-full w-full object-cover object-right transition duration-700 group-hover:scale-105" />
				<div class="absolute inset-0 -z-10 bg-gradient-to-t from-ink/85 via-ink/25 to-transparent"></div>
				<div class="absolute inset-0 -z-10 bg-gradient-to-r from-ink/70 via-transparent to-transparent"></div>
				<span class="mb-auto inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-ink/50 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-bone/70 backdrop-blur"><span class="h-1.5 w-1.5 rounded-full bg-mint"></span>Browser · VR</span>
				<h2 class="font-display text-5xl font-medium tracking-[-0.04em] sm:text-6xl">Play</h2>
				<p class="mt-2 max-w-sm text-bone/70">Step into Kithin with whoever's around.</p>
				<span class="mt-5 inline-flex w-fit items-center gap-2 rounded-full bg-bone px-5 py-2.5 font-display text-sm font-medium text-ink transition group-hover:gap-3 group-hover:bg-glow">Enter now <span aria-hidden="true">→</span></span>
			</a>

			<!-- Worlds -->
			<a href="/worlds" class="group relative isolate flex min-h-[14rem] flex-col justify-end overflow-hidden rounded-3xl border border-white/10 bg-ink-2 p-6 transition hover:border-white/30 md:col-span-2">
				<img src="/assets/kithin-banner-explore.png" alt="" class="absolute inset-0 -z-20 h-full w-full object-cover object-[70%_60%] transition duration-700 group-hover:scale-105" />
				<div class="absolute inset-0 -z-10 bg-gradient-to-t from-ink/80 via-ink/15 to-transparent"></div>
				<h2 class="font-display text-3xl font-medium tracking-[-0.03em]">Discover</h2>
				<p class="mt-1 text-sm text-bone/65">Explore worlds people published.</p>
			</a>

			<!-- Studio -->
			<a href="/studio" class="group relative isolate flex min-h-[10rem] flex-col justify-end overflow-hidden rounded-3xl border border-white/10 bg-ink-2 p-6 transition hover:border-white/30 md:col-span-3">
				<img src="/assets/kithin-banner-create.png" alt="" class="absolute inset-0 -z-20 h-full w-full object-cover object-right transition duration-700 group-hover:scale-105" />
				<div class="absolute inset-0 -z-10 bg-gradient-to-t from-ink/80 via-ink/15 to-transparent"></div>
				<h2 class="font-display text-3xl font-medium tracking-[-0.03em]">Create</h2>
				<p class="mt-1 text-sm text-bone/65">Build your own worlds and objects.</p>
			</a>

			<!-- Settings -->
			<a href="/settings" class="group relative isolate flex min-h-[10rem] flex-col justify-end overflow-hidden rounded-3xl border border-white/10 bg-ink-2 p-6 transition hover:border-white/30 md:col-span-3">
				<img src="/assets/kithin-banner-settings.png" alt="" class="absolute inset-0 -z-20 h-full w-full object-cover object-center transition duration-700 group-hover:scale-105" />
				<div class="absolute inset-0 -z-10 bg-gradient-to-t from-ink/80 via-ink/15 to-transparent"></div>
				<h2 class="font-display text-3xl font-medium tracking-[-0.03em]">Settings</h2>
				<p class="mt-1 text-sm text-bone/65">{data.user ? 'Account, connections and cloud.' : 'Sign in to manage your account.'}</p>
			</a>
		</div>

		{#if data.user}
			<section class="mt-14">
				<div class="flex items-end justify-between">
					<div>
						<h2 class="font-display text-xl font-medium tracking-[-0.02em]"><span class="text-iris">●</span> Continue creating</h2>
						<p class="mt-1 text-sm text-bone/45">Your latest worlds, objects and avatars.</p>
					</div>
					<a href="/studio" class="text-sm text-bone/50 transition hover:text-bone">Open Create →</a>
				</div>
				{#if creatingLoaded && creating.length === 0}
					<a href="/studio" class="mt-4 flex items-center justify-between rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-5 py-6 text-sm text-bone/60 transition hover:border-white/30 hover:text-bone">Worlds, objects and avatars you save in Create will be waiting here, from this device or the cloud. <span class="font-medium text-bone">Start creating →</span></a>
				{/if}
				<ul class="mt-4 flex snap-x items-start gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
					{#each creating as project (`${project.adapterId}:${project.item.id}`)}
						<li class={`shrink-0 snap-start ${project.item.kind === 'world' ? 'w-64' : 'w-44'}`}>
							<a href={`/studio/edit?source=${project.adapterId}&folder=${project.item.folderId ?? 'root'}&item=${encodeURIComponent(project.item.id)}`} class="group block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-white/30">
								<div class={`relative bg-gradient-to-br from-iris/20 to-ember/15 ${project.item.kind === 'world' ? 'aspect-video' : 'aspect-square'}`}>
									{#if project.item.thumbnailAssetId && previews[project.item.thumbnailAssetId]}
										{#if project.item.kind === 'world'}<PanoramaView src={previews[project.item.thumbnailAssetId]} class="h-full w-full object-cover" />{:else}<img src={previews[project.item.thumbnailAssetId]} alt="" class="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />{/if}
									{/if}
									<span class="absolute left-2 top-2 rounded-full bg-ink/70 px-2.5 py-1 text-[11px] text-bone/80 backdrop-blur">{kindLabel(project)}</span>
									<span class="absolute bottom-2 right-2 rounded-full bg-ink/70 px-2.5 py-1 text-[11px] text-bone/80 backdrop-blur">Edit</span>
								</div>
								<div class="px-4 py-3">
									<p class="truncate text-sm font-medium">{project.item.name}</p>
									<p class="mt-0.5 text-xs text-bone/45">{project.adapterLabel} · {ago(project.item.createdAt)}</p>
								</div>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#each sections as section (section.id)}
			{#if section.show}
				<section class="mt-12">
					<div class="flex items-end justify-between">
						<div>
							<h2 class="font-display text-xl font-medium tracking-[-0.02em]"><span class={section.tone}>●</span> {section.title}</h2>
							<p class="mt-1 text-sm text-bone/45">{section.blurb}</p>
						</div>
						<a href="/worlds" class="text-sm text-bone/50 transition hover:text-bone">See all →</a>
					</div>
					{#if section.worlds.length === 0}<p class="mt-4 rounded-2xl border border-dashed border-white/10 px-5 py-6 text-sm text-bone/45">{section.empty}</p>{/if}
					<ul class="mt-4 flex snap-x gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
						{#each section.worlds as world (world.id)}
							<li class="w-56 shrink-0 snap-start">
								<a href={worldAppPath(world.id)} data-sveltekit-reload class="group block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-white/30">
									<div class="aspect-video bg-gradient-to-br from-iris/20 to-ember/15">
										{#if world.thumbnailAssetId && previews[world.thumbnailAssetId]}
											<PanoramaView src={previews[world.thumbnailAssetId]} class="h-full w-full object-cover" />
										{/if}
									</div>
									<div class="px-4 py-3">
										<p class="truncate text-sm font-medium">{world.name}</p>
										{#if world.note}<p class="mt-0.5 text-xs text-bone/45">{world.note}</p>{/if}
									</div>
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}

		<aside class="mt-14 flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h2 class="font-display text-lg font-medium tracking-[-0.02em]">New here, or building something?</h2>
				<p class="mt-1 text-sm text-bone/55">The wiki has guides for playing, creating worlds and objects, and importing avatars.</p>
			</div>
			<div class="flex shrink-0 flex-wrap gap-2 text-sm">
				<a href="/wiki/getting-started/quick-start" class="rounded-full bg-bone px-4 py-2 font-medium text-ink transition hover:bg-glow">Quick start</a>
				<a href="/wiki" class="rounded-full border border-white/20 bg-white/5 px-4 py-2 transition hover:bg-white/10">Browse the wiki</a>
			</div>
		</aside>
	</main>
</div>
