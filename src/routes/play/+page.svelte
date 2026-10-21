<script lang="ts">
	import PlayShell from '@kithin/engine/xr/PlayShell.svelte';
	import { PLATFORM_NAME } from '$lib/platform';
	import { loadStartupWorld } from '$lib/play/startupWorld';
	import { page } from '$app/state';
</script>

<svelte:head><title>Play · {PLATFORM_NAME}</title></svelte:head>
<PlayShell roomCode={page.url.searchParams.get('room') ?? undefined} loadWorld={() => loadStartupWorld(undefined, page.url.searchParams)} />
