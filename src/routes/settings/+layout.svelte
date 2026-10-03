<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { PLATFORM_NAME } from '$lib/platform';

	let { children } = $props();
	const tabs = [
		{ href: '/settings', label: 'General' },
		{ href: '/settings/connections', label: 'Connections' }
	] as const;
</script>

<div class="min-h-screen bg-ink text-bone antialiased">
	<header class="border-b border-white/6">
		<div class="mx-auto flex max-w-[860px] items-center justify-between px-5 py-4 sm:px-8">
			<a href={resolve('/')} aria-label="{PLATFORM_NAME} home"><img src="/assets/kithin-logo.svg" alt={PLATFORM_NAME} class="h-7 w-auto" /></a>
			<a class="text-sm text-bone/60 hover:text-bone" href={resolve('/play')}>Back to {PLATFORM_NAME}</a>
		</div>
	</header>
	<main class="mx-auto max-w-[860px] px-5 py-10 sm:px-8">
		<h1 class="text-3xl font-semibold">Settings</h1>
		<nav class="mt-6 flex gap-1 border-b border-white/10" aria-label="Settings sections">
			{#each tabs as tab (tab.href)}
				{@const active = page.url.pathname.replace(/\/$/, '') === tab.href}
				<a href={tab.href} aria-current={active ? 'page' : undefined} class="-mb-px border-b-2 px-4 py-2 text-sm transition {active ? 'border-bone text-bone' : 'border-transparent text-bone/60 hover:text-bone'}">{tab.label}</a>
			{/each}
		</nav>
		<div class="mt-8">{@render children()}</div>
	</main>
</div>
