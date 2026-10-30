<script lang="ts">
	import type { LintFinding } from '@kithin/engine/worlds/lint';
	import { getSlot } from '@kithin/engine/document/tree';
	import type { StudioDocument } from '../state/document.svelte';
	import Icon from '../ui/Icon.svelte';

	interface Props { doc: StudioDocument; findings: LintFinding[] }
	let { doc, findings }: Props = $props();

	const RULES: Record<LintFinding['rule'], string> = {
		'ui-layout': 'UI layout',
		'text-faces-away': 'Text faces away',
		'text-too-high': 'Text too high',
		'text-grazing': 'Text at a grazing angle',
		'panel-out-of-reach': 'Panel out of reach'
	};

	const nameOf = (id: string) => getSlot(doc.tree, id)?.name ?? id;
</script>

<div class="warnings">
	{#if findings.length === 0}
		<div class="empty"><strong>No warnings</strong><span>Nothing wrong was found in the data of this {doc.kind}.</span></div>
	{:else}
		<ul>
			{#each findings as finding, index (index)}
				<li>
					<button class="row" data-severity={finding.severity} aria-current={doc.selectedId === finding.slotId} onclick={() => doc.select(finding.slotId)}>
						<span class="mark"><Icon name="warning" size={14} /></span>
						<span class="body">
							<span class="head"><strong>{nameOf(finding.slotId)}</strong><span class="rule">{RULES[finding.rule]}</span></span>
							<span class="message">{finding.message}</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.warnings { height: 100%; overflow: auto; padding: 8px; }
	ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
	.row { display: flex; gap: 8px; width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel-2, transparent); color: var(--text); text-align: left; font: 12px var(--font); cursor: pointer; }
	.row:hover, .row[aria-current='true'] { background: var(--panel-3); }
	.mark { flex: none; margin-top: 1px; color: var(--warning); }
	.row[data-severity='error'] .mark { color: var(--danger, #ef4444); }
	.body { display: grid; gap: 2px; min-width: 0; }
	.head { display: flex; gap: 8px; align-items: baseline; }
	.head strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rule { color: var(--muted); font-size: 11px; white-space: nowrap; }
	.message { color: var(--muted); overflow-wrap: anywhere; }
</style>
