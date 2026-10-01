<script lang="ts">
	import type { Snippet } from 'svelte';

	let { type = 'note', children }: { type?: 'note' | 'tip' | 'warning'; children: Snippet } = $props();
	const tone = { note: 'border-sky', tip: 'border-mint', warning: 'border-ember' } as const;
</script>

<aside class="my-4 rounded border-l-4 bg-haze px-4 py-3 {tone[type]}">
	<strong class="mr-1 text-xs tracking-wider uppercase">{type}</strong>
	{@render children()}
</aside>
