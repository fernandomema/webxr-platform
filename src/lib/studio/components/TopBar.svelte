<script lang="ts">
	import type { StudioProject } from '../state/project.svelte';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		project: StudioProject;
		advanced: boolean;
		onmode: (advanced: boolean) => void;
		onback: () => void;
		onsave: () => void;
		onpublish: () => void;
		onplay: () => void;
		onpalette: () => void;
	}

	let { project, advanced, onmode, onback, onsave, onpublish, onplay, onpalette }: Props = $props();

	const doc = $derived(project.doc);
	const state = $derived(project.saving ? 'saving' : !project.isSaved ? 'new' : doc.dirty ? 'dirty' : 'saved');
</script>

<header class="topbar">
	<button class="icon-btn" aria-label="Back to projects" title="Back to projects" onclick={onback}><Icon name="back" size={18} /></button>

	<div class="title">
		<span class="kind" title={doc.kind === 'world' ? 'World' : 'Object'}><Icon name={doc.kind === 'world' ? 'world' : 'cube'} size={16} /></span>
		<input class="name" aria-label="Project name" value={doc.name} oninput={(event) => doc.rename(event.currentTarget.value)} />
		<span class="badge {state === 'saved' ? 'success' : state === 'saving' ? '' : 'warning'}">
			{state === 'saving' ? 'Saving…' : state === 'new' ? 'Not saved yet' : state === 'dirty' ? 'Unsaved changes' : 'Saved'}
		</span>
	</div>

	<div class="spacer"></div>

	<div class="group">
		<button class="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!doc.canUndo} onclick={() => doc.undo()}><Icon name="undo" /></button>
		<button class="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!doc.canRedo} onclick={() => doc.redo()}><Icon name="redo" /></button>
	</div>

	<div class="tabs modes" role="tablist" aria-label="Editing mode">
		<button class="tab" role="tab" aria-selected={!advanced} onclick={() => onmode(false)}>Simple</button>
		<button class="tab" role="tab" aria-selected={advanced} onclick={() => onmode(true)}>Advanced</button>
	</div>

	<button class="icon-btn" aria-label="Command palette" title="Commands (Ctrl+K)" onclick={onpalette}><Icon name="command" /></button>
	<button class="btn" title="Try it in the game" onclick={onplay}><Icon name="play" size={14} /><span class="hide-sm">Play</span></button>
	<button class="btn" title="Save (Ctrl+S)" disabled={project.saving} onclick={onsave}><Icon name="save" size={14} /><span class="hide-sm">Save</span></button>
	{#if doc.kind === 'world'}
		<button class="btn primary" onclick={onpublish}><Icon name="publish" size={14} /><span class="hide-sm">Publish</span></button>
	{/if}
</header>

<style>
	.topbar { display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 10px; border-bottom: 1px solid var(--border); background: var(--panel); }
	.title { display: flex; align-items: center; gap: 8px; min-width: 0; }
	.kind { color: var(--accent); display: grid; }
	.name { width: min(280px, 34vw); height: 30px; padding: 0 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text); font: 600 14px var(--font); }
	.name:hover { border-color: var(--border); }
	.name:focus { border-color: var(--accent); background: var(--bg); outline: none; }
	.spacer { flex: 1; }
	.group { display: flex; }
	@media (max-width: 860px) { .hide-sm, .badge, .modes { display: none; } }
</style>
