<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import AuthShell from '$lib/auth/AuthShell.svelte';
	import { safeNext } from '$lib/auth/safeNext';
	import { PLATFORM_NAME } from '$lib/platform';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let identifier = $state(''); // email or username
	let password = $state('');
	let error = $state(page.url.searchParams.get('error') ? 'Sign-in with Discord failed. Please try again.' : '');
	let busy = $state(false);
	const next = $derived(safeNext(page.url.searchParams.get('next')));

	async function submit(e: Event) {
		e.preventDefault();
		error = ''; busy = true;
		const { error: err } = identifier.includes('@')
			? await authClient.signIn.email({ email: identifier, password })
			: await authClient.signIn.username({ username: identifier, password });
		busy = false;
		if (err) { error = err.message ?? 'Sign-in failed'; return; }
		await goto(next);
	}

	const field = 'w-full rounded-lg border border-white/10 bg-ink px-3 py-2.5 text-sm text-bone placeholder:text-bone/30 outline-none transition focus:border-iris/60 focus:ring-2 focus:ring-iris/20';
</script>

<svelte:head><title>Sign in · {PLATFORM_NAME}</title></svelte:head>

<!-- Classic web sign-in; inside VR the same flow lives in the Dash panel (src/lib/xr/ui/dashPanel.ts). -->
<AuthShell title="Welcome back" subtitle="Sign in to continue to {PLATFORM_NAME}." discordEnabled={data.discordEnabled} {next} {error}>
	<form onsubmit={submit} class="space-y-3">
		<input class={field} type="text" placeholder="Email or username" aria-label="Email or username" autocomplete="username" bind:value={identifier} required />
		<input class={field} type="password" placeholder="Password" aria-label="Password" autocomplete="current-password" bind:value={password} required />
		<button class="w-full rounded-full bg-bone px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-glow disabled:opacity-60" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
	</form>
	{#snippet footer()}
		<p>New here? <a class="text-bone underline-offset-4 hover:underline" href={resolve('/register')}>Create an account</a></p>
		<p><a class="hover:text-bone" href={resolve('/privacy')}>Privacy Policy</a></p>
	{/snippet}
</AuthShell>
