<script lang="ts">
	import type { Slot } from '$lib/ecs/types';
	import { normalizeSourceRef } from '$lib/assets/ref';
	import type { InspectorDocument } from '../state/docOps';
	import { subtreeIds, canRemoveSlot } from '../tree/ops';
	import Select, { type SelectOption } from '../ui/Select.svelte';
	import Icon from '../ui/Icon.svelte';

	export interface LogLine {
		timestamp: number;
		level: string;
		hook: string;
		message: string;
	}

	interface Props {
		doc: InspectorDocument;
		target: Slot;
		/** Where the object can be saved to (the player's inventory folders). */
		folders: { id: string; label: string }[];
		/** The codeBlock's recent errors and `ctx.log` output, newest last. */
		log: LogLine[];
		onSave: (adapterId: string) => void;
		onCreateContainer: () => void;
	}

	let { doc, target, folders, log, onSave, onCreateContainer }: Props = $props();

	const MAX_MESSAGE_CHARS = 120;

	const audio = $derived(target.components.find((component) => component.type === 'audioPlayer'));
	const hasCode = $derived(target.components.some((component) => component.type === 'codeBlock'));
	const audioSource = $derived.by(() => {
		if (!audio || audio.type !== 'audioPlayer') return '';
		const source = normalizeSourceRef(audio.source, audio.url);
		return source.kind === 'url' ? source.url || 'Not configured' : `Asset ${source.assetId.slice(7, 15)}…`;
	});

	const parentOptions = $derived.by<SelectOption[]>(() => {
		const own = subtreeIds(doc.tree, target.id);
		return [{ value: '', label: '— top level —' }, ...doc.tree.filter((other) => !own.has(other.id)).map((other) => ({ value: other.id, label: other.name || 'Unnamed' }))];
	});

	function ago(timestamp: number): string {
		const delta = Date.now() - timestamp;
		if (delta < 1000) return 'just now';
		if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
		if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
		return `${Math.floor(delta / 3_600_000)}h ago`;
	}

	const truncate = (message: string) => (message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}…` : message);
</script>

<fieldset class="editable" disabled={doc.readonly}>
	<div class="section">
		<h3>Hierarchy</h3>
		<div class="row">
			<span class="row-label">Parent</span>
			<Select searchable label="Parent" value={target.parentId ?? ''} options={parentOptions} onchange={(id) => doc.reparent(target.id, id || null)} />
		</div>
	</div>

	{#if audio}
		<div class="section">
			<h3>Audio player</h3>
			<p class="mono">Source: {audioSource}</p>
		</div>
	{/if}

	{#if hasCode}
		<div class="section">
			<h3>Code block — debug log</h3>
			<div class="log" role="log" aria-label="Code block debug log">
				{#each [...log].reverse() as entry (`${entry.timestamp}:${entry.hook}:${entry.message}`)}
					<div class="line" class:error={entry.level === 'error'}>[{ago(entry.timestamp)}] {entry.hook}: {truncate(entry.message)}</div>
				{:else}
					<div class="line muted">No errors or log output yet.</div>
				{/each}
			</div>
		</div>
	{/if}

	<div class="section actions">
		<h3>Actions</h3>
		<div class="buttons">
			{#each folders as folder (folder.id)}
				<button class="btn success" onclick={() => onSave(folder.id)}><Icon name="save" size={14} />Save ({folder.label})</button>
			{/each}
			<button class="btn" onclick={onCreateContainer}><Icon name="plus" size={14} />Container</button>
			<button class="btn" disabled={!doc.selectedId} onclick={() => doc.duplicateSelected()}><Icon name="copy" size={14} />Duplicate</button>
			<button class="btn danger" disabled={!canRemoveSlot(doc.tree, target.id)} onclick={() => doc.removeSelected()}><Icon name="trash" size={14} />Delete</button>
		</div>
	</div>
</fieldset>

<style>
	.editable { display: contents; min-width: 0; margin: 0; padding: 0; border: 0; }
	.section { display: grid; gap: 8px; padding: 12px; border-top: 1px solid var(--border); }
	h3 { margin: 0; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
	.row { display: grid; grid-template-columns: var(--label-w, 70px) 1fr; align-items: center; gap: 8px; }
	.row-label { color: var(--muted); font-size: 12px; }
	p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
	.mono { font-family: var(--mono); }
	.log { display: grid; gap: 2px; max-height: 180px; overflow-y: auto; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); font: 12px var(--mono); }
	.line { overflow-wrap: anywhere; }
	.line.error { color: var(--danger); }
	.buttons { display: flex; flex-wrap: wrap; gap: 8px; }
	.btn.success { border-color: rgb(62 207 142 / 0.5); color: var(--success); }
</style>
