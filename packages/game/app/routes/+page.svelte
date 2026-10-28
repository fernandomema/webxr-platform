<script lang="ts">
	import PlayShell from '@kithin/engine/xr/PlayShell.svelte';
	import { startGame } from '@kithin/game/runtime';
	// The game's own configuration: src/game.ts of the app (the `$game` alias is set by `kithin-game`).
	import game from '$game';

	// Before the component that mounts the engine exists: the launch screen reads the game's name and features when it appears.
	const { loadWorld } = startGame(game);
</script>

<svelte:head><title>{game.name}</title></svelte:head>
<PlayShell {loadWorld} />
