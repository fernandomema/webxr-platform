<script lang="ts">
	import { collectAssetIds } from '@kithin/engine/assets/ref';
	import { getAssetKind } from '@kithin/engine/assets/kinds/index';
	import type { Slot } from '@kithin/engine/ecs/types';
	import { formatBytes, studioAssets } from '../state/models.svelte';

	interface Props {
		/** The selected object and the whole tree it is in. */
		slot: Slot;
		tree: readonly Slot[];
	}

	let { slot, tree }: Props = $props();

	$effect(() => {
		if (!studioAssets.loaded) void studioAssets.refresh();
	});

	/** The object and everything under it. */
	const subtree = $derived.by(() => {
		const found: Slot[] = [];
		const queue = [slot];
		for (let next = queue.pop(); next; next = queue.pop()) {
			found.push(next);
			for (const child of tree) if (child.parentId === next.id) queue.push(child);
		}
		return found;
	});

	/** What the assets it uses weigh on disk, by kind. A model's own pictures are inside its file, so they are counted there. */
	const weight = $derived.by(() => {
		const byKind = new Map<string, { bytes: number; count: number }>();
		let unknown = 0;
		for (const id of collectAssetIds(subtree)) {
			const listing = studioAssets.byId(id);
			if (!listing) { unknown += 1; continue; }
			const entry = byKind.get(listing.type) ?? { bytes: 0, count: 0 };
			entry.bytes += listing.byteSize;
			entry.count += 1;
			byKind.set(listing.type, entry);
		}
		const total = [...byKind.values()].reduce((sum, entry) => sum + entry.bytes, 0);
		return { total, unknown, kinds: [...byKind].map(([type, entry]) => ({ label: getAssetKind(type)?.label ?? type, ...entry })) };
	});
</script>

{#if weight.kinds.length || weight.unknown}
	<div class="section weight">
		<h3>Weight</h3>
		<div class="total"><span>{subtree.length > 1 ? 'This object and its children' : 'This object'}</span><strong>{formatBytes(weight.total)}</strong></div>
		{#each weight.kinds as kind (kind.label)}
			<div class="line"><span>{kind.label} · {kind.count}</span><span>{formatBytes(kind.bytes)}</span></div>
		{/each}
		{#if weight.unknown}<small class="muted">{weight.unknown} asset{weight.unknown === 1 ? '' : 's'} not on this device, not counted.</small>{/if}
	</div>
{/if}

<style>
	.section { display: grid; gap: 6px; padding: 12px; border-bottom: 1px solid var(--border); }
	h3 { margin: 0; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
	.total, .line { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
	.line { color: var(--muted); }
	.muted { color: var(--muted); }
</style>
