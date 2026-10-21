<script lang="ts">
	import { PLATFORM_NAME } from '$lib/platform';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let busy = $state<string | null>(null);
	let error = $state('');

	const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
	const when = (value: string | Date) => new Date(value).toLocaleString();
	const describe = (row: { kind: string; provider: string | null; sku: string | null }) => {
		if (row.kind === 'purchase') return row.provider === 'meta' ? 'Bought with Meta Quest' : 'Bought with card';
		if (row.kind === 'spend') return `Spent on ${row.sku ?? 'an item'}`;
		return row.kind === 'refund' ? 'Refund' : 'Credits added';
	};

	async function buy(provider: string, packId: string) {
		busy = packId; error = '';
		try {
			const response = await fetch('/api/credits/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, packId }) });
			const result = (await response.json().catch(() => null)) as { url?: string; message?: string } | null;
			if (!response.ok || !result?.url) throw new Error(result?.message ?? 'Could not start the payment.');
			location.href = result.url;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not start the payment.';
			busy = null;
		}
	}
</script>

<svelte:head><title>Credits · {PLATFORM_NAME}</title></svelte:head>

<section>
	<h2 class="text-lg font-medium">Credits</h2>
	<p class="mt-1 text-sm text-bone/60">Credits pay for things inside worlds. Every purchase asks you first, and shows what it costs.</p>

	{#if data.payment === 'success'}<p class="mt-4 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">Thank you. Your credits arrive as soon as the payment is confirmed.</p>{/if}
	{#if data.payment === 'cancelled'}<p class="mt-4 rounded-lg bg-white/5 px-4 py-2 text-sm text-bone/70">The payment was cancelled.</p>{/if}
	{#if error}<p class="mt-4 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300" role="alert">{error}</p>{/if}

	<div class="mt-6 rounded-xl border border-white/10 p-5">
		<p class="text-sm text-bone/60">Your balance</p>
		<p class="mt-1 text-4xl font-semibold tabular-nums">{data.summary.balance.toLocaleString()}</p>
	</div>

	<h3 class="mt-8 text-base font-medium">Get credits</h3>
	{#if data.summary.providers.length === 0}
		<p class="mt-2 text-sm text-bone/60">Buying credits is not available yet.</p>
	{:else}
		<div class="mt-3 grid gap-3 sm:grid-cols-3">
			{#each data.summary.packs as pack (pack.id)}
				<div class="rounded-xl border border-white/10 p-4">
					<p class="text-2xl font-semibold tabular-nums">{pack.credits.toLocaleString()}</p>
					<p class="text-sm text-bone/60">credits</p>
					{#each data.summary.providers.filter((provider) => provider.id === 'stripe') as provider (provider.id)}
						<button class="mt-4 w-full rounded-lg bg-bone px-3 py-2 text-sm font-medium text-ink disabled:opacity-50" disabled={busy !== null} onclick={() => buy(provider.id, pack.id)}>
							{busy === pack.id ? 'Opening…' : money(pack.priceCents, pack.currency)}
						</button>
					{/each}
				</div>
			{/each}
		</div>
		{#if data.summary.providers.some((provider) => provider.id === 'meta')}
			<p class="mt-3 text-sm text-bone/60">On a Meta Quest you can also buy credits from inside the game.</p>
		{/if}
	{/if}

	<h3 class="mt-8 text-base font-medium">History</h3>
	{#if data.summary.transactions.length === 0}
		<p class="mt-2 text-sm text-bone/60">Nothing yet.</p>
	{:else}
		<ul class="mt-3 divide-y divide-white/6 rounded-xl border border-white/10">
			{#each data.summary.transactions as row (row.id)}
				<li class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
					<div>
						<p>{describe(row)}</p>
						<p class="text-xs text-bone/50">{when(row.createdAt)}</p>
					</div>
					<p class="tabular-nums {row.delta > 0 ? 'text-emerald-300' : 'text-bone'}">{row.delta > 0 ? '+' : ''}{row.delta.toLocaleString()}</p>
				</li>
			{/each}
		</ul>
	{/if}
</section>
