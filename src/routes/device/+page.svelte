<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import { PLATFORM_NAME } from '$lib/platform';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let code = $state((page.url.searchParams.get('user_code') ?? '').toUpperCase());
	let stage = $state<'enter' | 'confirm' | 'approved' | 'denied'>('enter');
	let error = $state('');
	let busy = $state(false);

	const clean = (value: string) => value.replace(/[^a-z0-9]/gi, '').toUpperCase();

	async function check(event: Event) {
		event.preventDefault();
		error = ''; busy = true;
		const { error: failure } = await authClient.device({ query: { user_code: clean(code) } });
		busy = false;
		if (failure) { error = 'That code is not valid, or it has expired. Check it on the screen of the game.'; return; }
		stage = 'confirm';
	}

	async function decide(approve: boolean) {
		error = ''; busy = true;
		const { error: failure } = approve ? await authClient.device.approve({ userCode: clean(code) }) : await authClient.device.deny({ userCode: clean(code) });
		busy = false;
		if (failure) { error = failure.error_description ?? 'Something went wrong. Try again.'; return; }
		stage = approve ? 'approved' : 'denied';
	}

	const field = 'w-full rounded-lg border border-white/10 bg-ink px-3 py-2.5 text-center font-mono text-lg uppercase tracking-[0.3em] text-bone placeholder:text-bone/30 outline-none transition focus:border-iris/60 focus:ring-2 focus:ring-iris/20';
	const primary = 'w-full rounded-full bg-bone px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-glow disabled:opacity-60';
	const secondary = 'w-full rounded-full border border-white/15 px-4 py-2.5 text-sm font-medium text-bone transition hover:bg-white/5 disabled:opacity-60';
</script>

<svelte:head><title>Connect a game · {PLATFORM_NAME}</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-ink px-5 py-10 text-bone">
	<main class="w-full max-w-[400px]">
		<a class="mb-8 flex justify-center" href={resolve('/')} aria-label="{PLATFORM_NAME} home"><img src="/assets/kithin-logo.svg" alt={PLATFORM_NAME} class="h-9 w-auto" /></a>
		<div class="rounded-2xl border border-white/10 bg-ink-2/90 p-7 shadow-2xl shadow-black/40">
			{#if stage === 'enter'}
				<h1 class="font-display text-2xl font-semibold">Connect a game</h1>
				<p class="mt-1 text-sm text-bone/60">Type the code the game shows to sign it in as {data.userName}.</p>
				<form onsubmit={check} class="mt-6 space-y-3">
					<input class={field} type="text" placeholder="ABCD-EFGH" aria-label="Code" autocomplete="off" maxlength="12" bind:value={code} required />
					<button class={primary} type="submit" disabled={busy || clean(code).length === 0}>{busy ? 'Checking…' : 'Continue'}</button>
				</form>
			{:else if stage === 'confirm'}
				<h1 class="font-display text-2xl font-semibold">Allow this game?</h1>
				<p class="mt-1 text-sm text-bone/60">The game with the code <span class="font-mono text-bone">{clean(code)}</span> will be able to play, host and save as {data.userName}. Only continue if you started this from a game you trust.</p>
				<div class="mt-6 space-y-2">
					<button class={primary} type="button" onclick={() => decide(true)} disabled={busy}>Allow</button>
					<button class={secondary} type="button" onclick={() => decide(false)} disabled={busy}>Deny</button>
				</div>
			{:else if stage === 'approved'}
				<h1 class="font-display text-2xl font-semibold">Done</h1>
				<p class="mt-1 text-sm text-bone/60">You can go back to the game: it is signed in.</p>
			{:else}
				<h1 class="font-display text-2xl font-semibold">Denied</h1>
				<p class="mt-1 text-sm text-bone/60">The game was not signed in.</p>
			{/if}
			{#if error}<p class="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">{error}</p>{/if}
		</div>
	</main>
</div>
