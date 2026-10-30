<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	const href = (level: string, resolved: boolean) => {
		const q = new URLSearchParams({ ...(level ? { level } : {}), ...(resolved ? { resolved: '1' } : {}) });
		return q.size ? `?${q}` : '?';
	};
	let openId = $state('');
</script>

<div class="mb-6">
	<h1 class="text-2xl font-semibold">Errors</h1>
	<p class="mt-1 text-sm text-bone/50">Errors players' browsers reported, grouped by what they say. {data.open} open. Players can turn reporting off in their settings, so counts are a floor.</p>
</div>

<div class="mb-4 flex flex-wrap items-center gap-2 text-sm">
	<a href={href('', data.showResolved)} class="rounded-md px-3 py-1.5 {data.level === '' ? 'bg-white/10' : 'text-bone/60 hover:bg-white/5'}">All</a>
	<a href={href('error', data.showResolved)} class="rounded-md px-3 py-1.5 {data.level === 'error' ? 'bg-white/10' : 'text-bone/60 hover:bg-white/5'}">Errors</a>
	<a href={href('warn', data.showResolved)} class="rounded-md px-3 py-1.5 {data.level === 'warn' ? 'bg-white/10' : 'text-bone/60 hover:bg-white/5'}">Connection warnings</a>
	<span class="mx-2 h-4 w-px bg-white/10"></span>
	<a href={href(data.level, !data.showResolved)} class="rounded-md px-3 py-1.5 text-bone/60 hover:bg-white/5">{data.showResolved ? 'Hide resolved' : 'Show resolved'}</a>
	{#if data.showResolved}
		<form method="POST" action="?/clearResolved" use:enhance={({ cancel }) => { if (!confirm('Delete every resolved report?')) cancel(); }} class="ml-auto">
			<button class="rounded-md border border-white/10 px-3 py-1.5 text-bone/70 hover:bg-white/5">Delete resolved</button>
		</form>
	{/if}
</div>

{#if form?.message}<p class="mb-3 text-sm text-red-300" role="alert">{form.message}</p>{/if}

<div class="overflow-x-auto rounded-xl border border-white/8 bg-haze">
	<table class="w-full text-left text-sm">
		<thead class="border-b border-white/8 text-xs tracking-wide text-bone/50 uppercase">
			<tr><th class="px-4 py-3">Times</th><th class="px-4 py-3">Message</th><th class="px-4 py-3">Page</th><th class="px-4 py-3">Devices</th><th class="px-4 py-3">Last seen</th><th class="px-4 py-3"></th></tr>
		</thead>
		<tbody class="divide-y divide-white/6">
			{#each data.entries as entry (entry.id)}
				<tr class="align-top hover:bg-white/3 {entry.resolved ? 'opacity-50' : ''}">
					<td class="px-4 py-3 font-semibold tabular-nums">{entry.count}</td>
					<td class="max-w-xl px-4 py-3">
						<button type="button" class="text-left" onclick={() => (openId = openId === entry.id ? '' : entry.id)}>
							<span class="mr-2 rounded px-1.5 py-0.5 text-xs {entry.level === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-glow/15 text-glow'}">{entry.level}</span>
							<span class="font-mono text-xs break-words">{entry.message.split('\n')[0].slice(0, 220)}</span>
						</button>
						{#if openId === entry.id}
							<pre class="mt-2 max-h-72 overflow-auto rounded-md bg-ink-2 p-3 text-xs break-words whitespace-pre-wrap">{entry.message}{entry.stack ? `\n\n${entry.stack}` : ''}</pre>
							<p class="mt-1 text-xs text-bone/40">{entry.userAgent ?? 'unknown browser'} · first seen {new Date(entry.firstSeenAt).toLocaleString()}</p>
						{/if}
					</td>
					<td class="px-4 py-3 font-mono text-xs text-bone/70">{entry.path}</td>
					<td class="px-4 py-3 text-xs text-bone/70">
						{#each Object.entries((entry.devices ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 4) as [name, times] (name)}
							<div>{name} <span class="text-bone/40">×{times}</span></div>
						{:else}<span class="text-bone/40">{entry.device ?? '—'}</span>{/each}
					</td>
					<td class="px-4 py-3 text-bone/70">{new Date(entry.lastSeenAt).toLocaleString()}</td>
					<td class="px-4 py-3">
						<div class="flex justify-end gap-2">
							<form method="POST" action="?/resolve" use:enhance>
								<input type="hidden" name="id" value={entry.id} />
								<input type="hidden" name="resolved" value={entry.resolved ? '0' : '1'} />
								<button class="rounded-md border border-white/10 px-2.5 py-1 text-xs hover:bg-white/5">{entry.resolved ? 'Reopen' : 'Resolve'}</button>
							</form>
							<form method="POST" action="?/remove" use:enhance>
								<input type="hidden" name="id" value={entry.id} />
								<button class="rounded-md border border-red-500/30 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10">Delete</button>
							</form>
						</div>
					</td>
				</tr>
			{:else}
				<tr><td colspan="6" class="px-4 py-8 text-center text-bone/40">No error reports.</td></tr>
			{/each}
		</tbody>
	</table>
</div>
