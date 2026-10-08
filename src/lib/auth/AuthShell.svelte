<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import { PLATFORM_NAME } from '$lib/platform';

	interface Props {
		title: string;
		subtitle: string;
		discordEnabled: boolean;
		next: string;
		error?: string;
		children: Snippet;
		footer: Snippet;
	}

	let { title, subtitle, discordEnabled, next, error = '', children, footer }: Props = $props();
	let discordBusy = $state(false);
	let discordError = $state('');

	async function continueWithDiscord() {
		discordBusy = true; discordError = '';
		const { error: failure } = await authClient.signIn.social({ provider: 'discord', callbackURL: next, newUserCallbackURL: next, errorCallbackURL: window.location.pathname });
		if (failure) { discordError = failure.message ?? 'Could not reach Discord.'; discordBusy = false; }
	}
</script>

<div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink px-5 py-10 text-bone">
	<div class="pointer-events-none absolute inset-0" aria-hidden="true" style="background: radial-gradient(60rem 30rem at 50% -10%, rgb(155 140 255 / 0.18), transparent 60%), radial-gradient(40rem 24rem at 90% 110%, rgb(255 122 69 / 0.12), transparent 60%)"></div>

	<main class="relative w-full max-w-[400px]">
		<a class="mb-8 flex justify-center" href={resolve('/')} aria-label="{PLATFORM_NAME} home"><img src="/assets/kithin-logo.svg" alt={PLATFORM_NAME} class="h-9 w-auto" /></a>

		<div class="rounded-2xl border border-white/10 bg-ink-2/90 p-7 shadow-2xl shadow-black/40 backdrop-blur">
			<h1 class="font-display text-2xl font-semibold">{title}</h1>
			<p class="mt-1 text-sm text-bone/60">{subtitle}</p>

			{#if discordEnabled}
				<button type="button" onclick={continueWithDiscord} disabled={discordBusy} class="mt-6 flex w-full items-center justify-center gap-2.5 rounded-full bg-[#5865f2] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#4752c4] disabled:opacity-60">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.26a18.3 18.3 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.26.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-2a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1 0-.13c.13-.09.25-.19.37-.29a.07.07 0 0 1 .08-.01c3.93 1.8 8.18 1.8 12.06 0a.07.07 0 0 1 .08.01c.12.1.25.2.37.29a.08.08 0 0 1 0 .13c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.37 1.23 2a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42s.96-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.16-1.09-2.16-2.42s.96-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42Z" /></svg>
					{discordBusy ? 'Redirecting…' : 'Continue with Discord'}
				</button>
				{#if discordError}<p class="mt-2 text-sm text-red-400">{discordError}</p>{/if}
				<div class="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-bone/30"><span class="h-px flex-1 bg-white/10"></span>or<span class="h-px flex-1 bg-white/10"></span></div>
			{:else}
				<div class="mt-6"></div>
			{/if}

			{@render children()}
			{#if error}<p class="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">{error}</p>{/if}
		</div>

		<div class="mt-6 space-y-2 text-center text-sm text-bone/60">{@render footer()}</div>
	</main>
</div>
