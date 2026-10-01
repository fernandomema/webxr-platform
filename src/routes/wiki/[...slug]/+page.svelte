<script lang="ts">
	import { tick } from 'svelte';
	import { PLATFORM_NAME } from '$lib/platform';
	import { editUrl, pageTitle } from '$lib/wiki/content';

	let { data } = $props();
	let Content = $derived(data.content);
	let article = $state<HTMLElement>();
	let toc = $state<{ id: string; text: string; level: number }[]>([]);
	let activeId = $state('');
	const href = (slug: string) => `/wiki${slug ? `/${slug}` : ''}`;

	// Headings come from compiled markdown, so ids and the outline are built from the rendered DOM.
	$effect(() => {
		void Content;
		let observer: IntersectionObserver | undefined;
		let cancelled = false;
		tick().then(() => {
			if (cancelled || !article) return;
			const used = new Set<string>();
			const heads = [...article.querySelectorAll<HTMLElement>('h2, h3')];
			toc = heads.map((h) => {
				const text = h.textContent?.trim() ?? '';
				let id = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
				for (let n = 2; used.has(id); n++) id = `${id}-${n}`;
				used.add(id);
				h.id = id;
				return { id, text, level: h.tagName === 'H2' ? 2 : 3 };
			});
			activeId = toc[0]?.id ?? '';
			observer = new IntersectionObserver(
				(entries) => {
					const hit = entries.find((e) => e.isIntersecting);
					if (hit) activeId = hit.target.id;
				},
				{ rootMargin: '-80px 0px -70% 0px' }
			);
			heads.forEach((h) => observer!.observe(h));
		});
		return () => {
			cancelled = true;
			observer?.disconnect();
		};
	});
</script>

<svelte:head>
	<title>{pageTitle(data.page)} · {PLATFORM_NAME} Wiki</title>
	{#if data.page.meta.description}<meta name="description" content={data.page.meta.description} />{/if}
</svelte:head>

<div class="xl:grid xl:grid-cols-[minmax(0,1fr)_14rem] xl:gap-10">
	<div class="min-w-0 max-w-3xl">
		<header class="mb-8">
			{#if data.page.section}
				<p class="mb-2 text-xs font-semibold tracking-[0.14em] text-ember uppercase">{data.page.section.replace(/-/g, ' ')}</p>
			{/if}
			<h1 class="font-display text-4xl font-bold tracking-tight text-bone">{pageTitle(data.page)}</h1>
			{#if data.page.meta.description}
				<p class="mt-3 text-lg text-bone/60">{data.page.meta.description}</p>
			{/if}
		</header>

		<article bind:this={article} class="wiki-prose">
			<Content />
		</article>

		<p class="mt-10 text-sm">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={editUrl(data.page)} target="_blank" rel="noopener noreferrer" class="text-bone/50 transition hover:text-ember">Edit this page on GitHub ↗</a>
		</p>

		<nav class="mt-6 grid gap-3 border-t border-white/10 pt-6 sm:grid-cols-2" aria-label="Pagination">
			{#if data.prev}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={href(data.prev.slug)} class="rounded-lg border border-white/10 p-4 transition hover:border-ember/50 hover:bg-white/5">
					<span class="block text-xs text-bone/50">Previous</span>
					<span class="font-medium text-bone">← {pageTitle(data.prev)}</span>
				</a>
			{:else}<span></span>{/if}
			{#if data.next}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={href(data.next.slug)} class="rounded-lg border border-white/10 p-4 text-right transition hover:border-ember/50 hover:bg-white/5 sm:col-start-2">
					<span class="block text-xs text-bone/50">Next</span>
					<span class="font-medium text-bone">{pageTitle(data.next)} →</span>
				</a>
			{/if}
		</nav>
	</div>

	{#if toc.length > 1}
		<aside class="hidden xl:block">
			<div class="sticky top-24">
				<h2 class="mb-3 text-[0.7rem] font-semibold tracking-[0.14em] text-bone/40 uppercase">On this page</h2>
				<ul class="space-y-1.5 border-l border-white/10 text-sm">
					{#each toc as item (item.id)}
						<li>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
							<a
								href={`#${item.id}`}
								class="-ml-px block border-l py-0.5 transition {item.level === 3 ? 'pl-6' : 'pl-3'} {activeId === item.id
									? 'border-ember text-ember'
									: 'border-transparent text-bone/55 hover:text-bone'}">{item.text}</a
							>
						</li>
					{/each}
				</ul>
			</div>
		</aside>
	{/if}
</div>
