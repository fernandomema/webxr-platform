<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authClient } from '$lib/auth-client';

	let error = $state('');

	onMount(async () => {
		const { error: signOutError } = await authClient.signOut();

		if (signOutError) {
			error = signOutError.message ?? 'Sign-out failed';
			return;
		}

		await goto('/login', { replaceState: true });
	});
</script>

<div class="flex min-h-screen items-center justify-center bg-gray-950 text-white">
	{#if error}
		<p class="text-sm text-red-400">{error}</p>
	{:else}
		<p class="text-sm text-gray-400">Signing out...</p>
	{/if}
</div>
