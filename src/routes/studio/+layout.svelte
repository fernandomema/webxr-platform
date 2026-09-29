<script lang="ts">
	import type { Snippet } from 'svelte';
	import DialogHost from '$lib/studio/ui/DialogHost.svelte';
	import ToastHost from '$lib/studio/ui/ToastHost.svelte';
	import { studioSession } from '$lib/studio/state/session.svelte';
	import { onMount } from 'svelte';
	import './studio.css';

	let { children }: { children: Snippet } = $props();

	onMount(() => {
		void studioSession.init();
	});
</script>

<div class="studio">
	{@render children()}
	<DialogHost />
	<ToastHost />
</div>
