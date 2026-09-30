<script lang="ts">
	import Icon from './Icon.svelte';

	interface Props {
		value: string;
		suggestions: readonly string[];
		onchange: (value: string) => void;
		label: string;
		id?: string;
		disabled?: boolean;
	}

	let { value, suggestions, onchange, label, id, disabled = false }: Props = $props();

	let open = $state(false);
	let typed = $state(false);
	let active = $state(-1);
	let root = $state<HTMLDivElement>();
	const listId = $props.id();

	// Everything is offered until the text is edited; then only what contains it.
	const shown = $derived(typed && value ? suggestions.filter((option) => option.toLowerCase().includes(value.toLowerCase())) : suggestions);

	function pick(option: string) {
		open = false;
		typed = false;
		onchange(option);
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			open = true;
			active = shown.length ? (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length : -1;
		} else if (event.key === 'Enter' && open && shown[active]) {
			event.preventDefault();
			pick(shown[active]);
		} else if (event.key === 'Escape') open = false;
	}

	function onWindowPointer(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="combo" bind:this={root}>
	<input
		class="input"
		{id}
		{disabled}
		role="combobox"
		aria-expanded={open}
		aria-controls={listId}
		aria-autocomplete="list"
		aria-label={label}
		{value}
		onfocus={() => (open = true)}
		onkeydown={onKey}
		oninput={(event) => { typed = true; active = -1; open = true; onchange(event.currentTarget.value); }}
	/>
	<button type="button" class="more" tabindex="-1" aria-label="Show suggestions for {label}" {disabled} onclick={() => { typed = false; open = !open; }}><Icon name="chevron-down" size={12} /></button>
	{#if open && shown.length}
		<div class="pop" id={listId} role="listbox" aria-label="{label} suggestions">
			{#each shown as option, index (option)}
				<button type="button" role="option" class="opt" aria-selected={option === value} data-active={index === active} onclick={() => pick(option)}>{option}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.combo { position: relative; flex: 1; min-width: 0; }
	.combo .input { padding-right: calc(var(--control-h, 30px) - 2px); }
	.more { position: absolute; top: 0; right: 0; display: grid; place-items: center; width: var(--control-h, 30px); height: 100%; padding: 0; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
	.pop {
		position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; min-width: 100%; max-height: 220px; overflow-y: auto; padding: 4px;
		border: 1px solid var(--border); border-radius: 8px; background: var(--panel); box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
	}
	.opt { display: block; width: 100%; min-height: var(--control-h, 30px); padding: 4px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
	.opt:hover, .opt:global([data-xr-hover]), .opt[data-active='true'] { background: var(--panel-3); }
	.opt[aria-selected='true'] { color: var(--accent); }
</style>
