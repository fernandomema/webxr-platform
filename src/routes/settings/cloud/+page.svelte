<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { PLATFORM_NAME } from '$lib/platform';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let error = $state('');
	let busyId = $state<string | null>(null);

	const formatBytes = (bytes: number) => {
		if (bytes < 1024) return `${bytes} B`;
		const units = ['KB', 'MB', 'GB'];
		let value = bytes / 1024, unit = 0;
		while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
		return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
	};

	const percent = $derived(data.usage.quota > 0 ? Math.min(100, (data.usage.bytes / data.usage.quota) * 100) : 0);
	const stats = $derived([
		{ label: 'Worlds', value: data.counts.worlds },
		{ label: 'Published worlds', value: data.counts.published },
		{ label: 'Inventory items', value: data.counts.inventoryItems },
		{ label: 'Inventory folders', value: data.counts.inventoryFolders },
		{ label: 'Marketplace listings', value: data.counts.marketplaceItems },
		{ label: 'Purchases', value: data.counts.purchases },
		{ label: 'Active sessions', value: data.counts.sessions },
		{ label: '3D models', value: data.usage.count }
	]);

	async function release(assetId: string) {
		busyId = assetId; error = '';
		try {
			const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? 'Could not remove the model.');
			await invalidateAll();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not remove the model.';
		} finally { busyId = null; }
	}
</script>

<svelte:head><title>Cloud · {PLATFORM_NAME}</title></svelte:head>

<div class="space-y-10">
	<section>
		<h2 class="text-lg font-medium">Storage</h2>
		<div class="mt-4 rounded-xl border border-white/10 bg-ink-2 p-5">
			<div class="flex items-baseline justify-between gap-4 text-sm">
				<span><span class="text-2xl font-semibold">{formatBytes(data.usage.bytes)}</span> <span class="text-bone/60">{data.usage.quota > 0 ? `of ${formatBytes(data.usage.quota)}` : 'used (no limit)'}</span></span>
				{#if data.usage.quota > 0}<span class="text-bone/60">{percent.toFixed(0)}%</span>{/if}
			</div>
			{#if data.usage.quota > 0}
				<div class="mt-3 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin="0" aria-valuemax="100" aria-label="Storage used">
					<div class="h-full rounded-full {percent > 90 ? 'bg-red-400' : percent > 70 ? 'bg-amber-300' : 'bg-emerald-400'}" style="width: {percent}%"></div>
				</div>
			{/if}
			<dl class="mt-4 grid grid-cols-2 gap-4 text-sm">
				<div><dt class="text-bone/60">3D models</dt><dd>{formatBytes(data.usage.assetBytes)}</dd></div>
				<div><dt class="text-bone/60">Inventory data</dt><dd>{formatBytes(data.usage.inventoryBytes)}</dd></div>
			</dl>
		</div>
	</section>

	<section>
		<h2 class="text-lg font-medium">Your content</h2>
		<dl class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
			{#each stats as stat (stat.label)}
				<div class="rounded-xl border border-white/10 bg-ink-2 px-4 py-3"><dd class="text-2xl font-semibold">{stat.value}</dd><dt class="text-xs text-bone/60">{stat.label}</dt></div>
			{/each}
		</dl>
	</section>

	<section>
		<h2 class="text-lg font-medium">Largest models</h2>
		<p class="mt-1 text-sm text-bone/60">Models still used by an object or world can't be removed.</p>
		<ul class="mt-4 divide-y divide-white/6 rounded-xl border border-white/10 bg-ink-2 text-sm">
			{#each data.largest as asset (asset.assetId)}
				<li class="flex items-center justify-between gap-4 px-4 py-3">
					<div class="min-w-0"><p class="truncate">{asset.name}</p><p class="text-xs text-bone/40">{formatBytes(asset.byteSize)} · {asset.inUse ? 'In use' : 'Unused'}</p></div>
					<button class="rounded-full border border-white/15 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-40" disabled={asset.inUse || busyId === asset.assetId} onclick={() => release(asset.assetId)}>{busyId === asset.assetId ? 'Removing…' : 'Remove'}</button>
				</li>
			{:else}
				<li class="px-4 py-3 text-bone/60">No models uploaded yet.</li>
			{/each}
		</ul>
		{#if error}<p class="mt-3 text-sm text-red-400">{error}</p>{/if}
	</section>
</div>
