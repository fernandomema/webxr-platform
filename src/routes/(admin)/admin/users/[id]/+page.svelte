<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { data, form } = $props();
	const user = $derived(data.user);
	const credits = $derived(data.credits);
	const ai = $derived(data.ai);
	const content = $derived(data.content);
	const date = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');
	const day = (value: string) => new Date(value).toLocaleDateString();
	const localInput = (iso: string | null) => {
		if (!iso) return '';
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	};
	const runTone: Record<string, string> = { completed: 'bg-mint/15 text-mint', running: 'bg-sky/15 text-sky', budget: 'bg-glow/15 text-glow', loop: 'bg-glow/15 text-glow', stopped: 'bg-white/10 text-bone/70', error: 'bg-red-500/15 text-red-300' };
	const inputCls = 'rounded-md border border-white/10 bg-ink-2 px-3 py-1.5 text-sm outline-none focus:border-white/30';
</script>

<svelte:head><title>{user.name} · Admin</title></svelte:head>

<div class="mb-6">
	<a href={resolve('/admin/users')} class="text-sm text-bone/50 hover:text-bone">← Users</a>
	<div class="mt-2 flex flex-wrap items-center gap-3">
		<h1 class="text-2xl font-semibold">{user.name}</h1>
		{#if user.username}<span class="text-bone/50">@{user.username}</span>{/if}
		{#if user.role}<span class="rounded bg-ember/15 px-2 py-0.5 text-xs text-ember">{user.role}</span>{/if}
		{#if user.banned}<span class="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-300">Banned{user.banExpires ? ` until ${date(user.banExpires)}` : ''}</span>{:else}<span class="rounded bg-mint/15 px-2 py-0.5 text-xs text-mint">Active</span>{/if}
	</div>
	<p class="mt-1 text-sm text-bone/50">{user.email} · joined {day(user.createdAt)}</p>
</div>

{#if form?.message}<p class="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">{form.message}</p>{/if}
{#if form?.saved}<p class="mb-4 rounded-md border border-mint/30 bg-mint/10 px-3 py-2 text-sm text-mint">Saved.</p>{/if}

<div class="grid gap-4 lg:grid-cols-2">
	<!-- Profile, access & sanctions -->
	<section class="rounded-xl border border-white/8 bg-haze p-5">
		<h2 class="font-semibold">Profile & access</h2>
		<p class="mt-1 text-xs text-bone/40">Role changes and bans apply on the person's next request. An admin cannot demote or ban themselves.</p>
		<form method="POST" action="?/updateUser" use:enhance class="mt-4 grid gap-3">
			<label class="grid gap-1 text-sm"><span class="text-xs text-bone/50">Name</span><input name="name" class={inputCls} value={user.name} required /></label>
			<label class="grid gap-1 text-sm"><span class="text-xs text-bone/50">Email</span><input name="email" type="email" class={inputCls} value={user.email} required /></label>
			<label class="grid gap-1 text-sm"><span class="text-xs text-bone/50">Username</span><input name="username" class={inputCls} value={user.username ?? ''} /></label>
			<label class="grid gap-1 text-sm"><span class="text-xs text-bone/50">Role (comma-separated)</span><input name="role" class={inputCls} value={user.role ?? ''} placeholder="user" disabled={data.self} /></label>
			<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="emailVerified" class="accent-mint" checked={user.emailVerified} /> Email verified</label>
			<div class="border-t border-white/8 pt-3">
				<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="banned" class="accent-red-400" checked={Boolean(user.banned)} disabled={data.self} /> Banned</label>
				<label class="mt-3 grid gap-1 text-sm"><span class="text-xs text-bone/50">Ban reason</span><input name="banReason" class={inputCls} value={user.banReason ?? ''} disabled={data.self} /></label>
				<label class="mt-3 grid gap-1 text-sm"><span class="text-xs text-bone/50">Ban expires (empty = permanent)</span><input name="banExpires" type="datetime-local" class={inputCls} value={localInput(user.banExpires)} disabled={data.self} /></label>
			</div>
			<div><button class="rounded-md bg-bone px-3 py-1.5 text-sm font-medium text-ink">Save user</button></div>
		</form>
	</section>

	<!-- Credits -->
	<section class="rounded-xl border border-white/8 bg-haze p-5">
		<h2 class="font-semibold">Credits</h2>
		<div class="mt-2 text-3xl font-semibold tabular-nums">{credits.balance.toLocaleString()}</div>
		<form method="POST" action="?/adjustCredits" use:enhance class="mt-4 flex flex-wrap items-end gap-2">
			<label class="grid gap-1 text-sm"><span class="text-xs text-bone/50">Amount (+ to grant, − to remove)</span><input name="amount" type="number" step="1" class={`w-36 ${inputCls}`} required /></label>
			<label class="grid flex-1 gap-1 text-sm"><span class="text-xs text-bone/50">Note (recorded in the ledger)</span><input name="note" class={inputCls} required /></label>
			<button class="rounded-md bg-bone px-3 py-1.5 text-sm font-medium text-ink">Apply</button>
		</form>
		<div class="mt-4 overflow-x-auto rounded-lg border border-white/8">
			<table class="w-full text-left text-xs">
				<thead class="border-b border-white/8 text-bone/50 uppercase"><tr><th class="px-3 py-2">Date</th><th class="px-3 py-2">Kind</th><th class="px-3 py-2 text-right">Δ</th><th class="px-3 py-2 text-right">Balance</th><th class="px-3 py-2">Note</th></tr></thead>
				<tbody class="divide-y divide-white/6">
					{#each credits.transactions as t (t.id)}
						<tr>
							<td class="px-3 py-2 text-bone/60 whitespace-nowrap">{date(t.createdAt)}</td>
							<td class="px-3 py-2">{t.kind}</td>
							<td class="px-3 py-2 text-right font-medium tabular-nums {t.delta > 0 ? 'text-mint' : 'text-red-300'}">{t.delta > 0 ? '+' : ''}{t.delta.toLocaleString()}</td>
							<td class="px-3 py-2 text-right tabular-nums">{t.balanceAfter.toLocaleString()}</td>
							<td class="max-w-[220px] truncate px-3 py-2 text-bone/50">{t.providerRef ?? t.provider ?? ''}</td>
						</tr>
					{:else}<tr><td colspan="5" class="px-3 py-6 text-center text-bone/50">No transactions yet</td></tr>{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- AI activity -->
	<section class="rounded-xl border border-white/8 bg-haze p-5">
		<h2 class="font-semibold">AI activity</h2>
		<div class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
			<div><div class="text-xs text-bone/50 uppercase">Runs</div><div class="mt-1 text-xl font-semibold tabular-nums">{ai.runs.toLocaleString()}</div></div>
			<div><div class="text-xs text-bone/50 uppercase">Tokens in</div><div class="mt-1 text-xl font-semibold tabular-nums">{ai.inputTokens.toLocaleString()}</div></div>
			<div><div class="text-xs text-bone/50 uppercase">Tokens out</div><div class="mt-1 text-xl font-semibold tabular-nums">{ai.outputTokens.toLocaleString()}</div></div>
			<div><div class="text-xs text-bone/50 uppercase">Credits spent</div><div class="mt-1 text-xl font-semibold tabular-nums">{ai.credits.toLocaleString()}</div></div>
		</div>
		{#if ai.models.length}
			<div class="mt-3 flex flex-wrap gap-2 text-xs">
				{#each ai.models as m (m.model)}<span class="rounded-full border border-white/10 px-2.5 py-1 text-bone/70">{m.model} · {m.runs} runs{m.credits ? ` · ${m.credits.toLocaleString()} cr` : ''}</span>{/each}
			</div>
		{/if}
		<div class="mt-4 overflow-x-auto rounded-lg border border-white/8">
			<table class="w-full text-left text-xs">
				<thead class="border-b border-white/8 text-bone/50 uppercase"><tr><th class="px-3 py-2">Date</th><th class="px-3 py-2">Model</th><th class="px-3 py-2">Status</th><th class="px-3 py-2 text-right">Steps</th><th class="px-3 py-2 text-right">Credits</th><th class="px-3 py-2 text-right">Real cost</th></tr></thead>
				<tbody class="divide-y divide-white/6">
					{#each ai.recent as run (run.id)}
						<tr>
							<td class="px-3 py-2 text-bone/60 whitespace-nowrap">{date(run.createdAt)}</td>
							<td class="px-3 py-2">{run.model}</td>
							<td class="px-3 py-2"><span class="rounded px-2 py-0.5 {runTone[run.status] ?? runTone.error}">{run.status}{run.refunded ? ' · refunded' : ''}{run.free ? ' · free' : ''}</span></td>
							<td class="px-3 py-2 text-right tabular-nums">{run.steps ?? run.calls}</td>
							<td class="px-3 py-2 text-right tabular-nums">{run.credits.toLocaleString()}</td>
							<td class="px-3 py-2 text-right tabular-nums text-bone/70">{run.costCredits === null ? '—' : `${run.costCredits.toFixed(2)} cr`}</td>
						</tr>
					{:else}<tr><td colspan="6" class="px-3 py-6 text-center text-bone/50">No AI runs yet</td></tr>{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Content -->
	<section class="rounded-xl border border-white/8 bg-haze p-5">
		<h2 class="font-semibold">Content</h2>
		<div class="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
			<div><div class="text-xs text-bone/50 uppercase">Worlds</div><div class="mt-1 text-xl font-semibold tabular-nums">{content.worldCount.toLocaleString()}</div></div>
			<div><div class="text-xs text-bone/50 uppercase">Published</div><div class="mt-1 text-xl font-semibold tabular-nums">{content.publicationCount.toLocaleString()}</div></div>
			<div><div class="text-xs text-bone/50 uppercase">Inventory items</div><div class="mt-1 text-xl font-semibold tabular-nums">{content.inventoryCount.toLocaleString()}</div></div>
			<div><div class="text-xs text-bone/50 uppercase">Assets</div><div class="mt-1 text-xl font-semibold tabular-nums">{content.assetCount.toLocaleString()}</div></div>
		</div>
		{#if content.publications.length}
			<h3 class="mt-4 text-xs tracking-wide text-bone/50 uppercase">Published worlds</h3>
			<ul class="mt-2 divide-y divide-white/6 text-sm">
				{#each content.publications as pub (pub.id)}
					<li class="flex items-center gap-3 py-2">
						<a class="font-medium hover:underline" href={resolve(`/play/${pub.id}`)}>{pub.name}</a>
						<span class="text-xs text-bone/40">{pub.kind}{pub.staffPick ? ' · staff pick' : ''}</span>
						<span class="ml-auto text-xs text-bone/40">{day(pub.updatedAt)}</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if content.worlds.length}
			<h3 class="mt-4 text-xs tracking-wide text-bone/50 uppercase">Worlds</h3>
			<ul class="mt-2 divide-y divide-white/6 text-sm">
				{#each content.worlds as world (world.id)}
					<li class="flex items-center gap-3 py-2">
						<span class="font-medium">{world.name}</span>
						<span class="rounded px-2 py-0.5 text-xs {world.visibility === 'public' ? 'bg-mint/15 text-mint' : 'bg-white/10 text-bone/60'}">{world.visibility}</span>
						<span class="ml-auto text-xs text-bone/40">{day(world.updatedAt)}</span>
					</li>
				{/each}
				{#if content.worldCount > content.worlds.length}<li class="py-2 text-xs text-bone/40">…and {content.worldCount - content.worlds.length} more</li>{/if}
			</ul>
		{/if}
	</section>
</div>
