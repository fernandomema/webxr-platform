<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { PLATFORM_NAME } from '$lib/platform';

	let { data, children } = $props();
	const links = [
		{ href: '/admin', label: 'Dashboard' },
		{ href: '/admin/users', label: 'Users' },
		{ href: '/admin/worlds', label: 'Worlds' },
		{ href: '/admin/scoreboards', label: 'Scoreboards' },
		{ href: '/admin/feedback', label: 'Feedback' }
	] as const;
	let menuOpen = $state(false);
	const isActive = (href: string) => {
		const path = page.url.pathname.replace(/\/$/, '');
		return href === '/admin' ? path === href : path === href || path.startsWith(`${href}/`);
	};
</script>

<svelte:head><title>Admin · {PLATFORM_NAME}</title></svelte:head>

<div class="flex min-h-screen flex-col bg-ink text-bone antialiased">
	<header class="sticky top-0 z-30 border-b border-white/6 bg-ink-2">
		<div class="mx-auto flex max-w-[var(--page-width)] items-center gap-6 px-5 py-3 sm:px-8">
			<a href={resolve('/admin')} class="flex items-center gap-2" aria-label="{PLATFORM_NAME} admin">
				<img src="/assets/kithin-logo.svg" alt={PLATFORM_NAME} class="h-6 w-auto" />
				<span class="rounded bg-ember/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-ember uppercase">Admin</span>
			</a>
			<nav class="hidden flex-1 items-center gap-1 md:flex" aria-label="Admin sections">
				{#each links as link (link.href)}
					<a href={link.href} aria-current={isActive(link.href) ? 'page' : undefined} class="rounded-md px-3 py-1.5 text-sm transition {isActive(link.href) ? 'bg-white/10 text-bone' : 'text-bone/60 hover:bg-white/5 hover:text-bone'}">{link.label}</a>
				{/each}
			</nav>
			<div class="ml-auto flex items-center gap-4 text-sm md:ml-0">
				<a class="hidden text-bone/60 hover:text-bone sm:block" href={resolve('/home')}>Back to {PLATFORM_NAME}</a>
				<span class="hidden text-bone/80 sm:block">{data.admin.name}</span>
				<button type="button" class="rounded-md border border-white/10 px-2.5 py-1.5 md:hidden" aria-expanded={menuOpen} aria-label="Toggle menu" onclick={() => (menuOpen = !menuOpen)}>☰</button>
			</div>
		</div>
		{#if menuOpen}
			<nav class="border-t border-white/6 px-5 py-2 md:hidden" aria-label="Admin sections">
				{#each links as link (link.href)}
					<a href={link.href} onclick={() => (menuOpen = false)} class="block rounded-md px-3 py-2 text-sm {isActive(link.href) ? 'bg-white/10 text-bone' : 'text-bone/60'}">{link.label}</a>
				{/each}
			</nav>
		{/if}
	</header>
	<main class="mx-auto w-full max-w-[var(--page-width)] flex-1 px-5 py-8 sm:px-8">{@render children()}</main>
	<footer class="border-t border-white/6 py-4 text-center text-xs text-bone/40">{PLATFORM_NAME} admin</footer>
</div>
