<script lang="ts">
	import PlayShell from '@kithin/engine/xr/PlayShell.svelte';
	import { configureEngine, loadContent } from '$lib/engine';

	configureEngine();
	const loadWorld = async () => (await loadContent()).world('hello');
</script>

<svelte:head><title>Standalone game</title></svelte:head>
<PlayShell {loadWorld} />
