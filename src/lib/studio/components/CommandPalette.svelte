<script lang="ts" module>
	export interface Command {
		id: string;
		label: string;
		shortcut?: string;
		enabled?: boolean;
		run: () => void;
	}
</script>

<script lang="ts">
	interface Props {
		commands: Command[];
		onclose: () => void;
	}

	let { commands, onclose }: Props = $props();

	let query = $state('');
	let active = $state(0);

	const matches = $derived(commands.filter((command) => command.enabled !== false && command.label.toLowerCase().includes(query.toLowerCase())));

	function run(command: Command | undefined) {
		if (!command) return;
		onclose();
		command.run();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
		else if (event.key === 'ArrowDown') active = Math.min(active + 1, matches.length - 1);
		else if (event.key === 'ArrowUp') active = Math.max(active - 1, 0);
		else if (event.key === 'Enter') run(matches[active]);
		else return;
		event.preventDefault();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="studio-backdrop" onclick={(event) => event.target === event.currentTarget && onclose()}>
	<div class="studio-modal palette" role="dialog" aria-modal="true" aria-label="Command palette">
		<!-- svelte-ignore a11y_autofocus -->
		<input class="input" autofocus placeholder="Type a command…" aria-label="Command" bind:value={query} oninput={() => (active = 0)} onkeydown={onKeydown} />
		<ul role="listbox">
			{#each matches as command, index (command.id)}
				<li role="option" aria-selected={index === active}>
					<button class="menu-item" class:active={index === active} onmousemove={() => (active = index)} onclick={() => run(command)}>
						<span class="label">{command.label}</span>
						{#if command.shortcut}<span class="kbd">{command.shortcut}</span>{/if}
					</button>
				</li>
			{:else}
				<li class="empty">No matching command.</li>
			{/each}
		</ul>
	</div>
</div>

<style>
	.palette { padding: 8px; }
	ul { margin: 8px 0 0; padding: 0; list-style: none; max-height: 50vh; overflow: auto; }
	.label { flex: 1; }
	.menu-item.active { background: var(--panel-3); }
</style>
