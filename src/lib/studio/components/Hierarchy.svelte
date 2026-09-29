<script lang="ts">
	import type { Slot } from '$lib/ecs/types';
	import type { StudioDocument } from '../state/document.svelte';
	import { canRemoveSlot, flattenTree, subtreeIds } from '../tree/ops';
	import { componentSchema } from '../schema/components';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		doc: StudioDocument;
		onAdd: () => void;
		onDelete: () => void;
	}

	let { doc, onAdd, onDelete }: Props = $props();

	let collapsed = $state(new Set<string>());
	let filter = $state('');
	let dragId = $state<string | null>(null);
	let dropTarget = $state<string | null>(null);

	const rows = $derived(flattenTree(doc.tree, collapsed));
	const filtered = $derived(filter.trim() ? flattenTree(doc.tree).filter((row) => row.slot.name.toLowerCase().includes(filter.trim().toLowerCase())) : rows);
	const hasChildren = $derived(new Set(doc.tree.map((slot) => slot.parentId).filter((id): id is string => id !== null)));

	function toggle(id: string) {
		const next = new Set(collapsed);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		collapsed = next;
	}

	function icon(slot: Slot): string {
		const first = slot.components[0];
		return first ? componentSchema(first.type).glyph : '▫';
	}

	function drop(target: string | null) {
		if (dragId && dragId !== target) doc.reparent(dragId, target);
		dragId = dropTarget = null;
	}

	function canDrop(target: string): boolean {
		return dragId !== null && !subtreeIds(doc.tree, dragId).has(target);
	}

	// Keep the selected row reachable: selecting a hidden child expands its ancestors.
	$effect(() => {
		const id = doc.selectedId;
		if (!id || !collapsed.size) return;
		let parent = doc.tree.find((slot) => slot.id === id)?.parentId ?? null;
		let changed = false;
		const next = new Set(collapsed);
		while (parent) {
			if (next.delete(parent)) changed = true;
			parent = doc.tree.find((slot) => slot.id === parent)?.parentId ?? null;
		}
		if (changed) collapsed = next;
	});

	function onKey(event: KeyboardEvent, index: number) {
		const list = filtered;
		if (event.key === 'ArrowDown' && list[index + 1]) doc.select(list[index + 1].slot.id);
		else if (event.key === 'ArrowUp' && list[index - 1]) doc.select(list[index - 1].slot.id);
		else if (event.key === 'ArrowRight' && collapsed.has(list[index].slot.id)) toggle(list[index].slot.id);
		else if (event.key === 'ArrowLeft' && hasChildren.has(list[index].slot.id) && !collapsed.has(list[index].slot.id)) toggle(list[index].slot.id);
		else return;
		event.preventDefault();
		queueMicrotask(() => document.querySelector<HTMLElement>('[data-row][aria-selected="true"]')?.focus());
	}
</script>

<div class="hierarchy">
	<div class="toolbar">
		<label class="filter">
			<Icon name="search" size={13} />
			<span class="sr-only">Filter objects</span>
			<input class="input" placeholder="Filter" bind:value={filter} />
		</label>
		<button class="icon-btn" aria-label="Add object" title="Add object" onclick={onAdd}><Icon name="plus" /></button>
		<button class="icon-btn danger" aria-label="Delete selected object" title="Delete (Del)" disabled={!doc.selectedId || !canRemoveSlot(doc.tree, doc.selectedId)} onclick={onDelete}><Icon name="trash" /></button>
	</div>

	<ul role="tree" aria-label="Scene hierarchy">
		{#each filtered as row, index (row.slot.id)}
			{@const id = row.slot.id}
			<li role="none">
				<div
					class="row"
					class:selected={doc.selectedId === id}
					class:drop={dropTarget === id}
					data-row
					aria-selected={doc.selectedId === id}
					style:padding-left="{6 + (filter ? 0 : row.depth) * 14}px"
					tabindex={doc.selectedId === id || (!doc.selectedId && index === 0) ? 0 : -1}
					role="treeitem"
					aria-level={row.depth + 1}
					aria-expanded={hasChildren.has(id) ? !collapsed.has(id) : undefined}
					draggable="true"
					onclick={() => doc.select(id)}
					onkeydown={(event) => onKey(event, index)}
					ondragstart={() => (dragId = id)}
					ondragend={() => (dragId = dropTarget = null)}
					ondragover={(event) => { if (canDrop(id)) { event.preventDefault(); dropTarget = id; } }}
					ondragleave={() => (dropTarget = null)}
					ondrop={(event) => { event.preventDefault(); drop(id); }}
				>
					{#if hasChildren.has(id) && !filter}
						<button class="twisty" tabindex="-1" aria-label={collapsed.has(id) ? 'Expand' : 'Collapse'} onclick={(event) => { event.stopPropagation(); toggle(id); }}>
							<Icon name={collapsed.has(id) ? 'chevron-right' : 'chevron-down'} size={12} />
						</button>
					{:else}<span class="twisty"></span>{/if}
					<span class="glyph" aria-hidden="true">{icon(row.slot)}</span>
					<span class="label">{row.slot.name || 'Unnamed'}</span>
				</div>
			</li>
		{:else}
			<li class="empty">No objects match.</li>
		{/each}
	</ul>
	<!-- Dropping on the empty area moves the dragged object to the top level. -->
	<div class="root-drop" class:active={dragId !== null} role="presentation" ondragover={(event) => { if (dragId) event.preventDefault(); }} ondrop={(event) => { event.preventDefault(); drop(null); }}>
		{#if dragId}Drop here to move to the top level{/if}
	</div>
</div>

<style>
	.hierarchy { display: flex; flex-direction: column; height: 100%; min-height: 0; }
	.toolbar { display: flex; align-items: center; gap: 4px; padding: 8px; }
	.filter { position: relative; display: flex; flex: 1; align-items: center; color: var(--muted); }
	.filter :global(svg) { position: absolute; left: 8px; pointer-events: none; }
	.filter .input { padding-left: 27px; height: 28px; }
	ul { flex: 0 1 auto; margin: 0; padding: 0 4px; list-style: none; overflow-y: auto; }
	.row { display: flex; align-items: center; gap: 4px; height: 28px; padding-right: 8px; border-radius: 6px; cursor: default; user-select: none; }
	.row:hover { background: var(--panel-2); }
	.row.selected { background: var(--accent-soft); }
	.row.drop { outline: 1px dashed var(--accent); }
	.twisty { display: inline-grid; place-items: center; flex: none; width: 16px; height: 16px; padding: 0; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
	.glyph { flex: none; width: 18px; color: var(--accent); font-size: 11px; text-align: center; }
	.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.root-drop { flex: 1; min-height: 24px; margin: 4px; border-radius: 6px; color: var(--muted); font-size: 11px; text-align: center; line-height: 24px; }
	.root-drop.active { border: 1px dashed var(--border); }
</style>
