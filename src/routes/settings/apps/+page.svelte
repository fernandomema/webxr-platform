<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { PLATFORM_NAME } from '$lib/platform';
	import type { PageProps } from './$types';

	interface Product { sku: string; name: string; price: number; repeatable: boolean }
	interface Draft { id: string; name: string; origins: string; products: Product[] }

	let { data }: PageProps = $props();
	let newName = $state('');
	let busy = $state<string | null>(null);
	let error = $state('');
	let saved = $state('');
	let copied = $state('');

	const draftOf = (app: PageProps['data']['apps'][number]): Draft => ({ id: app.id, name: app.name, origins: app.origins.join('\n'), products: app.products.map((product) => ({ ...product })) });
	let drafts = $state<Draft[]>([]);
	$effect(() => { drafts = data.apps.map(draftOf); });

	async function send(path: string, method: string, body?: unknown) {
		const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
		if (!response.ok) {
			const failure = (await response.json().catch(() => null)) as { message?: string } | null;
			throw new Error(failure?.message ?? 'Something went wrong.');
		}
	}

	async function run(key: string, action: () => Promise<void>) {
		busy = key; error = ''; saved = '';
		try { await action(); await invalidateAll(); } catch (caught) { error = caught instanceof Error ? caught.message : 'Something went wrong.'; }
		busy = null;
	}

	const create = () => run('new', async () => { await send('/api/apps', 'POST', { name: newName }); newName = ''; });
	const save = (draft: Draft) => run(draft.id, async () => {
		await send(`/api/apps/${draft.id}`, 'PUT', { name: draft.name, origins: draft.origins.split(/\s+/).filter(Boolean), products: draft.products });
		saved = draft.id;
	});
	const remove = (draft: Draft) => { if (confirm(`Delete "${draft.name}" and everything it saved: players' data, leaderboards and purchases?`)) void run(draft.id, () => send(`/api/apps/${draft.id}`, 'DELETE')); };
	async function copy(id: string) {
		try { await navigator.clipboard.writeText(id); copied = id; } catch { /* the id is shown, it can be selected */ }
	}

	const field = 'w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-bone placeholder:text-bone/30 outline-none transition focus:border-iris/60 focus:ring-2 focus:ring-iris/20';
	const button = 'rounded-full bg-bone px-4 py-2 text-sm font-medium text-ink transition hover:bg-glow disabled:opacity-60';
	const quiet = 'rounded-full border border-white/15 px-4 py-2 text-sm text-bone transition hover:bg-white/5 disabled:opacity-60';
</script>

<svelte:head><title>Apps · {PLATFORM_NAME}</title></svelte:head>

<section>
	<h2 class="text-lg font-medium">Apps</h2>
	<p class="mt-1 text-sm text-bone/60">An app is a game of your own, on its own site, that uses {PLATFORM_NAME} for accounts, saved data, leaderboards, credits and multiplayer. All its levels share the app's id, so you do not publish each one here.</p>
	{#if error}<p class="mt-4 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300" role="alert">{error}</p>{/if}

	<form class="mt-6 flex gap-2" onsubmit={(event) => { event.preventDefault(); void create(); }}>
		<input class={field} placeholder="Name of your game" aria-label="Name of the new app" maxlength="80" bind:value={newName} required />
		<button class={button} type="submit" disabled={busy === 'new' || !newName.trim()}>Create app</button>
	</form>

	{#each drafts as draft (draft.id)}
		<div class="mt-6 rounded-xl border border-white/10 p-5">
			<div class="flex flex-wrap items-center gap-3">
				<input class={[field, 'max-w-xs font-medium']} aria-label="App name" maxlength="80" bind:value={draft.name} />
				<button type="button" class="font-mono text-xs text-bone/60 hover:text-bone" onclick={() => copy(draft.id)} title="Copy the app id">{draft.id} {copied === draft.id ? '· copied' : ''}</button>
			</div>
			<p class="mt-1 text-xs text-bone/50">Give this id to the engine: <code>configurePlatform({'{'} appId: '{draft.id}' {'}'})</code></p>

			<h3 class="mt-5 text-sm font-medium">Sites it runs on</h3>
			<p class="text-xs text-bone/50">One per line, such as https://mygame.example (http is only for localhost). Only these sites may use your app.</p>
			<textarea class={[field, 'mt-2 font-mono']} rows="3" aria-label="Sites" bind:value={draft.origins}></textarea>

			<h3 class="mt-5 text-sm font-medium">What it sells</h3>
			<p class="text-xs text-bone/50">Prices are in credits. The game asks to buy a product by its code; the player always confirms.</p>
			{#each draft.products as product, index (index)}
				<div class="mt-2 grid grid-cols-[1fr_2fr_6rem_auto_auto] items-center gap-2">
					<input class={field} placeholder="code" aria-label="Product code" bind:value={product.sku} />
					<input class={field} placeholder="Name" aria-label="Product name" bind:value={product.name} />
					<input class={field} type="number" min="1" placeholder="Price" aria-label="Price in credits" bind:value={product.price} />
					<label class="flex items-center gap-1 text-xs text-bone/60"><input type="checkbox" bind:checked={product.repeatable} /> repeatable</label>
					<button type="button" class="text-sm text-bone/50 hover:text-red-300" aria-label="Remove product" onclick={() => draft.products.splice(index, 1)}>✕</button>
				</div>
			{/each}
			<button type="button" class="mt-2 text-sm text-bone/70 hover:text-bone" onclick={() => draft.products.push({ sku: '', name: '', price: 100, repeatable: false })}>+ Add a product</button>

			<div class="mt-6 flex items-center gap-3">
				<button class={button} type="button" disabled={busy === draft.id} onclick={() => save(draft)}>{busy === draft.id ? 'Saving…' : 'Save'}</button>
				<button class={quiet} type="button" disabled={busy === draft.id} onclick={() => remove(draft)}>Delete</button>
				{#if saved === draft.id}<span class="text-sm text-emerald-300">Saved</span>{/if}
			</div>
		</div>
	{/each}
	{#if drafts.length === 0}<p class="mt-6 text-sm text-bone/60">You have no apps yet.</p>{/if}
</section>
