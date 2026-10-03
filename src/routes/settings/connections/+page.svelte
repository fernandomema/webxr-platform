<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { PLATFORM_NAME } from '$lib/platform';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let busy = $state(false);
	let error = $state('');

	async function disconnect() {
		busy = true; error = '';
		try {
			const response = await fetch('/api/connections/openrouter', { method: 'DELETE' });
			if (!response.ok) throw new Error('Could not disconnect.');
			await invalidateAll();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not disconnect.';
		} finally { busy = false; }
	}
</script>

<svelte:head><title>Connections · {PLATFORM_NAME}</title></svelte:head>

<section>
	<h2 class="text-lg font-medium">Connections</h2>
	<p class="mt-1 text-sm text-bone/60">Link outside accounts so {PLATFORM_NAME} can use them for you.</p>

	{#if data.notice === 'connected'}<p class="mt-4 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">OpenRouter connected.</p>{/if}
	{#if data.notice === 'failed'}<p class="mt-4 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300">Could not connect OpenRouter. Please try again.</p>{/if}

	<div class="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-ink-2 p-5">
		<div class="min-w-0">
			<h3 class="font-medium">OpenRouter</h3>
			<p class="mt-1 text-sm text-bone/60">Powers the AI assistant in the Studio. {data.openrouter ? 'Connected — usage is billed to your OpenRouter account.' : 'Not connected.'}</p>
			<p class="mt-1 text-xs text-bone/40">Your key is stored encrypted and is never sent to the browser.</p>
		</div>
		{#if data.openrouter}
			<button class="rounded-full border border-white/15 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50" onclick={disconnect} disabled={busy}>{busy ? 'Disconnecting…' : 'Disconnect'}</button>
		{:else}
			<form method="POST" action="/api/connections/openrouter">
				<input type="hidden" name="returnTo" value="/settings/connections" />
				<button class="rounded-full bg-bone px-4 py-2 text-sm font-medium text-ink hover:bg-glow" type="submit">Connect OpenRouter</button>
			</form>
		{/if}
	</div>
	{#if error}<p class="mt-3 text-sm text-red-400">{error}</p>{/if}
</section>
