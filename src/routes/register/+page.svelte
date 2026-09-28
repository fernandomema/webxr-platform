<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';

	let name = $state('');
	let email = $state('');
	let username = $state('');
	let password = $state('');
	let error = $state('');

	async function submit(e: Event) {
		e.preventDefault();
		error = '';
		const { error: err } = await authClient.signUp.email({
			name: name || username,
			email,
			password,
			...(username ? { username } : {})
		});
		if (err) {
			error = err.message ?? 'Sign-up failed';
			return;
		}
		goto('/');
	}
</script>

<!-- Classic web fallback only — see src/routes/login/+page.svelte. -->
<div class="flex min-h-screen items-center justify-center bg-gray-950 text-white">
	<form onsubmit={submit} class="w-80 space-y-3 rounded-lg bg-gray-900 p-6">
		<h1 class="text-xl font-semibold">Create an account</h1>
		<input class="w-full rounded bg-gray-800 p-2" type="text" placeholder="Name" bind:value={name} />
		<input
			class="w-full rounded bg-gray-800 p-2"
			type="text"
			placeholder="Username"
			bind:value={username}
		/>
		<input
			class="w-full rounded bg-gray-800 p-2"
			type="email"
			placeholder="Email"
			bind:value={email}
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
		<button class="w-full rounded bg-blue-600 p-2 font-medium" type="submit">Create account</button>
		<a href="/login" class="block text-center text-sm text-gray-400">I already have an account</a>
	</form>
</div>
