<script lang="ts">
	let { data } = $props();
</script>

<div class="mb-6">
	<h1 class="text-2xl font-semibold">Worlds</h1>
	<p class="mt-1 text-sm text-bone/50">Showing up to 100, newest first</p>
</div>
<div class="overflow-x-auto rounded-xl border border-white/8 bg-haze">
	<table class="w-full text-left text-sm">
		<thead class="border-b border-white/8 text-xs tracking-wide text-bone/50 uppercase">
			<tr><th class="px-4 py-3">World</th><th class="px-4 py-3">Host</th><th class="px-4 py-3">Visibility</th><th class="px-4 py-3">Created</th></tr>
		</thead>
		<tbody class="divide-y divide-white/6">
			{#each data.worlds as world (world.id)}
				<tr class="hover:bg-white/3">
					<td class="px-4 py-3 font-medium">{world.name}</td>
					<td class="px-4 py-3 text-bone/70">{world.hostUser.name} <span class="text-bone/40">· {world.hostUser.email}</span></td>
					<td class="px-4 py-3">{world.visibility}</td>
					<td class="px-4 py-3 text-bone/60">{new Date(world.createdAt).toLocaleDateString()}</td>
				</tr>
			{:else}
				<tr><td colspan="4" class="px-4 py-8 text-center text-bone/50">No worlds yet</td></tr>
			{/each}
		</tbody>
	</table>
</div>
