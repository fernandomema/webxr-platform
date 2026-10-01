<script lang="ts">
	import PlayShell from '$lib/xr/PlayShell.svelte';
	import { PLATFORM_NAME } from '$lib/platform';
	import { page } from '$app/state';
</script>

<svelte:head><title>Play · {PLATFORM_NAME}</title></svelte:head>
<PlayShell roomCode={page.url.searchParams.get('room') ?? undefined} />
