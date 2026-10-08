<script lang="ts">
	let { data } = $props();
	const cards = $derived([
		{ label: 'Users', value: data.stats.users, hint: `+${data.stats.newUsers} in the last 7 days` },
		{ label: 'Worlds', value: data.stats.worlds, hint: `${data.stats.publicWorlds} public` },
		{ label: 'Published worlds', value: data.stats.published, hint: 'Live on the platform' },
		{ label: 'Assets', value: data.stats.assets, hint: 'Stored files' }
	]);
</script>

<div class="mb-6">
	<h1 class="text-2xl font-semibold">Dashboard</h1>
	<p class="mt-1 text-sm text-bone/50">Platform overview</p>
</div>
<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
	{#each cards as card (card.label)}
		<div class="rounded-xl border border-white/8 bg-haze p-5">
			<div class="text-xs tracking-wide text-bone/50 uppercase">{card.label}</div>
			<div class="mt-2 text-3xl font-semibold">{card.value.toLocaleString()}</div>
			<div class="mt-1 text-xs text-bone/40">{card.hint}</div>
		</div>
	{/each}
</div>
