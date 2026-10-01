<script lang="ts">
	import PlayShell from '$lib/xr/PlayShell.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.app.name}</title>
	{#if data.app.description}<meta name="description" content={data.app.description} />{/if}
</svelte:head>
<PlayShell worldId={data.worldId} />
