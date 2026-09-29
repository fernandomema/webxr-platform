<script lang="ts">
	import { studioSession } from '../state/session.svelte';
	import { Library } from '../state/library.svelte';
	import { toasts } from '../state/toasts.svelte';
	import type { StudioDocument } from '../state/document.svelte';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		doc: StudioDocument;
	}

	let { doc }: Props = $props();

	const library = new Library(studioSession.context);
	const adapters = $derived(studioSession.adapters.filter((adapter) => adapter.id !== 'world'));
	let started = $state(false);

	$effect(() => {
		if (!studioSession.ready || started) return;
		started = true;
		void library.load();
	});

	const objects = $derived(library.visibleItems.filter((item) => item.kind !== 'world'));

	function insert(id: string) {
		const item = library.items.find((candidate) => candidate.id === id);
		if (!item) return;
		if (doc.insertFragment(item.slotData)) toasts.success(`Added “${item.name}”`);
	}
</script>

<div class="assets">
	<div class="toolbar">
		{#if adapters.length > 1}
			<select class="select" aria-label="Library" value={library.adapterId} onchange={(event) => library.switchAdapter(event.currentTarget.value)}>
				{#each adapters as adapter (adapter.id)}<option value={adapter.id}>{adapter.id === 'cloud' ? 'Cloud' : 'This device'}</option>{/each}
			</select>
		{/if}
		<input class="input" placeholder="Search objects" aria-label="Search objects" bind:value={library.query} />
	</div>
	{#if library.path.length}
		<div class="crumbs">
			<button class="btn ghost sm" onclick={() => library.goTo(-1)}><Icon name="back" size={12} />Back to top</button>
			<span class="muted">{library.path.at(-1)?.name}</span>
		</div>
	{/if}
	<ul>
		{#each library.visibleFolders as folder (folder.id)}
			<li><button class="row" onclick={() => library.openFolder(folder)}><Icon name="folder" size={14} />{folder.name}</button></li>
		{/each}
		{#each objects as item (item.id)}
			<li><button class="row" title="Add to the scene" onclick={() => insert(item.id)}><Icon name="cube" size={14} /><span>{item.name}</span><Icon name="plus" size={13} /></button></li>
		{/each}
		{#if library.error}
			<li class="empty" role="alert">{library.error}</li>
		{:else if !library.loading && !objects.length && !library.visibleFolders.length}
			<li class="empty"><strong>No saved objects</strong>Save an object from the Studio and it shows up here to reuse in any world.</li>
		{/if}
	</ul>
</div>

<style>
	.assets { display: flex; flex-direction: column; height: 100%; min-height: 0; }
	.toolbar { display: flex; gap: 6px; padding: 8px; }
	.toolbar .select { width: auto; flex: none; }
	.crumbs { display: flex; align-items: center; gap: 6px; padding: 0 8px 4px; }
	ul { flex: 1; margin: 0; padding: 0 4px 8px; overflow-y: auto; list-style: none; }
	.row { display: flex; align-items: center; gap: 8px; width: 100%; height: 30px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
	.row span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.row:hover { background: var(--panel-2); }
	.row :global(svg:last-child) { color: var(--muted); }
</style>
