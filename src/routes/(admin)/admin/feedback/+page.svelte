<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	const tone: Record<string, string> = {
		pending: 'bg-white/10 text-bone/70',
		planned: 'bg-sky/15 text-sky',
		progress: 'bg-glow/15 text-glow',
		shipped: 'bg-mint/15 text-mint'
	};
	const href = (key: 'status' | 'category', value: string) => {
		const q = new URLSearchParams({ status: data.status, category: data.category, [key]: value });
		for (const [k, v] of [...q]) if (!v) q.delete(k);
		return `?${q}`;
	};
</script>

<div class="mb-6">
	<h1 class="text-2xl font-semibold">Feedback</h1>
	<p class="mt-1 text-sm text-bone/50">Ideas and bugs from players, most voted first. Change the status to move an item through the roadmap.</p>
</div>

<div class="mb-4 flex flex-wrap items-center gap-2 text-sm">
	<a href={href('status', '')} class="rounded-md px-3 py-1.5 {data.status === '' ? 'bg-white/10' : 'text-bone/60 hover:bg-white/5'}">All</a>
	{#each data.statuses as s (s)}
		<a href={href('status', s)} class="rounded-md px-3 py-1.5 {data.status === s ? 'bg-white/10' : 'text-bone/60 hover:bg-white/5'}">{label(s)} <span class="text-bone/40">{data.counts[s] ?? 0}</span></a>
	{/each}
	<span class="mx-2 h-4 w-px bg-white/10"></span>
	<a href={href('category', '')} class="rounded-md px-3 py-1.5 {data.category === '' ? 'bg-white/10' : 'text-bone/60 hover:bg-white/5'}">Any type</a>
	{#each data.categories as c (c)}
		<a href={href('category', c)} class="rounded-md px-3 py-1.5 {data.category === c ? 'bg-white/10' : 'text-bone/60 hover:bg-white/5'}">{label(c)}</a>
	{/each}
</div>

{#if form?.message}<p class="mb-3 text-sm text-red-300" role="alert">{form.message}</p>{/if}

<div class="overflow-x-auto rounded-xl border border-white/8 bg-haze">
	<table class="w-full text-left text-sm">
		<thead class="border-b border-white/8 text-xs tracking-wide text-bone/50 uppercase">
			<tr><th class="px-4 py-3">Votes</th><th class="px-4 py-3">Title</th><th class="px-4 py-3">Type</th><th class="px-4 py-3">Author</th><th class="px-4 py-3">Status</th><th class="px-4 py-3"></th></tr>
		</thead>
		<tbody class="divide-y divide-white/6">
			{#each data.entries as entry (entry.id)}
				<tr class="hover:bg-white/3">
					<td class="px-4 py-3 font-semibold tabular-nums">{entry.votes}</td>
					<td class="max-w-md px-4 py-3"><div class="font-medium">{entry.title}</div><div class="text-xs text-bone/40">{new Date(entry.createdAt).toLocaleDateString()}</div></td>
					<td class="px-4 py-3 text-bone/70">{label(entry.category)}</td>
					<td class="px-4 py-3 text-bone/70">{entry.author}</td>
					<td class="px-4 py-3">
						<form method="POST" action="?/setStatus" use:enhance={() => async ({ update }) => update({ reset: false })} class="flex items-center gap-2">
							<input type="hidden" name="id" value={entry.id} />
							<span class="rounded px-2 py-0.5 text-xs {tone[entry.status] ?? tone.pending}">{label(entry.status)}</span>
							<select name="status" value={entry.status} onchange={(e) => e.currentTarget.form?.requestSubmit()} class="rounded-md border border-white/10 bg-ink-2 px-2 py-1 text-xs" aria-label="Status">
								{#each data.statuses as s (s)}<option value={s}>{label(s)}</option>{/each}
							</select>
						</form>
					</td>
					<td class="px-4 py-3 text-right">
						<form method="POST" action="?/remove" use:enhance={({ cancel }) => { if (!confirm('Delete this feedback entry?')) cancel(); }}>
							<input type="hidden" name="id" value={entry.id} />
							<button class="text-xs text-bone/40 hover:text-red-300">Delete</button>
						</form>
					</td>
				</tr>
			{:else}
				<tr><td colspan="6" class="px-4 py-8 text-center text-bone/50">No feedback yet</td></tr>
			{/each}
		</tbody>
	</table>
</div>
