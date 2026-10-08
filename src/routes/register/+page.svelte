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
	let name = $state('');
	let email = $state('');
	let username = $state('');
	let password = $state('');
	let error = $state(page.url.searchParams.get('error') ? 'Sign-up with Discord failed. Please try again.' : '');
	let busy = $state(false);
	const next = $derived(safeNext(page.url.searchParams.get('next')));

	async function submit(e: Event) {
		e.preventDefault();
		error = ''; busy = true;
		const { error: err } = await authClient.signUp.email({
			name: name || username,
			email,
			password,
			...(username ? { username } : {})
		});
		busy = false;
		if (err) { error = err.message ?? 'Sign-up failed'; return; }
		await goto(next);
	}

	const field = 'w-full rounded-lg border border-white/10 bg-ink px-3 py-2.5 text-sm text-bone placeholder:text-bone/30 outline-none transition focus:border-iris/60 focus:ring-2 focus:ring-iris/20';
</script>

<svelte:head><title>Create account · {PLATFORM_NAME}</title></svelte:head>

<!-- Classic web sign-up — see src/routes/login/+page.svelte. -->
<AuthShell title="Create your account" subtitle="Build and explore worlds on {PLATFORM_NAME}." discordEnabled={data.discordEnabled} {next} {error}>
	<form onsubmit={submit} class="space-y-3">
		<input class={field} type="text" placeholder="Name" aria-label="Name" autocomplete="name" bind:value={name} />
		<input class={field} type="text" placeholder="Username" aria-label="Username" autocomplete="username" minlength="3" maxlength="30" bind:value={username} />
		<input class={field} type="email" placeholder="Email" aria-label="Email" autocomplete="email" bind:value={email} required />
		<input class={field} type="password" placeholder="Password (8+ characters)" aria-label="Password" autocomplete="new-password" minlength="8" bind:value={password} required />
		<button class="w-full rounded-full bg-bone px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-glow disabled:opacity-60" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
	</form>
	{#snippet footer()}
		<p>Already have an account? <a class="text-bone underline-offset-4 hover:underline" href={resolve('/login')}>Sign in</a></p>
		<p><a class="hover:text-bone" href={resolve('/privacy')}>Privacy Policy</a></p>
	{/snippet}
</AuthShell>
