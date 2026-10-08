<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
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

	let discordId = $state<string | null>(null);
	const discordLinked = $derived(discordId !== null);
	let discordReady = $state(false);
	let discordBusy = $state(false);

	async function loadDiscord() {
		const { data: list } = await authClient.listAccounts();
		discordId = list?.find((account) => account.providerId === 'discord')?.id ?? null;
		discordReady = true;
	}
	$effect(() => { void loadDiscord(); });

	async function connectDiscord() {
		discordBusy = true; error = '';
		const { error: failure } = await authClient.linkSocial({ provider: 'discord', callbackURL: '/settings/connections?discord=connected', errorCallbackURL: '/settings/connections?discord=failed' });
		if (failure) { error = failure.message ?? 'Could not connect Discord.'; discordBusy = false; }
	}

	async function disconnectDiscord() {
		discordBusy = true; error = '';
		const { error: failure } = await authClient.unlinkAccount({ accountId: discordId! });
		if (failure) error = failure.message ?? 'Could not disconnect Discord. You need another way to sign in first.';
		else await loadDiscord();
		discordBusy = false;
	}
</script>

<svelte:head><title>Connections · {PLATFORM_NAME}</title></svelte:head>

<section>
	<h2 class="text-lg font-medium">Connections</h2>
	<p class="mt-1 text-sm text-bone/60">Link outside accounts so {PLATFORM_NAME} can use them for you.</p>

	{#if data.notice === 'connected'}<p class="mt-4 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">OpenRouter connected.</p>{/if}
	{#if data.notice === 'failed'}<p class="mt-4 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300">Could not connect OpenRouter. Please try again.</p>{/if}

	{#if data.discordNotice === 'connected'}<p class="mt-4 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">Discord connected.</p>{/if}
	{#if data.discordNotice === 'failed'}<p class="mt-4 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300">Could not connect Discord{data.discordError ? ` (${data.discordError.replaceAll('_', ' ')})` : ''}. It may already be linked to another account.</p>{/if}

	{#if data.discordEnabled}
		<div class="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-ink-2 p-5">
			<div class="min-w-0">
				<h3 class="font-medium">Discord</h3>
				<p class="mt-1 text-sm text-bone/60">{discordLinked ? 'Connected — you can sign in to ' + PLATFORM_NAME + ' with Discord.' : 'Link your Discord account to sign in with it.'}</p>
			</div>
			{#if discordReady}
				{#if discordLinked}
					<button class="rounded-full border border-white/15 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50" onclick={disconnectDiscord} disabled={discordBusy}>{discordBusy ? 'Disconnecting…' : 'Disconnect'}</button>
				{:else}
					<button class="rounded-full bg-bone px-4 py-2 text-sm font-medium text-ink hover:bg-glow disabled:opacity-50" onclick={connectDiscord} disabled={discordBusy}>{discordBusy ? 'Redirecting…' : 'Connect Discord'}</button>
				{/if}
			{/if}
		</div>
	{/if}

	<div class="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-ink-2 p-5">
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
