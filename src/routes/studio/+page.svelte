<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { InventoryItem } from '$lib/inventory/types';
	import { Library } from '$lib/studio/state/library.svelte';
	import { studioSession } from '$lib/studio/state/session.svelte';
	import { dialogs } from '$lib/studio/state/dialogs.svelte';
	import { toasts } from '$lib/studio/state/toasts.svelte';
	import { TEMPLATES } from '$lib/studio/templates';
	import Icon from '$lib/studio/ui/Icon.svelte';

	const library = new Library(studioSession.context);
	let loadedFor = $state<string | null>(null);

	const adapters = $derived(studioSession.adapters.filter((adapter) => adapter.id !== 'world'));

	$effect(() => {
		if (!studioSession.ready) return;
		const key = adapters.map((adapter) => adapter.id).join(',');
		if (loadedFor === key) return;
		loadedFor = key;
		if (!adapters.some((adapter) => adapter.id === library.adapterId)) library.adapterId = adapters[0]?.id ?? 'local';
		void library.load();
	});

	function editUrl(params: Record<string, string>): string {
		return `${resolve('/studio/edit')}?${new URLSearchParams(params)}`;
	}

	function startFromTemplate(id: string) {
		void goto(editUrl({ template: id, draft: crypto.randomUUID() }));
	}

	function openItem(item: InventoryItem) {
		void goto(editUrl({ source: library.adapterId, folder: library.folderId ?? 'root', item: item.id }));
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

<svelte:head>
	<title>Studio · WebXR Platform</title>
	<meta name="description" content="Create and edit worlds and objects for the WebXR platform." />
</svelte:head>

<div class="page">
	<header class="top">
		<div class="brand"><Icon name="cube" size={20} /><strong>Studio</strong></div>
		<nav>
			<a class="btn ghost" href={resolve('/play')}>Open game</a>
			{#if studioSession.userId}
				<span class="badge"><Icon name="user" size={12} />{studioSession.userName ?? 'Signed in'}</span>
			{:else if studioSession.ready}
				<a class="btn" href={resolve('/login')}>Sign in</a>
			{/if}
		</nav>
	</header>

	<main>
		<section aria-labelledby="new-heading">
			<h1 id="new-heading">Start something new</h1>
			<div class="templates">
				{#each TEMPLATES as template (template.id)}
					<button class="template" onclick={() => startFromTemplate(template.id)}>
						<span class="template-icon"><Icon name={template.kind === 'world' ? 'world' : 'cube'} size={22} /></span>
						<span class="template-text">
							<strong>{template.label}</strong>
							<span class="muted">{template.description}</span>
						</span>
						<span class="badge {template.kind === 'world' ? 'accent' : ''}">{template.kind === 'world' ? 'World' : 'Object'}</span>
					</button>
				{/each}
			</div>
		</section>

		<section aria-labelledby="projects-heading">
			<div class="row">
				<h2 id="projects-heading">Your projects</h2>
				<div class="tools">
					{#if adapters.length > 1}
						<div class="tabs" role="tablist" aria-label="Storage">
							{#each adapters as adapter (adapter.id)}
								<button class="tab" role="tab" aria-selected={library.adapterId === adapter.id} onclick={() => library.switchAdapter(adapter.id)}>
									<Icon name={adapter.id === 'cloud' ? 'cloud' : 'device'} size={14} />{adapter.id === 'cloud' ? 'Cloud' : 'This device'}
								</button>
							{/each}
						</div>
					{/if}
					<label class="search">
						<Icon name="search" size={14} />
						<span class="sr-only">Search projects</span>
						<input class="input" placeholder="Search" bind:value={library.query} />
					</label>
					<button class="btn" onclick={newFolder}><Icon name="folder-plus" size={14} />New folder</button>
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
				<div class="empty" role="alert"><Icon name="warning" size={22} /><strong>Could not load projects</strong>{library.error}<button class="btn" onclick={() => library.load()}>Try again</button></div>
			{:else if library.loading && !library.items.length && !library.folders.length}
				<div class="empty">Loading…</div>
			{:else if !library.visibleItems.length && !library.visibleFolders.length}
				<div class="empty">
					<strong>{library.query ? 'No matches' : 'Nothing here yet'}</strong>
					{library.query ? 'Try a different search.' : 'Pick a template above to create your first project.'}
				</div>
			{:else}
				<ul class="grid">
					{#each library.visibleFolders as folder (folder.id)}
						<li class="card folder">
							<button class="card-main" onclick={() => library.openFolder(folder)}>
								<span class="card-icon"><Icon name="folder" size={20} /></span>
								<strong>{folder.name}</strong>
							</button>
							<button class="icon-btn danger" aria-label={`Delete folder ${folder.name}`} onclick={() => removeFolder(folder)}><Icon name="trash" size={14} /></button>
						</li>
					{/each}
					{#each library.visibleItems as item (item.id)}
						<li class="card">
							<button class="card-main" onclick={() => openItem(item)}>
								<span class="card-icon"><Icon name={item.kind === 'world' ? 'world' : 'cube'} size={20} /></span>
								<span class="card-text">
									<strong>{item.name}</strong>
									<span class="muted">{dateLabel(item.createdAt)}{item.kind === 'world' && item.revisionNumber ? ` · revision ${item.revisionNumber}` : ''}</span>
								</span>
							</button>
							<span class="badge {item.kind === 'world' ? 'accent' : ''}">{item.kind === 'world' ? 'World' : 'Object'}</span>
							<button class="icon-btn danger" aria-label={`Delete ${item.name}`} onclick={() => removeItem(item)}><Icon name="trash" size={14} /></button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</main>
</div>

<style>
	.page { max-width: 1040px; margin: 0 auto; padding: 0 16px 64px; }
	.top { display: flex; align-items: center; justify-content: space-between; height: 56px; }
	.brand { display: flex; align-items: center; gap: 8px; color: var(--accent); }
	.brand strong { color: var(--text); font-size: 15px; }
	nav { display: flex; align-items: center; gap: 8px; }
	main { display: grid; gap: 40px; padding-top: 24px; }
	h1 { margin: 0 0 14px; font-size: 22px; font-weight: 650; }
	h2 { margin: 0; font-size: 16px; font-weight: 600; }
	.templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
	.template { display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); color: inherit; text-align: left; cursor: pointer; font: inherit; }
	.template:hover { border-color: var(--accent); background: var(--panel-2); }
	.template-icon, .card-icon { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); }
	.template-text, .card-text { display: grid; flex: 1; min-width: 0; gap: 2px; }
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
	.card.folder .card-icon { background: var(--panel-3); color: var(--muted); }
	@media (max-width: 600px) { .search { width: 100%; } .tools { width: 100%; } }
</style>
