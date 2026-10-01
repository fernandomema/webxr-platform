<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import { PLATFORM_NAME } from '$lib/platform';
	import { pageTitle } from '$lib/wiki/content';

	let { data, children } = $props();
	let menuOpen = $state(false);
	const href = (slug: string) => `/wiki${slug ? `/${slug}` : ''}`;
	const label = (name: string) => name.replace(/-/g, ' ');
	let current = $derived(page.url.pathname.replace(/\/+$/, ''));

	afterNavigate(() => (menuOpen = false));
</script>

<div class="min-h-screen bg-ink text-bone">
	<header class="sticky top-0 z-30 border-b border-white/10 bg-ink/80 backdrop-blur">
		<div class="mx-auto flex h-14 max-w-[88rem] items-center gap-3 px-4 md:px-6">
			<button
				class="-ml-2 rounded p-2 text-bone/70 hover:bg-white/5 md:hidden"
				aria-label="Menu"
				aria-expanded={menuOpen}
				onclick={() => (menuOpen = !menuOpen)}
			>
				<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
			</button>
			<a href={resolve('/')} class="font-display text-base font-bold tracking-tight">{PLATFORM_NAME}</a>
			<a href={resolve('/wiki')} class="rounded-full border border-ember/40 bg-ember/10 px-2.5 py-0.5 text-xs font-medium text-ember">Wiki</a>
			<span class="flex-1"></span>
			<a href={resolve('/')} class="text-sm text-bone/60 transition hover:text-bone">Back to site</a>
		</div>
	</header>

	<div class="mx-auto flex max-w-[88rem] px-4 md:px-6">
		<aside
			class="fixed inset-x-0 top-14 bottom-0 z-20 overflow-y-auto bg-ink px-4 py-6 md:sticky md:block md:h-[calc(100vh-3.5rem)] md:w-64 md:shrink-0 md:border-r md:border-white/10 md:bg-transparent md:pr-6 md:pl-0 {menuOpen ? 'block' : 'hidden'}"
		>
			<nav aria-label="Wiki">
				{#each data.sections as section (section.name)}
					{#if section.name}
						<h2 class="mt-6 mb-2 px-2 text-[0.7rem] font-semibold tracking-[0.14em] text-bone/40 uppercase">{label(section.name)}</h2>
					{/if}
					<ul class="space-y-0.5">
						{#each section.pages as p (p.slug)}
							{@const active = current === href(p.slug)}
							<li>
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
								<a
									href={href(p.slug)}
									aria-current={active ? 'page' : undefined}
									class="block rounded-md border-l-2 px-3 py-1.5 text-sm transition {active
										? 'border-ember bg-ember/10 font-medium text-ember'
										: 'border-transparent text-bone/70 hover:bg-white/5 hover:text-bone'}">{pageTitle(p)}</a
								>
							</li>
						{/each}
					</ul>
				{/each}
			</nav>
		</aside>

		<main class="min-w-0 flex-1 py-10 md:pl-10">{@render children()}</main>
	</div>
</div>

<style>
	:global(.wiki-prose) { line-height: 1.75; color: color-mix(in srgb, var(--color-bone) 85%, transparent); }
	:global(.wiki-prose > :first-child) { margin-top: 0; }
	:global(.wiki-prose h2) { font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; margin: 2.5rem 0 .75rem; padding-bottom: .4rem; border-bottom: 1px solid rgb(255 255 255 / .08); color: var(--color-bone); scroll-margin-top: 5rem; }
	:global(.wiki-prose h3) { font-size: 1.15rem; font-weight: 600; margin: 1.75rem 0 .5rem; color: var(--color-bone); scroll-margin-top: 5rem; }
	:global(.wiki-prose p), :global(.wiki-prose ul), :global(.wiki-prose ol), :global(.wiki-prose pre), :global(.wiki-prose table), :global(.wiki-prose blockquote) { margin: 0 0 1.1rem; }
	:global(.wiki-prose ul) { list-style: disc; padding-left: 1.5rem; }
	:global(.wiki-prose ol) { list-style: decimal; padding-left: 1.5rem; }
	:global(.wiki-prose li) { margin: .25rem 0; }
	:global(.wiki-prose li::marker) { color: var(--color-ember); }
	:global(.wiki-prose a) { color: var(--color-sky); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgb(110 195 255 / .4); }
	:global(.wiki-prose a:hover) { text-decoration-color: currentColor; }
	:global(.wiki-prose strong) { color: var(--color-bone); font-weight: 600; }
	:global(.wiki-prose code) { background: var(--color-haze); border: 1px solid rgb(255 255 255 / .06); padding: .1rem .4rem; border-radius: .3rem; font-size: .88em; color: var(--color-glow); }
	:global(.wiki-prose pre) { background: var(--color-ink-2); border: 1px solid rgb(255 255 255 / .08); padding: 1rem 1.2rem; border-radius: .6rem; overflow-x: auto; line-height: 1.6; }
	:global(.wiki-prose pre code) { background: none; border: 0; padding: 0; color: var(--color-bone); }
	:global(.wiki-prose blockquote) { border-left: 3px solid var(--color-ember); background: var(--color-haze); padding: .75rem 1rem; border-radius: 0 .5rem .5rem 0; color: rgb(244 241 234 / .75); }
	:global(.wiki-prose blockquote p) { margin: 0; }
	:global(.wiki-prose table) { display: block; overflow-x: auto; border-collapse: collapse; font-size: .95rem; }
	:global(.wiki-prose th) { text-align: left; background: var(--color-haze); color: var(--color-bone); font-weight: 600; }
	:global(.wiki-prose th), :global(.wiki-prose td) { border: 1px solid rgb(255 255 255 / .1); padding: .5rem .85rem; }
	:global(.wiki-prose hr) { border: 0; border-top: 1px solid rgb(255 255 255 / .1); margin: 2rem 0; }
	:global(.wiki-prose img) { max-width: 100%; border-radius: .5rem; }
</style>
