<script lang="ts">
	import { adapterIcon, adapterLabel } from '$lib/studio/ui/adapters';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { InventoryItem } from '@kithin/engine/inventory/types';
	import { Library } from '$lib/studio/state/library.svelte';
	import { studioSession } from '$lib/studio/state/session.svelte';
	import { dialogs } from '$lib/studio/state/dialogs.svelte';
	import { toasts } from '$lib/studio/state/toasts.svelte';
	import Icon from '$lib/studio/ui/Icon.svelte';
	import LauncherShell from '$lib/studio/components/LauncherShell.svelte';
	import ItemThumb from '$lib/studio/components/ItemThumb.svelte';
	import { CONTAINER_ACCEPT, importProjectFile } from '$lib/studio/state/containerFiles';

	const library = new Library(studioSession.context);
	const adapterPreferenceKey = 'studio-inventory-adapter';
	let loadedFor = $state<string | null>(null);

	const adapters = $derived(studioSession.adapters.filter((adapter) => adapter.id !== 'world'));

	$effect(() => {
		if (!studioSession.ready) return;
		const key = adapters.map((adapter) => adapter.id).join(',');
		if (loadedFor === key) return;
		loadedFor = key;
		let preferred: string | null = null;
		try { preferred = localStorage.getItem(adapterPreferenceKey); } catch { /* Storage may be disabled. */ }
		if (preferred && adapters.some((adapter) => adapter.id === preferred)) library.adapterId = preferred;
		else if (!adapters.some((adapter) => adapter.id === library.adapterId)) library.adapterId = adapters[0]?.id ?? 'local';
		void library.load();
	});

	function editUrl(params: Record<string, string>): string {
		return `${resolve('/studio/edit')}?${new URLSearchParams(params)}`;
	}

	function openItem(item: InventoryItem) {
		void goto(editUrl({ source: library.adapterId, folder: library.folderId ?? 'root', item: item.id }));
	}

	async function switchAdapter(id: string) {
		try { localStorage.setItem(adapterPreferenceKey, id); } catch { /* Storage may be disabled. */ }
		await library.switchAdapter(id);
	}

	async function reconnectDirectory() {
		try { await library.adapter?.connect?.(); await library.load(); }
		catch (error) { toasts.error(error, 'Could not reconnect the folder'); }
	}

	async function connectDirectory() {
		try {
			await library.adapter?.connect?.(true);
			await library.goTo(-1);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			toasts.error(error, 'Could not open the folder');
		}
	}

	let importInput = $state<HTMLInputElement>();
	let importing = $state(false);

	async function importFiles(files: Iterable<File> | null) {
		if (!files) return;
		importing = true;
		try {
			if (library.adapter?.saveItem === undefined) throw new Error('This location is read-only. Choose another one to import into.');
			for (const file of files) {
				const result = await importProjectFile(file, { adapterId: library.adapterId, folderId: library.folderId, context: studioSession.context });
				if (result.missing) toasts.error(new Error(`${result.missing} asset${result.missing === 1 ? ' is' : 's are'} missing from the file and from this device.`), `Imported “${result.item.name}” incomplete`);
				else toasts.success(`Imported “${result.item.name}”`);
			}
			await library.load();
		} catch (error) {
			toasts.error(error, 'Could not import the file');
		} finally {
			importing = false;
			if (importInput) importInput.value = '';
		}
	}

	async function newFolder() {
		const name = await dialogs.prompt({ title: 'New folder', value: 'New folder', confirmLabel: 'Create' });
		if (!name) return;
		try {
			await library.createFolder(name);
		} catch (error) {
			toasts.error(error, 'Could not create the folder');
		}
	}

	async function removeItem(item: InventoryItem) {
		const ok = await dialogs.confirm({ title: `Delete “${item.name}”?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
		if (!ok) return;
		try {
			await library.deleteItem(item);
			toasts.success('Deleted');
		} catch (error) {
			toasts.error(error, 'Could not delete');
		}
	}

	async function removeFolder(folder: { id: string; name: string; parentId: string | null }) {
		const ok = await dialogs.confirm({ title: `Delete folder “${folder.name}”?`, message: 'Everything inside it is deleted too.', confirmLabel: 'Delete', danger: true });
		if (!ok) return;
		try {
			await library.deleteFolder(folder);
		} catch (error) {
			toasts.error(error, 'Could not delete the folder');
		}
	}

	function dateLabel(iso: string): string {
		const date = new Date(iso);
		return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<LauncherShell active="projects" ondropfiles={(files) => void importFiles(files)}>
	<div class="page">
		<section aria-labelledby="projects-heading">
			<div class="row">
				<h1 id="projects-heading">Projects</h1>
				<div class="tools">
					{#if adapters.length > 1}
						<div class="tabs" role="tablist" aria-label="Storage">
							{#each adapters as adapter (adapter.id)}
								<button class="tab" role="tab" aria-selected={library.adapterId === adapter.id} onclick={() => switchAdapter(adapter.id)}>
									<Icon name={adapterIcon(adapter.id)} size={14} />{adapterLabel(adapter.id, adapter.label)}
								</button>
							{/each}
						</div>
					{/if}
					<label class="search">
						<Icon name="search" size={14} />
						<span class="sr-only">Search projects</span>
						<input class="input" placeholder="Search" bind:value={library.query} />
					</label>
					{#if library.adapter?.saveItem}
						<input bind:this={importInput} type="file" accept={CONTAINER_ACCEPT} multiple hidden onchange={(event) => void importFiles(event.currentTarget.files)} />
						<button class="btn" disabled={importing} title="Import .kiw, .kin or .kia files" onclick={() => importInput?.click()}><Icon name="upload" size={14} />{importing ? 'Importing…' : 'Import'}</button>
					{/if}
					{#if library.adapter?.connect}<button class="btn" onclick={connectDirectory}><Icon name="folder" size={14} />Choose folder</button>{/if}
					{#if library.adapter?.createFolder}<button class="btn" onclick={newFolder}><Icon name="folder-plus" size={14} />New folder</button>{/if}
				</div>
			</div>

			{#if library.path.length}
				<nav class="crumbs" aria-label="Folder path">
					<button class="btn ghost sm" onclick={() => library.goTo(-1)}>All projects</button>
					{#each library.path as folder, index (folder.id)}
						<Icon name="chevron-right" size={12} />
						<button class="btn ghost sm" onclick={() => library.goTo(index)}>{folder.name}</button>
					{/each}
				</nav>
			{/if}

			{#if library.error}
				<div class="empty" role="alert"><Icon name="warning" size={22} /><strong>Could not load projects</strong>{library.error}<button class="btn" onclick={() => library.load()}>Try again</button>{#if library.adapter?.connect}<button class="btn" onclick={reconnectDirectory}>Reconnect folder</button>{/if}</div>
			{:else if library.loading && !library.items.length && !library.folders.length}
				<div class="empty">Loading…</div>
			{:else if !library.visibleItems.length && !library.visibleFolders.length}
				<div class="empty">
					<strong>{library.query ? 'No matches' : 'Nothing here yet'}</strong>
					{library.query ? 'Try a different search.' : library.adapter?.connect ? 'Choose a folder to load or save inventory JSON files.' : 'Create your first project from the Home screen.'}
				</div>
			{:else}
				<ul class="grid">
					{#each library.visibleFolders as folder (folder.id)}
						<li class="card folder">
							<button class="card-main" onclick={() => library.openFolder(folder)}>
								<span class="card-icon"><Icon name="folder" size={20} /></span>
								<strong>{folder.name}</strong>
							</button>
							{#if library.adapter?.deleteFolder}<button class="icon-btn danger" aria-label={`Delete folder ${folder.name}`} onclick={() => removeFolder(folder)}><Icon name="trash" size={14} /></button>{/if}
						</li>
					{/each}
					{#each library.visibleItems as item (item.id)}
						<li class="card">
							<button class="card-main" onclick={() => openItem(item)}>
								<span class="card-icon preview"><ItemThumb assetId={item.thumbnailAssetId} icon={item.kind === 'world' ? 'world' : item.kind === 'avatar' ? 'user' : 'cube'} iconSize={22} /></span>
								<span class="card-text">
									<strong>{item.name}</strong>
									<span class="muted">{dateLabel(item.createdAt)}{item.kind === 'world' && item.revisionNumber ? ` · revision ${item.revisionNumber}` : ''}</span>
								</span>
							</button>
							<span class="badge {item.kind === 'world' ? 'accent' : ''}">{item.kind === 'world' ? 'World' : item.kind === 'avatar' ? 'Avatar' : 'Object'}</span>
							{#if library.adapter?.deleteItem}<button class="icon-btn danger" aria-label={`Delete ${item.name}`} onclick={() => removeItem(item)}><Icon name="trash" size={14} /></button>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</LauncherShell>

<style>
	.page { max-width: var(--page-width); }
	h1 { margin: 0; font-size: 22px; font-weight: 650; }
	.card-icon { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); }
	.card-text { display: grid; flex: 1; min-width: 0; gap: 2px; }
	.row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
	.tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
	.search { position: relative; display: flex; align-items: center; width: 200px; color: var(--muted); }
	.search :global(svg) { position: absolute; left: 9px; pointer-events: none; }
	.search .input { padding-left: 28px; }
	.crumbs { display: flex; align-items: center; gap: 2px; margin-bottom: 12px; color: var(--muted); }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
	.card { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 6px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); }
	.card:hover { border-color: #3a4157; }
	.card-main { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; padding: 4px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
	.card-main strong, .card-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.card-icon.preview { width: 56px; height: 56px; overflow: hidden; }
	.card.folder .card-icon { background: var(--panel-3); color: var(--muted); }
	@media (max-width: 600px) { .search { width: 100%; } .tools { width: 100%; } }
</style>
