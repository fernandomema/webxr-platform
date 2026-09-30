<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { Slot } from '$lib/ecs/types';
	import type { InspectorDocument } from '../state/docOps';
	import { canRemoveSlot, flattenTree, subtreeIds } from '../tree/ops';
	import { componentSchema } from '../schema/components';
	import Icon from '../ui/Icon.svelte';
	import Tooltip from '../ui/Tooltip.svelte';

	interface Props {
		doc: InspectorDocument;
		onAdd: () => void;
		onDelete: () => void;
	}

	let { doc, onAdd, onDelete }: Props = $props();

	/** Rows rendered beyond the visible ones. The XR panel asks for more (`--overscan`): its scrolling moves a picture of the list, which should not run out of rows. */
	let overscan = $state(6);
	/** Pointer travel before a press on a row turns into a drag, so a click never reparents by accident. */
	const DRAG_THRESHOLD = 5;
	const EDGE_SCROLL = 28;

	let collapsed = $state(new Set<string>());
	let filter = $state('');
	let dragId = $state<string | null>(null);
	let dropTarget = $state<string | null>(null);
	let overRoot = $state(false);
	let scroller = $state<HTMLDivElement>();
	let scrollTop = $state(0);
	let viewHeight = $state(400);
	let rowHeight = $state(28);
	let press: { id: string; x: number; y: number } | null = null;
	let suppressClick = false;

	const rows = $derived(flattenTree(doc.tree, collapsed));
	const filtered = $derived(filter.trim() ? flattenTree(doc.tree).filter((row) => row.slot.name.toLowerCase().includes(filter.trim().toLowerCase())) : rows);
	const hasChildren = $derived(new Set(doc.tree.map((slot) => slot.parentId).filter((id): id is string => id !== null)));

	// Only the rows in view (plus a few) are rendered: a world can hold hundreds of slots, and a small DOM is what keeps
	// the page cheap to draw, both in the Studio and in the XR panel where the page is re-rasterized on every change.
	// The window moves in steps of half the overscan, not row by row, so scrolling changes the DOM only now and then.
	const step = $derived(Math.max(1, Math.floor(overscan / 2)));
	const first = $derived(Math.max(0, Math.floor((scrollTop / rowHeight - overscan) / step) * step));
	const last = $derived(Math.min(filtered.length, Math.ceil(((scrollTop + viewHeight) / rowHeight + overscan) / step) * step));
	const visible = $derived(filtered.slice(first, last));

	/** Reads the scroll position and size. Done on scroll and resize events rather than with an observer, which would not run while the XR page is not being rendered. */
	function measure() {
		if (!scroller) return;
		scrollTop = scroller.scrollTop;
		viewHeight = scroller.clientHeight || viewHeight;
	}

	onMount(() => {
		const token = getComputedStyle(scroller!).getPropertyValue('--row-h');
		const parsed = parseFloat(token);
		if (Number.isFinite(parsed) && parsed > 0) rowHeight = parsed;
		const extra = parseInt(getComputedStyle(scroller!).getPropertyValue('--overscan'));
		if (Number.isFinite(extra) && extra > 0) overscan = extra;
		measure();
	});

	function toggle(id: string) {
		const next = new Set(collapsed);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		collapsed = next;
	}

	function icon(slot: Slot): string {
		const firstComponent = slot.components[0];
		return firstComponent ? componentSchema(firstComponent.type).glyph : '▫';
	}

	function canDrop(target: string): boolean {
		return dragId !== null && !subtreeIds(doc.tree, dragId).has(target);
	}

	function endDrag() {
		if (dragId && (dropTarget || overRoot) && dragId !== dropTarget) doc.reparent(dragId, dropTarget);
		dragId = dropTarget = null;
		overRoot = false;
	}

	function onRowDown(event: PointerEvent, id: string) {
		// Dragging to reparent is for a mouse. A laser shakes (a press would turn into a drag, and a click into a move); in
		// the XR panel dragging scrolls the list, and the Parent field reparents.
		if (doc.readonly || event.button !== 0 || event.pointerType !== 'mouse' || (event.target as HTMLElement).closest('.twisty')) return;
		press = { id, x: event.clientX, y: event.clientY };
	}

	// Window listeners rather than pointer capture: the XR panel feeds in synthetic events, which cannot be captured.
	function onPointerMove(event: PointerEvent) {
		if (!press || !scroller) return;
		if (!dragId) {
			if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_THRESHOLD) return;
			dragId = press.id;
		}
		const hit = scroller.ownerDocument.elementFromPoint(event.clientX, event.clientY);
		const row = hit?.closest<HTMLElement>('[data-row-id]');
		const id = row?.dataset.rowId ?? null;
		dropTarget = id && canDrop(id) ? id : null;
		overRoot = !row && Boolean(hit?.closest('.root-drop'));
		const box = scroller.getBoundingClientRect();
		if (event.clientY < box.top + EDGE_SCROLL) scroller.scrollTop -= rowHeight / 2;
		else if (event.clientY > box.bottom - EDGE_SCROLL) scroller.scrollTop += rowHeight / 2;
	}

	/** A scroll gesture took the pointer over (the XR panel): abandon the drag without dropping anything. */
	function onPointerCancel() {
		dragId = dropTarget = null;
		overRoot = false;
		press = null;
	}

	function onPointerUp() {
		if (dragId) {
			suppressClick = true;
			setTimeout(() => (suppressClick = false), 0);
			endDrag();
		}
		press = null;
	}

	function onRowClick(id: string) {
		if (suppressClick) return;
		doc.select(id);
	}

	/** Scrolls so that row `index` is in view. */
	function reveal(index: number) {
		if (!scroller || index < 0) return;
		const top = index * rowHeight;
		if (top < scroller.scrollTop) scroller.scrollTop = top;
		else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + rowHeight - scroller.clientHeight;
		measure();
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

	// ...and scrolled into view, when it was picked somewhere else (the 3D view).
	$effect(() => {
		const id = doc.selectedId;
		if (!id) return;
		const index = filtered.findIndex((row) => row.slot.id === id);
		if (index >= 0) reveal(index);
	});

	async function onKey(event: KeyboardEvent, index: number) {
		const list = filtered;
		if (event.key === 'ArrowDown' && list[index + 1]) doc.select(list[index + 1].slot.id);
		else if (event.key === 'ArrowUp' && list[index - 1]) doc.select(list[index - 1].slot.id);
		else if (event.key === 'ArrowRight' && collapsed.has(list[index].slot.id)) toggle(list[index].slot.id);
		else if (event.key === 'ArrowLeft' && hasChildren.has(list[index].slot.id) && !collapsed.has(list[index].slot.id)) toggle(list[index].slot.id);
		else return;
		event.preventDefault();
		await tick();
		scroller?.querySelector<HTMLElement>('[data-row][aria-selected="true"]')?.focus({ preventScroll: true });
	}
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} onpointercancel={onPointerCancel} onresize={measure} />

<div class="hierarchy">
	<div class="toolbar">
		<label class="filter">
			<Icon name="search" size={13} />
			<span class="sr-only">Filter objects</span>
			<input class="input" placeholder="Filter" bind:value={filter} />
		</label>
		<Tooltip text="Add object" align="end"><button class="icon-btn" aria-label="Add object" disabled={doc.readonly} onclick={onAdd}><Icon name="plus" /></button></Tooltip>
		<Tooltip text="Delete (Del)" align="end"><button class="icon-btn danger" aria-label="Delete selected object" disabled={doc.readonly || !doc.selectedId || !canRemoveSlot(doc.tree, doc.selectedId)} onclick={onDelete}><Icon name="trash" /></button></Tooltip>
	</div>

	<div class="viewport" bind:this={scroller} onscroll={measure} role="tree" aria-label="Scene hierarchy" tabindex="-1">
		<div class="spacer" style:height="{filtered.length * rowHeight}px">
			<div class="window" style:top="{first * rowHeight}px">
				{#each visible as row, offset (row.slot.id)}
					{@const id = row.slot.id}
					{@const index = first + offset}
					<div
						class="row"
						class:selected={doc.selectedId === id}
						class:drop={dropTarget === id}
						class:dragging={dragId === id}
						data-row
						data-row-id={id}
						aria-selected={doc.selectedId === id}
						style:padding-left="calc(6px + {filter ? 0 : row.depth} * var(--tree-indent, 14px))"
						tabindex={doc.selectedId === id || (!doc.selectedId && index === 0) ? 0 : -1}
						role="treeitem"
						aria-level={row.depth + 1}
						aria-expanded={hasChildren.has(id) ? !collapsed.has(id) : undefined}
						onpointerdown={(event) => onRowDown(event, id)}
						onclick={() => onRowClick(id)}
						onkeydown={(event) => void onKey(event, index)}
					>
						{#if hasChildren.has(id) && !filter}
							<button class="twisty" tabindex="-1" aria-label={collapsed.has(id) ? 'Expand' : 'Collapse'} onclick={(event) => { event.stopPropagation(); toggle(id); }}>
								<Icon name={collapsed.has(id) ? 'chevron-right' : 'chevron-down'} size={12} />
							</button>
						{:else}<span class="twisty"></span>{/if}
						<span class="glyph" aria-hidden="true">{icon(row.slot)}</span>
						<span class="label">{row.slot.name || 'Unnamed'}</span>
					</div>
				{/each}
			</div>
		</div>
		{#if filtered.length === 0}<div class="empty">No objects match.</div>{/if}
	</div>
	<!-- Releasing over the empty area moves the dragged object to the top level. -->
	<div class="root-drop" class:active={dragId !== null} class:over={overRoot} role="presentation">
		{#if dragId}Drop here to move to the top level{/if}
	</div>
</div>

<style>
	.hierarchy { display: flex; flex-direction: column; height: 100%; min-height: 0; }
	.toolbar { display: flex; align-items: center; gap: 4px; padding: 8px; }
	.filter { position: relative; display: flex; flex: 1; align-items: center; color: var(--muted); }
	.filter :global(svg) { position: absolute; left: 8px; pointer-events: none; }
	.filter .input { padding-left: 27px; height: var(--control-h, 28px); }
	.viewport { flex: 0 1 auto; min-height: 0; padding: 0 4px; overflow-y: auto; }
	.spacer { position: relative; }
	.window { position: absolute; left: 0; right: 0; }
	.row { display: flex; align-items: center; gap: 4px; height: var(--row-h, 28px); padding-right: 8px; border-radius: 6px; cursor: default; user-select: none; }
	.row:hover, .row:global([data-xr-hover]) { background: var(--panel-2); }
	.row.selected { background: var(--accent-soft); }
	.row.drop { outline: 1px dashed var(--accent); }
	.row.dragging { opacity: 0.5; }
	.twisty { display: inline-grid; place-items: center; flex: none; width: 16px; height: 16px; padding: 0; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
	:global(.xr-panel) .twisty { width: 28px; height: 28px; }
	.glyph { flex: none; width: 18px; color: var(--accent); font-size: 11px; text-align: center; }
	.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.root-drop { flex: 1; min-height: 24px; margin: 4px; border-radius: 6px; color: var(--muted); font-size: 11px; text-align: center; line-height: 24px; }
	.root-drop.active { border: 1px dashed var(--border); }
	.root-drop.over { border-color: var(--accent); color: var(--text); }
</style>
