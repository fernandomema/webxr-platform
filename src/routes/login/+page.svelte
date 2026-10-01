<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';

	let identifier = $state(''); // email or username
	let password = $state('');
	let error = $state('');

	async function submit(e: Event) {
		e.preventDefault();
		error = '';
		const { error: err } = identifier.includes('@')
			? await authClient.signIn.email({ email: identifier, password })
			: await authClient.signIn.username({ username: identifier, password });
		if (err) {
			error = err.message ?? 'Sign-in failed';
			return;
		}
		goto('/play');
	}
</script>

<!--
	Classic web fallback only (if JS/WebGL fails) — the normal login flow
	happens inside the in-VR Dash panel, see src/lib/xr/ui/dashPanel.ts.
-->
<div class="flex min-h-screen items-center justify-center bg-gray-950 text-white">
	<form onsubmit={submit} class="w-80 space-y-3 rounded-lg bg-gray-900 p-6">
		<h1 class="text-xl font-semibold">Sign in</h1>
		<input
			class="w-full rounded bg-gray-800 p-2"
			type="text"
			placeholder="Email or username"
			bind:value={identifier}
			required
		/>
		<input
			class="w-full rounded bg-gray-800 p-2"
			type="password"
			placeholder="Password"
			bind:value={password}
			required
		/>
		{#if error}<p class="text-sm text-red-400">{error}</p>{/if}
		<button class="w-full rounded bg-blue-600 p-2 font-medium" type="submit">Sign in</button>
		<a href="/register" class="block text-center text-sm text-gray-400">Create an account</a>
		<a href="/privacy" class="block text-center text-sm text-gray-400">Privacy Policy</a>
	</form>
</div>
