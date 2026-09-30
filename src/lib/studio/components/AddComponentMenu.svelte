<script lang="ts">
	import { onMount } from 'svelte';
	import { placePopover, type Placement } from '../ui/popover';
	import { addableComponents, COMPONENT_GROUPS, type ComponentType } from '../schema/components';

	interface Props {
		advanced: boolean;
		onpick: (type: ComponentType) => void;
		onclose: () => void;
	}

	let { advanced, onpick, onclose }: Props = $props();

	let query = $state('');
	const groups = $derived(
		COMPONENT_GROUPS.map((group) => ({
			group,
			items: addableComponents(advanced).filter(
				(schema) => schema.group === group && `${schema.label} ${schema.description}`.toLowerCase().includes(query.toLowerCase())
			)
		})).filter((entry) => entry.items.length)
	);
	let root = $state<HTMLDivElement>();
	let place = $state<Placement | null>(null);

	// Opens towards the inside of the panel (it hangs from the right edge) and only as tall as the room there is, above or below.
	onMount(() => {
		if (root?.parentElement) place = placePopover(root.parentElement, 520);
	});

	function onWindowPointer(event: PointerEvent) {
		if (root && !root.contains(event.target as Node)) onclose();
	}
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={(event) => event.key === 'Escape' && onclose()} />

<div class="menu" class:up={place?.up} style:max-height={place ? `${place.maxHeight}px` : undefined} bind:this={root} role="menu" aria-label="Add component">
	<!-- svelte-ignore a11y_autofocus -->
	<input class="input" autofocus placeholder="Search components" aria-label="Search components" bind:value={query} />
	{#each groups as entry (entry.group)}
		<div class="menu-label">{entry.group}</div>
		{#each entry.items as schema (schema.type)}
			<button class="menu-item" role="menuitem" onclick={() => onpick(schema.type)}>
				<span class="glyph" aria-hidden="true">{schema.glyph}</span>
				<span class="text"><strong>{schema.label}</strong><span class="muted">{schema.description}</span></span>
			</button>
		{/each}
	{:else}
		<div class="empty">No components match.</div>
	{/each}
</div>

<style>
	.menu { right: 0; left: auto; top: calc(100% + 6px); width: min(340px, 90vw); display: grid; align-content: start; gap: 1px; }
	.menu.up { top: auto; bottom: calc(100% + 6px); }
	.input { margin-bottom: 4px; }
	.glyph { display: inline-grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); font-size: 12px; }
	.text { display: grid; min-width: 0; }
	.text .muted { font-size: 11px; }
</style>
