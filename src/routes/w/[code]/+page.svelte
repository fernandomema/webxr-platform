<script lang="ts">
	import { page } from '$app/state';
	import PlayShell from '$lib/xr/PlayShell.svelte';
</script>

<PlayShell roomCode={page.params.code} />
