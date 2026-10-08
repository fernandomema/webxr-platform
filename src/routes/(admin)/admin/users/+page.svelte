<script lang="ts">
	let { data } = $props();
</script>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-2xl font-semibold">Users</h1>
		<p class="mt-1 text-sm text-bone/50">Showing up to 100, newest first</p>
	</div>
	<form method="GET" class="flex gap-2">
		<input name="q" value={data.q} placeholder="Search name, email or username" class="w-64 rounded-md border border-white/10 bg-ink-2 px-3 py-1.5 text-sm outline-none focus:border-white/30" />
		<button class="rounded-md bg-bone px-3 py-1.5 text-sm font-medium text-ink">Search</button>
	</form>
</div>
<div class="overflow-x-auto rounded-xl border border-white/8 bg-haze">
	<table class="w-full text-left text-sm">
		<thead class="border-b border-white/8 text-xs tracking-wide text-bone/50 uppercase">
			<tr><th class="px-4 py-3">User</th><th class="px-4 py-3">Email</th><th class="px-4 py-3">Role</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Joined</th></tr>
		</thead>
		<tbody class="divide-y divide-white/6">
			{#each data.users as user (user.id)}
				<tr class="hover:bg-white/3">
					<td class="px-4 py-3"><div class="font-medium">{user.name}</div>{#if user.username}<div class="text-xs text-bone/50">@{user.username}</div>{/if}</td>
					<td class="px-4 py-3 text-bone/70">{user.email}</td>
					<td class="px-4 py-3">{user.role ?? 'user'}</td>
					<td class="px-4 py-3">{#if user.banned}<span class="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-300">Banned</span>{:else}<span class="rounded bg-mint/15 px-2 py-0.5 text-xs text-mint">Active</span>{/if}</td>
					<td class="px-4 py-3 text-bone/60">{new Date(user.createdAt).toLocaleDateString()}</td>
				</tr>
			{:else}
				<tr><td colspan="5" class="px-4 py-8 text-center text-bone/50">No users found</td></tr>
			{/each}
		</tbody>
	</table>
</div>
