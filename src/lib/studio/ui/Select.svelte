<script lang="ts" module>
	export interface SelectOption {
		value: string;
		label: string;
		disabled?: boolean;
	}
	export interface SelectGroup {
		label: string;
		options: SelectOption[];
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import Icon from './Icon.svelte';
	import { placePopover, type Placement } from './popover';

	interface Props {
		value: string;
		/** Flat options, or groups (the `optgroup` of a native select). */
		options: (SelectOption | SelectGroup)[];
		onchange: (value: string) => void;
		label: string;
		id?: string;
		placeholder?: string;
		/** Adds a filter box to the list; worth it for long lists such as a model's bones. */
		searchable?: boolean;
		disabled?: boolean;
		invalid?: boolean;
	}

	let { value, options, onchange, label, id, placeholder = 'Choose…', searchable = false, disabled = false, invalid = false }: Props = $props();

	let open = $state(false);
	let query = $state('');
	let active = $state(-1);
	let place = $state<Placement>({ up: false, maxHeight: 280 });
	let root = $state<HTMLDivElement>();
	let trigger = $state<HTMLButtonElement>();
	let list = $state<HTMLDivElement>();

	const isGroup = (entry: SelectOption | SelectGroup): entry is SelectGroup => 'options' in entry;
	const flat = $derived(options.flatMap((entry) => (isGroup(entry) ? entry.options : [entry])));
	const shown = $derived(flat.find((option) => option.value === value)?.label);
	const needle = $derived(query.trim().toLowerCase());
	const visible = $derived(
		options
			.map((entry) => (isGroup(entry) ? { label: entry.label, options: entry.options.filter(matches) } : { label: '', options: [entry].filter(matches) }))
			.filter((group) => group.options.length)
	);
	const choices = $derived(visible.flatMap((group) => group.options).filter((option) => !option.disabled));
	const listId = $props.id();

	function matches(option: SelectOption): boolean {
		return !needle || option.label.toLowerCase().includes(needle);
	}

	async function show() {
		if (disabled || open) return;
		query = '';
		place = placePopover(trigger!, 280);
		open = true;
		active = choices.findIndex((option) => option.value === value);
		await tick();
		list?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
		if (searchable) list?.parentElement?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
	}

	function hide(refocus = false) {
		open = false;
		if (refocus) trigger?.focus({ preventScroll: true });
	}

	function pick(option: SelectOption) {
		if (option.disabled) return;
		hide(true);
		if (option.value !== value) onchange(option.value);
	}

	function move(step: number) {
		if (!choices.length) return;
		active = (active + step + choices.length) % choices.length;
		void tick().then(() => list?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' }));
	}

	function onKey(event: KeyboardEvent) {
		if (!open) {
			if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
				event.preventDefault();
				void show();
			}
			return;
		}
		if (event.key === 'Escape') hide(true);
		else if (event.key === 'ArrowDown') move(1);
		else if (event.key === 'ArrowUp') move(-1);
		else if (event.key === 'Enter' || (event.key === ' ' && !searchable)) {
			if (choices[active]) pick(choices[active]);
		} else if (event.key === 'Tab') hide();
		else return;
		event.preventDefault();
	}

	function onWindowPointer(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) hide();
	}
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="select-root" bind:this={root} onkeydown={onKey} role="presentation">
	<button
		bind:this={trigger}
		{id}
		type="button"
		class="select-trigger"
		class:invalid
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={open ? listId : undefined}
		aria-label={label}
		{disabled}
		onclick={() => (open ? hide() : void show())}
	>
		<span class="shown" class:placeholder={shown === undefined}>{shown ?? placeholder}</span>
		<Icon name="chevron-down" size={12} />
	</button>
	{#if open}
		<div class="pop" class:up={place.up} style:max-height="{place.maxHeight}px">
			{#if searchable}
				<input class="input search" placeholder="Search" aria-label="Search {label}" bind:value={query} oninput={() => (active = 0)} />
			{/if}
			<div class="list" id={listId} role="listbox" aria-label={label} bind:this={list}>
				{#each visible as group}
					{#if group.label}<div class="group">{group.label}</div>{/if}
					{#each group.options as option (option.value)}
						{@const index = choices.indexOf(option)}
						<button
							type="button"
							role="option"
							class="opt"
							aria-selected={option.value === value}
							aria-disabled={option.disabled || undefined}
							data-active={index === active}
							onclick={() => pick(option)}
						>
							<span class="check">{option.value === value ? '✓' : ''}</span>
							<span class="text">{option.label}</span>
						</button>
					{/each}
				{:else}
					<div class="none">Nothing matches.</div>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.select-root { position: relative; min-width: 0; flex: 1; }
	.select-trigger {
		display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; min-width: 0; height: var(--control-h, 30px); padding: 0 8px 0 9px;
		border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; text-align: left; cursor: pointer;
	}
	.select-trigger:hover:not(:disabled), .select-trigger:global([data-xr-hover]) { border-color: #3a4157; }
	.select-trigger[aria-expanded='true'] { border-color: var(--accent); }
	.select-trigger:disabled { opacity: 0.5; cursor: not-allowed; }
	.select-trigger.invalid { border-color: var(--danger); }
	.shown { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.shown.placeholder { color: var(--muted); }
	.pop {
		position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; min-width: 100%; display: flex; flex-direction: column; overflow: hidden;
		border: 1px solid var(--border); border-radius: 8px; background: var(--panel); box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
	}
	.pop.up { top: auto; bottom: calc(100% + 4px); }
	.search { flex: none; margin: 4px; width: calc(100% - 8px); }
	.list { overflow-y: auto; padding: 4px; }
	.group { padding: 6px 8px 2px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
	.opt {
		display: flex; align-items: center; gap: 6px; width: 100%; min-height: var(--control-h, 30px); padding: 4px 8px; border: 0; border-radius: 6px;
		background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer;
	}
	.opt:hover, .opt:global([data-xr-hover]), .opt[data-active='true'] { background: var(--panel-3); }
	.opt[aria-selected='true'] { color: var(--accent); }
	.opt[aria-disabled='true'] { opacity: 0.45; cursor: not-allowed; }
	.check { flex: none; width: 12px; font-size: 11px; }
	.text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.none { padding: 8px; color: var(--muted); }
</style>
