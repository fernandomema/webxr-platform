<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	const current = $derived(data.boards.find((b) => b.id === data.selected) ?? null);
</script>

<div class="mb-6">
	<h1 class="text-2xl font-semibold">Scoreboards</h1>
	<p class="mt-1 text-sm text-bone/50">Leaderboards created by published worlds. Inspect scores and remove cheated or test entries.</p>
</div>

{#if form?.message}<p class="mb-3 text-sm text-red-300" role="alert">{form.message}</p>{/if}

<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
	<div class="overflow-x-auto rounded-xl border border-white/8 bg-haze">
		<table class="w-full text-left text-sm">
			<thead class="border-b border-white/8 text-xs tracking-wide text-bone/50 uppercase">
				<tr><th class="px-4 py-3">Board</th><th class="px-4 py-3">World</th><th class="px-4 py-3">Order</th><th class="px-4 py-3 text-right">Entries</th></tr>
			</thead>
			<tbody class="divide-y divide-white/6">
				{#each data.boards as board (board.id)}
					<tr class="hover:bg-white/3 {board.id === data.selected ? 'bg-white/6' : ''}">
						<td class="px-4 py-3 font-medium"><a href="?board={board.id}">{board.name}{board.seasonId ? ` · ${board.seasonId}` : ''}</a></td>
						<td class="px-4 py-3 text-bone/70">{board.world}</td>
						<td class="px-4 py-3 text-bone/70">{board.order === 'high' ? 'Highest' : 'Lowest'}</td>
						<td class="px-4 py-3 text-right tabular-nums">{board.entryCount}</td>
					</tr>
				{:else}
					<tr><td colspan="4" class="px-4 py-8 text-center text-bone/50">No scoreboards yet</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="rounded-xl border border-white/8 bg-haze">
		{#if current}
			<div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
				<div>
					<div class="font-semibold">{current.name}</div>
					<div class="text-xs text-bone/50">{current.world} · created {new Date(current.createdAt).toLocaleDateString()}</div>
				</div>
				<div class="flex gap-3 text-xs">
					<form method="POST" action="?/clearBoard" use:enhance={({ cancel }) => { if (!confirm('Remove every entry from this board?')) cancel(); }}>
						<input type="hidden" name="board" value={current.id} />
						<button class="text-bone/50 hover:text-red-300">Clear entries</button>
					</form>
					<form method="POST" action="?/removeBoard" use:enhance={({ cancel }) => { if (!confirm('Delete this board and all its entries?')) cancel(); }}>
						<input type="hidden" name="board" value={current.id} />
						<button class="text-bone/50 hover:text-red-300">Delete board</button>
					</form>
				</div>
			</div>
			<table class="w-full text-left text-sm">
				<thead class="border-b border-white/8 text-xs tracking-wide text-bone/50 uppercase">
					<tr><th class="px-4 py-3">#</th><th class="px-4 py-3">Player</th><th class="px-4 py-3 text-right">Score</th><th class="px-4 py-3">Updated</th><th class="px-4 py-3"></th></tr>
				</thead>
				<tbody class="divide-y divide-white/6">
					{#each data.entries as entry (entry.accountId)}
						<tr class="hover:bg-white/3">
							<td class="px-4 py-3 tabular-nums text-bone/60">{entry.rank}</td>
							<td class="px-4 py-3"><div class="font-medium">{entry.displayName}</div><div class="text-xs text-bone/40">{entry.email}</div></td>
							<td class="px-4 py-3 text-right font-semibold tabular-nums">{entry.score}</td>
							<td class="px-4 py-3 text-bone/60">{new Date(entry.updatedAt).toLocaleString()}</td>
							<td class="px-4 py-3 text-right">
								<form method="POST" action="?/removeEntry" use:enhance={({ cancel }) => { if (!confirm('Remove this entry?')) cancel(); }}>
									<input type="hidden" name="board" value={current.id} />
									<input type="hidden" name="account" value={entry.accountId} />
									<button class="text-xs text-bone/40 hover:text-red-300">Remove</button>
								</form>
							</td>
						</tr>
					{:else}
						<tr><td colspan="5" class="px-4 py-8 text-center text-bone/50">No entries</td></tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="px-4 py-8 text-center text-sm text-bone/50">Select a board to inspect its entries</p>
		{/if}
	</div>
</div>
