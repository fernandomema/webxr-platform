<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Component, Slot, SlotTree } from '$lib/ecs/types';
	import { bakeWorld } from '../lighting/bakeWorld';
	import { ABORT_ERROR, bakeStatsText, bakeSummary } from '../lighting/bakeText';
	import type { BakeQuality, BakeStats } from '../lighting/bakeJob';
	import type { InspectorDocument } from '../state/docOps';
	import { studioAssets } from '../state/models.svelte';
	import { toasts } from '../state/toasts.svelte';

	interface Props {
		doc: InspectorDocument;
		/** The slot that holds the world settings; the baked lighting goes on it unless the world already has some. */
		slot: Slot;
		onclose: () => void;
	}

	let { doc, slot, onclose }: Props = $props();

	let quality = $state<BakeQuality>('normal');
	let skyIntensity = $state(0);
	let baking = $state(false);
	let fraction = $state(0);
	let stats = $state<BakeStats | null>(null);
	let controller: AbortController | null = null;

	// Closing the dialog while a bake runs cancels it.
	onDestroy(() => controller?.abort());

	const volumes = $derived(doc.tree.flatMap((candidate) => candidate.components.map((component, index) => ({ slotId: candidate.id, index, component })).filter((entry) => entry.component.type === 'lightVolume')));
	const bakedLights = $derived(doc.tree.reduce((count, candidate) => count + candidate.components.filter((component) => (component.type === 'pointLight' || component.type === 'spotLight') && component.baked).length, 0));
	const summary = $derived(bakeSummary(volumes.length > 0, bakedLights));
	const statsText = $derived(stats ? bakeStatsText(stats) : '');

	async function bake() {
		if (baking) return;
		baking = true; fraction = 0; stats = null;
		controller = new AbortController();
		try {
			const result = await bakeWorld(doc.tree as SlotTree, { quality, skyIntensity, onProgress: (value) => (fraction = value), signal: controller.signal });
			const data = { kind: 'asset', assetId: result.assetId };
			// The world keeps one baked lighting: baking again replaces the data of the one it has.
			const existing = volumes[0];
			if (existing) doc.setField(existing.slotId, existing.index, 'data', data);
			else doc.addRawComponent(slot.id, { type: 'lightVolume', data } as Component);
			stats = result.stats;
			await studioAssets.refresh();
			toasts.success('Lighting baked. Save to keep it.');
		} catch (error) {
			if (error instanceof DOMException && error.name === ABORT_ERROR) toasts.info('Bake cancelled.');
			else toasts.error(error, 'Could not bake the lighting');
		} finally { baking = false; controller = null; }
	}

	function removeBake() {
		// Remove from the last so earlier indexes stay valid.
		for (const entry of [...volumes].reverse()) doc.removeComponent(entry.slotId, entry.index);
		stats = null;
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="studio-backdrop" onclick={(event) => event.target === event.currentTarget && onclose()}>
	<div class="studio-modal" role="dialog" aria-modal="true" aria-label="Bake lighting">
		<h2>Bake lighting</h2>
		<p>{summary}</p>
		<div class="row">
			<label>
				<span>Quality</span>
				<select class="select" bind:value={quality} disabled={baking || doc.readonly}>
					<option value="draft">Draft (fast)</option>
					<option value="normal">Normal</option>
					<option value="high">High (slow)</option>
				</select>
			</label>
			<label>
				<span>Sky light</span>
				<input class="input" type="number" min="0" max="2" step="0.1" bind:value={skyIntensity} disabled={baking || doc.readonly} />
			</label>
		</div>
		{#if baking}<progress value={fraction} max="1" aria-label="Bake progress"></progress>{/if}
		{#if stats}<p class="result">{statsText}</p>{/if}
		<div class="actions">
			{#if baking}
				<button class="btn" onclick={() => controller?.abort()}>Cancel bake</button>
			{:else}
				{#if volumes.length}<button class="btn" disabled={doc.readonly} onclick={removeBake}>Remove baked lighting</button>{/if}
				<button class="btn" onclick={onclose}>Close</button>
				<button class="btn primary" disabled={doc.readonly} onclick={() => void bake()}>{volumes.length ? 'Bake again' : 'Bake lighting'}</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
	progress { width: 100%; margin-top: 14px; }
	.result { margin: 12px 0 0; }
</style>
