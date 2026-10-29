<script lang="ts">
	import type { StudioDocument } from '../state/document.svelte';
	import type { AssetKind } from '@kithin/engine/library/types';
	import { addImportedAudio, addImportedModel, applyMaterial, materialBlocker } from '../library/apply';
	import type { ImportResult } from '../library/importers';
	import { formatBytes } from '../state/models.svelte';
	import { toasts } from '../state/toasts.svelte';
	import ExploreBrowser from './ExploreBrowser.svelte';

	interface Props { doc: StudioDocument }
	let { doc }: Props = $props();

	const TABS: { kind: AssetKind; label: string; action: string; optimized?: string }[] = [
		{ kind: 'model', label: 'Models', action: 'Add to scene', optimized: 'Add optimized' },
		{ kind: 'material', label: 'Materials', action: 'Apply to selection' },
		{ kind: 'audio', label: 'Sounds', action: 'Add to scene', optimized: 'Add optimized' }
	];
	let kind = $state<AssetKind>('model');
	const tab = $derived(TABS.find((entry) => entry.kind === kind)!);

	/** "Added “X”", and when it was optimized what that did to its size. */
	function added(name: string, optimized?: { before: number; after: number }): string {
		if (!optimized) return `Added “${name}”`;
		return optimized.after < optimized.before ? `Added “${name}” · ${formatBytes(optimized.before)} → ${formatBytes(optimized.after)}` : `Added “${name}” · already as light as it gets (${formatBytes(optimized.before)})`;
	}

	function imported(result: ImportResult) {
		if (result.kind === 'model') { addImportedModel(doc, result); toasts.success(added(result.name, result.optimized)); }
		else if (result.kind === 'audio') { addImportedAudio(doc, result); toasts.success(added(result.name, result.optimized)); }
		else if (result.kind === 'material') {
			const blocked = materialBlocker(doc, doc.selectedId);
			if (blocked || !doc.selectedId) toasts.push('error', `“${result.name}” is in your assets. ${blocked ?? 'Select an object first.'}`);
			else { applyMaterial(doc, doc.selectedId, result); toasts.success(`Applied “${result.name}”`); }
		}
	}
</script>

<div class="explore-panel">
	<div class="kinds" role="tablist" aria-label="What to look for">
		{#each TABS as entry (entry.kind)}
			<button class="kind" role="tab" aria-selected={kind === entry.kind} type="button" onclick={() => (kind = entry.kind)}>{entry.label}</button>
		{/each}
	</div>
	{#key kind}
		<div class="browser"><ExploreBrowser {kind} actionLabel={tab.action} optimizedLabel={tab.optimized} onimported={imported} /></div>
	{/key}
</div>

<style>
	.explore-panel { height: 100%; display: flex; flex-direction: column; min-height: 0; }
	/* Not `.tabs` / `.tab`: the studio's own tab styles would override these. */
	.kinds { display: flex; gap: 6px; padding: 16px 12px 6px; }
	.kind { padding: 6px 14px; border: 1px solid var(--border); border-radius: 999px; background: var(--panel-2); color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; }
	.kind[aria-selected='true'] { color: var(--text); border-color: var(--accent); background: var(--accent-soft); }
	.browser { flex: 1; min-height: 0; }
</style>
