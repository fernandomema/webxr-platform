<script lang="ts">
	import PlayShell from '@kithin/engine/xr/PlayShell.svelte';
	import { setUpEngine } from '$lib/engine';

	// The engine reads its configuration when it mounts, so the game says what it needs first.
	const loadWorld = async () => (await setUpEngine()).world('hello');
</script>

<svelte:head><title>Standalone game</title></svelte:head>
<PlayShell {loadWorld} />
