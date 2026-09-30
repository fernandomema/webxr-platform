<script lang="ts">
	import type { Snippet } from 'svelte';
	import ToastHost from '$lib/studio/ui/ToastHost.svelte';
	import '../../studio/studio.css';

	let { children }: { children: Snippet } = $props();
</script>

<div class="studio xr-panel">
	{@render children()}
	<ToastHost />
</div>
