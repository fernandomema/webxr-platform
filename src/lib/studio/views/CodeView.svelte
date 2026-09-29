<script lang="ts">
	import type { CodeBlockComponent } from '$lib/ecs/types';
	import CodeEditor from '../CodeEditor.svelte';
	import { lintCode } from '../lint/code';
	import type { StudioDocument } from '../state/document.svelte';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		doc: StudioDocument;
	}

	let { doc }: Props = $props();

	const slot = $derived(doc.selected);
	const blocks = $derived(
		(slot?.components ?? []).flatMap((component, index) => (component.type === 'codeBlock' ? [{ index, component: component as CodeBlockComponent }] : []))
	);
	let chosen = $state(0);
	const current = $derived(blocks.find((block) => block.index === chosen) ?? blocks[0]);
	const diagnostics = $derived(current ? lintCode(current.component.code) : []);
	let format: (() => void) | undefined;
</script>

<div class="code-view">
	{#if !slot}
		<div class="empty"><Icon name="code" size={22} /><strong>No object selected</strong>Select an object to edit its code.</div>
	{:else if !current}
		<div class="empty">
			<Icon name="code" size={22} />
			<strong>“{slot.name}” has no code block</strong>
			A code block gives an object behaviour, like reacting when it is grabbed.
			<button class="btn primary" onclick={() => doc.addComponent(slot.id, 'codeBlock')}><Icon name="plus" size={14} />Add code block</button>
		</div>
	{:else}
		<div class="bar">
			<span class="muted">Editing code on <strong>{slot.name}</strong></span>
			{#if blocks.length > 1}
				<select class="select" aria-label="Code block" bind:value={chosen}>
					{#each blocks as block, position (block.index)}<option value={block.index}>Code block {position + 1}</option>{/each}
				</select>
			{/if}
			<button class="btn sm" onclick={() => format?.()}>Format</button>
		</div>
		{#key `${slot.id}:${current.index}`}
			<CodeEditor value={current.component.code} onChange={(value) => doc.setField(slot.id, current.index, 'code', value)} onFormatReady={(fn) => (format = fn)} />
		{/key}
		<ul class="diagnostics" aria-label="Diagnostics">
			{#each diagnostics as diagnostic, index (index)}
				<li class={diagnostic.severity}><span class="badge {diagnostic.severity === 'error' ? '' : diagnostic.severity === 'warning' ? 'warning' : 'accent'}">{diagnostic.severity}</span> Line {diagnostic.line}: {diagnostic.message}</li>
			{:else}
				<li class="ok"><Icon name="check" size={13} /> No problems found</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.code-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
	.bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
	.bar .muted { flex: 1; }
	.bar .select { width: auto; }
	.diagnostics { max-height: 120px; margin: 0; padding: 8px 12px; overflow: auto; border-top: 1px solid var(--border); list-style: none; font-size: 12px; }
	.diagnostics li { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
	.ok { color: var(--success); }
	.badge.warning + * { color: var(--warning); }
	li.error { color: #ffb3b9; }
</style>
