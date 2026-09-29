<script lang="ts">
	import CodeEditor from '../CodeEditor.svelte';
	import { parseSlotTreeJSON, serializeSlotTree } from '../model';
	import type { StudioDocument } from '../state/document.svelte';
	import { toasts } from '../state/toasts.svelte';

	interface Props {
		doc: StudioDocument;
	}

	let { doc }: Props = $props();

	let draft = $state('');
	let edited = $state(false);
	let error = $state('');

	// Follow the document until the person starts typing here.
	$effect(() => {
		const text = serializeSlotTree(doc.tree);
		if (!edited) draft = text;
	});

	function apply() {
		const result = parseSlotTreeJSON(draft);
		if ('error' in result) {
			error = result.error;
			return;
		}
		doc.replaceTree(result.tree);
		edited = false;
		error = '';
		toasts.success(`Applied ${result.tree.length} object${result.tree.length === 1 ? '' : 's'}`);
	}

	function reset() {
		edited = false;
		error = '';
		draft = serializeSlotTree(doc.tree);
	}
</script>

<div class="json-view">
	<div class="bar">
		<span class="muted">The whole scene as JSON. Paste an exported object to replace it.</span>
		<button class="btn sm" disabled={!edited} onclick={reset}>Reset</button>
		<button class="btn primary sm" disabled={!edited} onclick={apply}>Apply</button>
	</div>
	<CodeEditor language="json" value={draft} onChange={(text) => { if (text === draft) return; draft = text; edited = true; }} />
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.json-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
	.bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
	.bar .muted { flex: 1; }
	.error { margin: 0; padding: 8px 12px; border-top: 1px solid var(--border); color: var(--danger); }
</style>
