<script lang="ts">
	import { PLATFORM_NAME } from '$lib/platform';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Settings · {PLATFORM_NAME}</title></svelte:head>

<section class="space-y-6">
	<div>
		<h2 class="text-lg font-medium">Account</h2>
		<dl class="mt-4 divide-y divide-white/6 rounded-xl border border-white/10 bg-ink-2 text-sm">
			<div class="flex justify-between gap-4 px-4 py-3"><dt class="text-bone/60">Name</dt><dd>{data.user.name}</dd></div>
			{#if data.user.username}<div class="flex justify-between gap-4 px-4 py-3"><dt class="text-bone/60">Username</dt><dd>{data.user.username}</dd></div>{/if}
			<div class="flex justify-between gap-4 px-4 py-3"><dt class="text-bone/60">Email</dt><dd>{data.user.email}</dd></div>
		</dl>
	</div>
	<a class="inline-block rounded-full border border-white/15 px-4 py-2 text-sm hover:bg-white/5" href="/logout">Sign out</a>
</section>
