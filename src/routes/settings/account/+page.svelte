<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { PLATFORM_NAME } from '$lib/platform';

	let hasPassword = $state(false);
	let password = $state('');
	let confirmation = $state('');
	let busy = $state(false);
	let error = $state('');
	const CONFIRM_WORD = 'DELETE';

	$effect(() => {
		authClient.listAccounts().then(({ data }) => { hasPassword = !!data?.some((account) => account.providerId === 'credential'); });
	});

	async function deleteAccount(event: Event) {
		event.preventDefault();
		busy = true; error = '';
		const { error: failure } = await authClient.deleteUser(hasPassword ? { password } : {});
		if (failure) { error = failure.message ?? 'Could not delete your account.'; busy = false; return; }
		await goto('/');
	}
</script>

<svelte:head><title>Data &amp; Account · {PLATFORM_NAME}</title></svelte:head>

<div class="space-y-10">
	<section>
		<h2 class="text-lg font-medium">Export your data</h2>
		<p class="mt-1 text-sm text-bone/60">Download a JSON file with your profile, worlds, inventory, published worlds, marketplace activity, model list and feedback. Passwords and access tokens are never included, and model files are listed by id rather than bundled.</p>
		<a class="mt-4 inline-block rounded-full bg-bone px-4 py-2 text-sm font-medium text-ink hover:bg-glow" href="/api/account/export" download>Download my data</a>
	</section>

	<section>
		<h2 class="text-lg font-medium text-red-300">Delete account</h2>
		<form class="mt-4 space-y-4 rounded-xl border border-red-500/30 bg-red-500/5 p-5" onsubmit={deleteAccount}>
			<p class="text-sm text-bone/70">This permanently deletes your account and everything you own: worlds, inventory, published worlds, marketplace listings, feedback and uploaded models. It can't be undone. Download your data first if you want a copy.</p>
			{#if hasPassword}
				<label class="block text-sm text-bone/60">Password
					<input class="mt-1 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-bone outline-none focus:border-red-400/60" type="password" bind:value={password} required autocomplete="current-password" />
				</label>
			{/if}
			<label class="block text-sm text-bone/60">Type <strong class="text-bone">{CONFIRM_WORD}</strong> to confirm
				<input class="mt-1 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-bone outline-none focus:border-red-400/60" bind:value={confirmation} autocomplete="off" />
			</label>
			<button class="rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-40" type="submit" disabled={busy || confirmation !== CONFIRM_WORD || (hasPassword && !password)}>{busy ? 'Deleting…' : 'Delete my account'}</button>
			{#if error}<p class="text-sm text-red-400" role="alert">{error}</p>{/if}
		</form>
	</section>
</div>
