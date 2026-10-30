<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { PLATFORM_NAME } from '$lib/platform';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let who = $state('');
	let busy = $state(false);
	let error = $state('');
	let info = $state('');
	let code = $state<string | null>(null);

	const shownCode = $derived.by(() => {
		const value = code ?? data.code;
		return value.length === 8 ? `${value.slice(0, 4)}-${value.slice(4)}` : value;
	});

	async function send(path: string, init: RequestInit, done = '') {
		busy = true; error = ''; info = '';
		try {
			const response = await fetch(path, init);
			const result = (await response.json().catch(() => null)) as { message?: string; status?: string; code?: string } | null;
			if (!response.ok) throw new Error(response.status === 404 ? 'No one was found with that.' : (result?.message ?? 'Something went wrong.'));
			info = result?.status === 'friends' ? 'You are friends now.' : done;
			await invalidateAll();
			return result;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Something went wrong.';
			return null;
		} finally {
			busy = false;
		}
	}

	const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

	async function add(event: SubmitEvent) {
		event.preventDefault();
		const value = who.trim().replace(/^@/, '');
		if (!value) return;
		const looksLikeCode = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(value) || /^[A-Z0-9]{8}$/.test(value);
		let result = await send('/api/friends/requests', post(looksLikeCode ? { code: value } : { username: value }), 'Request sent.');
		// A username can look like a code.
		if (!result && looksLikeCode && error === 'No one was found with that.') result = await send('/api/friends/requests', post({ username: value }), 'Request sent.');
		if (result) who = '';
	}

	async function newCode() {
		const result = await send('/api/friends/code', { method: 'POST' }, 'Your old code no longer works.');
		if (result?.code) code = result.code;
	}
</script>

<svelte:head><title>Friends · {PLATFORM_NAME}</title></svelte:head>

<section>
	<h2 class="text-lg font-medium">Friends</h2>
	<p class="mt-1 text-sm text-bone/60">Friends can see which session you are hosting and join it when it is open to friends.</p>

	{#if error}<p class="mt-4 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300" role="alert">{error}</p>{/if}
	{#if info}<p class="mt-4 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300" role="status">{info}</p>{/if}

	<div class="mt-6 rounded-xl border border-white/10 p-5">
		<form class="flex flex-wrap gap-3" onsubmit={add}>
			<input class="min-w-0 flex-1 rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm" placeholder="Username or friend code" bind:value={who} maxlength="64" aria-label="Username or friend code" />
			<button class="rounded-lg bg-bone px-4 py-2 text-sm font-medium text-ink disabled:opacity-50" disabled={busy || !who.trim()}>Send request</button>
		</form>
		<p class="mt-4 text-sm text-bone/60">Your friend code: <span class="font-mono text-bone">{shownCode}</span>
			<button class="ml-3 text-bone/60 underline hover:text-bone" disabled={busy} onclick={newCode}>Get a new code</button></p>
	</div>

	{#if data.overview.incoming.length > 0}
		<h3 class="mt-8 text-base font-medium">Requests ({data.overview.incoming.length})</h3>
		<ul class="mt-3 divide-y divide-white/6 rounded-xl border border-white/10">
			{#each data.overview.incoming as request (request.id)}
				<li class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
					<div><p>{request.from.name}</p>{#if request.from.username}<p class="text-xs text-bone/50">@{request.from.username}</p>{/if}</div>
					<div class="flex gap-2">
						<button class="rounded-lg bg-bone px-3 py-1.5 text-ink disabled:opacity-50" disabled={busy} onclick={() => send(`/api/friends/requests/${request.id}`, post({ action: 'accept' }), '')}>Accept</button>
						<button class="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-50" disabled={busy} onclick={() => send(`/api/friends/requests/${request.id}`, post({ action: 'decline' }), '')}>Decline</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<h3 class="mt-8 text-base font-medium">Friends ({data.overview.friends.length})</h3>
	{#if data.overview.friends.length === 0}
		<p class="mt-2 text-sm text-bone/60">No friends yet. Send a request with a username or share your code.</p>
	{:else}
		<ul class="mt-3 divide-y divide-white/6 rounded-xl border border-white/10">
			{#each data.overview.friends as friend (friend.id)}
				<li class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
					<div>
						<p>{friend.name}</p>
						<p class="text-xs {friend.session ? 'text-emerald-300' : 'text-bone/50'}">{friend.session ? `Playing ${friend.session.worldName}` : 'Not in a session'}</p>
					</div>
					<div class="flex gap-2">
						<button class="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-50" disabled={busy} onclick={() => send(`/api/friends/${friend.id}`, { method: 'DELETE' }, `${friend.name} was removed.`)}>Remove</button>
						<button class="rounded-lg border border-white/10 px-3 py-1.5 text-red-300 disabled:opacity-50" disabled={busy} onclick={() => send('/api/friends/blocks', post({ userId: friend.id }), `${friend.name} was blocked.`)}>Block</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.overview.outgoing.length > 0}
		<h3 class="mt-8 text-base font-medium">Sent requests</h3>
		<ul class="mt-3 divide-y divide-white/6 rounded-xl border border-white/10">
			{#each data.overview.outgoing as request (request.id)}
				<li class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
					<p>{request.to.name} <span class="text-xs text-bone/50">waiting for an answer</span></p>
					<button class="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-50" disabled={busy} onclick={() => send(`/api/friends/requests/${request.id}`, post({ action: 'cancel' }), 'Request cancelled.')}>Cancel</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.blocked.length > 0}
		<h3 class="mt-8 text-base font-medium">Blocked</h3>
		<ul class="mt-3 divide-y divide-white/6 rounded-xl border border-white/10">
			{#each data.blocked as person (person.id)}
				<li class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
					<p>{person.name}</p>
					<button class="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-50" disabled={busy} onclick={() => send('/api/friends/blocks', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: person.id }) }, `${person.name} was unblocked.`)}>Unblock</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
