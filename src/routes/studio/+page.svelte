<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient } from '$lib/auth-client';
	import { availableInventoryFolders, getInventoryAdapter } from '$lib/inventory/registry';
	import type { InventoryAdapter, InventoryContext, InventoryFolder, InventoryItem } from '$lib/inventory/types';
	import type { Component, Slot, SlotTree, Vec3 } from '$lib/ecs/types';
	import {
		COMPONENT_DEFINITIONS,
		cloneTree,
		componentDefinition,
		componentFieldEntries,
		componentGlyph,
		flattenTree,
		lintCode,
		parseSlotTreeJSON,
		serializeSlotTree,
		starterTree,
		treeStats,
		type StudioView
	} from '$lib/studio/model';
	import CodeEditor from '$lib/studio/CodeEditor.svelte';
	import ScenePreview from '$lib/studio/ScenePreview.svelte';
	import './studio.css';

	const context: InventoryContext = { worldId: null, userId: null };
	let adapters = $state<InventoryAdapter[]>([]);
	let activeAdapterId = $state('local');
	let adapter = $state<InventoryAdapter | null>(null);
	let folders = $state<InventoryFolder[]>([]);
	let items = $state<InventoryItem[]>([]);
	let currentFolderId = $state<string | null>(null);
	let folderCache = $state(new Map<string, InventoryFolder>());
	let selectedItem = $state<InventoryItem | null>(null);
	let selectedSlotId = $state<string | null>(null);
	let selectedComponentIndex = $state(0);
	let tree = $state<SlotTree>(starterTree());
	let draftName = $state('');
	let searchQuery = $state('');
	let activeView = $state<StudioView>('assets');
	let isLoading = $state(true);
	let isSaving = $state(false);
	let isDirty = $state(true);
	let statusMessage = $state('');
	let userLabel = $state('');
	let showAddMenu = $state(false);
	let showComponentMenu = $state(false);
	let formatCodeBlock = $state<(() => void) | null>(null);
	let rawJsonDraft = $state('');
	let rawJsonError = $state('');

	let selectedSlot = $derived(tree.find((slot) => slot.id === selectedSlotId));
	let selectedComponent = $derived(selectedSlot?.components[selectedComponentIndex]);
	let codeComponent = $derived(selectedSlot?.components.find((component) => component.type === 'codeBlock'));
	let currentCode = $derived(codeComponent?.type === 'codeBlock' ? codeComponent.code : '');
	let diagnostics = $derived(codeComponent?.type === 'codeBlock' ? lintCode(codeComponent.code) : []);
	let stats = $derived(treeStats(tree));
	let treeRows = $derived(flattenTree(tree));
	let visibleItems = $derived(items.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase())));
	let breadcrumb = $derived(currentFolderId ? [folderCache.get(currentFolderId)?.name ?? 'Folder'] : ['All assets']);

	onMount(async () => {
		try {
			userLabel = 'Guest workspace';
			const session = await authClient.getSession();
			context.userId = session.data?.user.id ?? null;
			userLabel = session.data?.user.name ? `${session.data.user.name}'s workspace` : context.userId ? 'Cloud workspace' : 'Guest workspace';
		} catch {
			context.userId = null;
		}
		adapters = availableInventoryFolders(context);
		if (!adapters.some((entry) => entry.id === activeAdapterId)) activeAdapterId = adapters[0]?.id ?? 'local';
		await refreshLibrary();
		isLoading = false;
	});

	async function refreshLibrary() {
		adapter = getInventoryAdapter(activeAdapterId) ?? null;
		if (!adapter) return;
		isLoading = true;
		try {
			folders = await adapter.listFolders(context, currentFolderId);
			for (const folder of folders) folderCache.set(folder.id, folder);
			items = await adapter.listItems(context, currentFolderId);
			statusMessage = `${adapter.label} library synced`;
		} catch (error) {
			statusMessage = error instanceof Error ? error.message : 'Could not load library';
			folders = [];
			items = [];
		} finally {
			isLoading = false;
		}
	}

	async function switchAdapter(id: string) {
		activeAdapterId = id;
		currentFolderId = null;
		folderCache = new Map();
		selectedItem = null;
		await refreshLibrary();
	}

	async function openFolder(folder: InventoryFolder) {
		folderCache.set(folder.id, folder);
		currentFolderId = folder.id;
		await refreshLibrary();
	}

	async function goToRoot() {
		currentFolderId = null;
		await refreshLibrary();
	}

	async function createFolder() {
		if (!adapter) return;
		const name = window.prompt('Folder name', 'New folder')?.trim();
		if (!name) return;
		try {
			const folder = await adapter.createFolder(context, currentFolderId, name);
			folderCache.set(folder.id, folder);
			await refreshLibrary();
		} catch (error) {
			statusMessage = error instanceof Error ? error.message : 'Could not create folder';
		}
	}

	function startNewAsset() {
		selectedItem = null;
		draftName = 'Untitled asset';
		tree = starterTree(draftName);
		selectedSlotId = tree[0]?.id ?? null;
		selectedComponentIndex = 0;
		isDirty = true;
		activeView = 'scene';
		statusMessage = 'New asset ready';
	}

	function openAsset(item: InventoryItem) {
		selectedItem = item;
		draftName = item.name;
		tree = cloneTree(item.slotData);
		selectedSlotId = tree[0]?.id ?? null;
		selectedComponentIndex = 0;
		isDirty = false;
		activeView = 'scene';
		statusMessage = `${item.name} loaded`;
	}

	async function saveAsset() {
		if (!adapter || !draftName.trim()) return;
		isSaving = true;
		try {
			const saved = selectedItem && adapter.updateItem
				? await adapter.updateItem(context, selectedItem.id, currentFolderId, draftName.trim(), cloneTree(tree))
				: await adapter.saveItem(context, currentFolderId, draftName.trim(), cloneTree(tree));
			selectedItem = saved;
			draftName = saved.name;
			isDirty = false;
			await refreshLibrary();
			statusMessage = `${saved.name} saved`;
		} catch (error) {
			statusMessage = error instanceof Error ? error.message : 'Could not save asset';
		} finally {
			isSaving = false;
		}
	}

	async function deleteSelectedAsset() {
		if (!adapter || !selectedItem || !window.confirm(`Delete “${selectedItem.name}”?`)) return;
		try {
			await adapter.deleteItem(context, selectedItem.id);
			selectedItem = null;
			startNewAsset();
			await refreshLibrary();
			statusMessage = 'Asset deleted';
		} catch (error) {
			statusMessage = error instanceof Error ? error.message : 'Could not delete asset';
		}
	}

	function selectSlot(slot: Slot) {
		selectedSlotId = slot.id;
		selectedComponentIndex = 0;
		activeView = 'scene';
	}

	function selectSlotById(slotId: string) {
		const slot = tree.find((candidate) => candidate.id === slotId);
		if (slot) selectSlot(slot);
	}

	function updateSlot(patch: Partial<Slot>) {
		if (!selectedSlotId) return;
		tree = tree.map((slot) => (slot.id === selectedSlotId ? { ...slot, ...patch } : slot));
		isDirty = true;
	}

	function updateVector(field: 'position' | 'rotation' | 'scale', axis: number, value: string) {
		if (!selectedSlot) return;
		const next = [...selectedSlot[field]] as Vec3;
		next[axis] = Number(value) || 0;
		updateSlot({ [field]: next });
	}

	function updateComponentField(index: number, field: string, value: unknown) {
		if (!selectedSlot) return;
		const components = selectedSlot.components.map((component, componentIndex) =>
			componentIndex === index ? ({ ...component, [field]: value } as Component) : component
		);
		tree = tree.map((slot) => (slot.id === selectedSlot.id ? { ...slot, components } : slot));
		isDirty = true;
	}

	function addSlot(kind: 'mesh' | 'empty') {
		const parentId = selectedSlotId;
		const next = {
			id: crypto.randomUUID(),
			parentId,
			name: kind === 'mesh' ? 'New object' : 'Logic node',
			position: [0, 0.35, 0] as Vec3,
			rotation: [0, 0, 0, 1] as Slot['rotation'],
			scale: [1, 1, 1] as Vec3,
			components: (kind === 'mesh' ? [{ type: 'meshRenderer', meshRef: 'sphere', color: '#4fd1c5' }, { type: 'grabbable', scalable: true }] : [{ type: 'codeBlock', code: '' }]) as Component[]
		};
		tree = [...tree, next];
		selectedSlotId = next.id;
		selectedComponentIndex = 0;
		showAddMenu = false;
		isDirty = true;
	}

	function deleteSelectedSlot() {
		if (!selectedSlotId || tree.length <= 1) return;
		const ids = new Set([selectedSlotId]);
		let changed = true;
		while (changed) {
			changed = false;
			for (const slot of tree) if (slot.parentId && ids.has(slot.parentId) && !ids.has(slot.id)) { ids.add(slot.id); changed = true; }
		}
		tree = tree.filter((slot) => !ids.has(slot.id));
		selectedSlotId = tree[0]?.id ?? null;
		selectedComponentIndex = 0;
		isDirty = true;
	}

	function addComponent(definition: (typeof COMPONENT_DEFINITIONS)[number]) {
		if (!selectedSlot) return;
		const next = [...selectedSlot.components, definition.create()];
		tree = tree.map((slot) => (slot.id === selectedSlot.id ? { ...slot, components: next } : slot));
		selectedComponentIndex = next.length - 1;
		showComponentMenu = false;
		isDirty = true;
	}

	function removeComponent(index: number) {
		if (!selectedSlot) return;
		const components = selectedSlot.components.filter((_, componentIndex) => componentIndex !== index);
		tree = tree.map((slot) => (slot.id === selectedSlot.id ? { ...slot, components } : slot));
		selectedComponentIndex = Math.max(0, Math.min(selectedComponentIndex, components.length - 1));
		isDirty = true;
	}

	function updateCodeFromMonaco(value: string) {
		const index = selectedSlot?.components.findIndex((component) => component.type === 'codeBlock') ?? -1;
		if (index >= 0) updateComponentField(index, 'code', value);
	}

	// Raw JSON editor: lets a whole exported subtree (root + every
	// descendant, the exact shape `extractSubtree`/`SceneGraph.serialize()`
	// produce in-game) be pasted in as one asset, not just a single slot's
	// fields — the paste target explicitly asked for.
	function openRawEditor() {
		rawJsonDraft = serializeSlotTree(tree);
		rawJsonError = '';
		activeView = 'raw';
	}

	function applyRawJson() {
		const result = parseSlotTreeJSON(rawJsonDraft);
		if ('error' in result) {
			rawJsonError = result.error;
			return;
		}
		tree = result.tree;
		selectedSlotId = tree.find((slot) => slot.parentId === null)?.id ?? tree[0]?.id ?? null;
		selectedComponentIndex = 0;
		rawJsonError = '';
		isDirty = true;
		statusMessage = `Raw JSON applied — ${tree.length} slot${tree.length === 1 ? '' : 's'}`;
	}

	function parseField(value: string, original: unknown): unknown {
		if (typeof original === 'number') return Number(value) || 0;
		if (typeof original === 'boolean') return value === 'true';
		if (Array.isArray(original) || typeof original === 'object') {
			try { return JSON.parse(value); } catch { return original; }
		}
		return value;
	}

	function meshColor(slot: Slot): string {
		const mesh = slot.components.find((component) => component.type === 'meshRenderer');
		return mesh?.type === 'meshRenderer' ? mesh.color ?? '#8b7cf6' : '#8b7cf6';
	}
</script>

<svelte:head>
	<title>Studio · WebXR Platform</title>
	<meta name="description" content="Desktop authoring studio for WebXR assets, scene graphs and code blocks." />
</svelte:head>

<div class="studio-shell">
	<header class="studio-topbar">
		<div class="brand-lockup">
			<div class="brand-mark">✦</div>
			<div>
				<div class="brand-name">WebXR <span>Studio</span></div>
				<div class="brand-context">{userLabel}</div>
			</div>
		</div>
		<div class="topbar-center">
			<div class="workspace-pill"><span class="status-dot"></span>{statusMessage}</div>
			<span class="keyboard-hint">⌘ K</span>
		</div>
		<div class="topbar-actions">
			<button class="ghost-button" onclick={() => (activeView = 'assets')}>Library</button>
			<button class="ghost-button" onclick={() => (activeView = 'scene')}>Preview</button>
			<button class="save-button" class:has-changes={isDirty} disabled={isSaving || !draftName.trim()} onclick={saveAsset}>
				<span>{isSaving ? 'Saving…' : 'Save asset'}</span><span class="save-shortcut">⌘ S</span>
			</button>
		</div>
	</header>

	<div class="studio-layout">
		<aside class="studio-rail">
			<button class:active={activeView === 'assets'} onclick={() => (activeView = 'assets')} aria-label="Assets"><span class="rail-icon">▦</span><span>Assets</span></button>
			<button class:active={activeView === 'scene'} onclick={() => (activeView = 'scene')} aria-label="Scene"><span class="rail-icon">◇</span><span>Scene</span></button>
			<button class:active={activeView === 'code'} onclick={() => (activeView = 'code')} aria-label="Code"><span class="rail-icon">&lt;/&gt;</span><span>Code</span></button>
			<button class:active={activeView === 'raw'} onclick={openRawEditor} aria-label="Raw JSON"><span class="rail-icon">{'{ }'}</span><span>Raw</span></button>
			<div class="rail-spacer"></div>
			<a class="rail-link" href="/" aria-label="Open runtime"><span class="rail-icon">↗</span><span>Runtime</span></a>
		</aside>

		<aside class="asset-sidebar">
			<div class="sidebar-heading">
				<div><div class="eyebrow">Project library</div><h1>Inventory</h1></div>
				<button class="icon-button" onclick={startNewAsset} aria-label="Create asset">＋</button>
			</div>
			<div class="source-tabs">
				{#each adapters as source}
					<button class:active={source.id === activeAdapterId} onclick={() => switchAdapter(source.id)}>{source.label}</button>
				{/each}
			</div>
			<label class="search-box"><span>⌕</span><input bind:value={searchQuery} placeholder="Search assets" /><span class="search-key">/</span></label>
			<div class="folder-toolbar"><span class="section-label">Folders</span><button class="text-button" onclick={createFolder}>New folder</button></div>
			<div class="folder-list">
				<button class:active={currentFolderId === null} onclick={goToRoot}><span>⌁</span><span>All assets</span><small>{currentFolderId === null ? items.length : ''}</small></button>
				{#each folders as folder}
					<button class:active={currentFolderId === folder.id} onclick={() => openFolder(folder)}><span>▱</span><span>{folder.name}</span></button>
				{/each}
			</div>
			<div class="library-heading"><span class="section-label">Assets</span><span class="muted-count">{visibleItems.length}</span></div>
			<div class="asset-list">
				{#if isLoading}
					<div class="loading-state"><span class="spinner"></span>Loading library</div>
				{:else if visibleItems.length === 0}
					<div class="empty-library"><div class="empty-glyph">◇</div><strong>No assets here yet</strong><span>Create a reusable object to start building.</span><button class="small-primary" onclick={startNewAsset}>Create asset</button></div>
				{:else}
					{#each visibleItems as item}
						<button class="asset-row" class:selected={selectedItem?.id === item.id} onclick={() => openAsset(item)}>
							<div class="asset-thumb" style={`--asset-color: ${meshColor(item.slotData[0] ?? tree[0])}`}>◇</div>
							<div class="asset-meta"><strong>{item.name}</strong><span>{item.slotData.length} {item.slotData.length === 1 ? 'slot' : 'slots'} · {new Date(item.createdAt).toLocaleDateString()}</span></div>
							<span class="row-arrow">›</span>
						</button>
					{/each}
				{/if}
			</div>
		</aside>

		<main class="studio-main">
			<div class="main-toolbar">
				<div class="breadcrumbs"><button onclick={goToRoot}>Inventory</button><span>/</span>{#each breadcrumb as part, index}<span class:last={index === breadcrumb.length - 1}>{part}</span>{/each}</div>
			<div class="view-switcher">
				<button class:active={activeView === 'scene'} onclick={() => (activeView = 'scene')}>Scene</button>
				<button class:active={activeView === 'code'} onclick={() => (activeView = 'code')}>Code {#if diagnostics.length}<span class="issue-badge">{diagnostics.length}</span>{/if}</button>
				<button class:active={activeView === 'raw'} onclick={openRawEditor}>Raw</button>
			</div>
			<div class="main-toolbar-actions"><button class="ghost-button" onclick={startNewAsset}>New</button><button class="danger-button" disabled={!selectedItem} onclick={deleteSelectedAsset}>Delete</button></div>
			</div>

			{#if activeView === 'code'}
				<section class="code-workspace">
					<div class="code-header"><div><div class="eyebrow">Code block editor</div><h2>{selectedSlot?.name ?? 'Select a slot'}</h2></div><div class="code-header-meta"><button class="small-ghost" disabled={!formatCodeBlock} onclick={() => formatCodeBlock?.()}>Format</button><span class="language-chip">JavaScript</span><span class:clean={diagnostics.length === 0} class="diagnostic-summary">{diagnostics.length === 0 ? 'No issues' : `${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}`}</span></div></div>
					{#if codeComponent?.type === 'codeBlock'}
						<div class="editor-shell monaco-shell">
							<CodeEditor value={currentCode} onChange={updateCodeFromMonaco} onFormatReady={(format) => (formatCodeBlock = format)} />
						</div>
						<div class="editor-footer"><span>Runs in the bounded <code>ctx</code> runtime</span><span>Tab size 2 · UTF-8</span></div>
						<div class="diagnostics-panel"><div class="panel-title"><span>Diagnostics</span><span>{diagnostics.length}</span></div>{#if diagnostics.length === 0}<div class="diagnostic-row clean-row"><span>✓</span><span>Everything looks good.</span></div>{:else}{#each diagnostics as diagnostic}<div class="diagnostic-row"><span class={`severity-${diagnostic.severity}`}>{diagnostic.severity === 'error' ? '×' : diagnostic.severity === 'warning' ? '!' : 'i'}</span><span>{diagnostic.message}</span><small>Line {diagnostic.line}</small></div>{/each}{/if}</div>
					{:else}
						<div class="code-empty"><div class="empty-glyph">&lt;/&gt;</div><h3>Select a code block</h3><p>Select a slot with a Code Block component, or add one from the inspector.</p><button class="small-primary" onclick={() => (showComponentMenu = true)}>Add code block</button></div>
					{/if}
				</section>
			{:else if activeView === 'raw'}
				<section class="code-workspace">
					<div class="code-header">
						<div><div class="eyebrow">Raw asset JSON</div><h2>{draftName}</h2></div>
						<div class="code-header-meta">
							<button class="small-ghost" onclick={openRawEditor}>Reload from asset</button>
							<span class="language-chip">JSON</span>
						</div>
					</div>
					<div class="editor-shell">
						<textarea
							class="code-editor raw-json-editor"
							spellcheck="false"
							bind:value={rawJsonDraft}
						></textarea>
					</div>
					<div class="editor-footer">
						<span>Paste a single slot or a whole exported subtree (an array) — a root plus its descendants, linked by parentId — then Apply.</span>
						<span>JSON</span>
					</div>
					{#if rawJsonError}
						<div class="diagnostics-panel">
							<div class="diagnostic-row"><span class="severity-error">×</span><span>{rawJsonError}</span></div>
						</div>
					{/if}
					<div class="main-toolbar-actions" style="padding: 0 22px 18px;">
						<button class="small-primary" onclick={applyRawJson}>Apply JSON</button>
					</div>
				</section>
			{:else}
				<section class="scene-workspace">
					<div class="canvas-toolbar"><div><div class="eyebrow">Asset canvas</div><h2>{draftName}</h2></div><div class="canvas-actions"><span class="zoom-label">Drag to rotate · scroll to zoom · right-drag to pan</span></div></div>
					<div class="preview-canvas">
						<ScenePreview {tree} selectedId={selectedSlotId} onSelect={selectSlotById} />
						{#if tree.length === 0}<div class="empty-canvas">Add a slot to begin.</div>{/if}
					</div>
					<div class="scene-lower">
						<div class="scene-lower-header"><div><div class="eyebrow">Scene graph</div><strong>{stats.slots} slots · {stats.components} components</strong></div><div class="scene-actions"><button class="small-ghost" onclick={() => (showAddMenu = !showAddMenu)}>＋ Add slot</button>{#if showAddMenu}<div class="popover add-popover"><button onclick={() => addSlot('mesh')}>◇ Mesh object</button><button onclick={() => addSlot('empty')}>&#123;&#125; Logic node</button></div>{/if}</div></div>
						<div class="scene-tree">{#each treeRows as row}<button class:tree-selected={selectedSlotId === row.slot.id} class="tree-row" style={`--depth: ${row.depth}`} onclick={() => selectSlot(row.slot)}><span class="tree-chevron">{row.depth > 0 ? '└' : '⌄'}</span><span class="tree-glyph">{row.slot.components[0] ? componentGlyph(row.slot.components[0].type) : '◌'}</span><span>{row.slot.name}</span><span class="tree-components">{row.slot.components.length}</span></button>{/each}</div>
					</div>
				</section>
			{/if}
		</main>

		<aside class="inspector-panel">
			<div class="inspector-heading"><div><div class="eyebrow">Inspector</div><h2>{selectedSlot?.name ?? 'Nothing selected'}</h2></div><button class="icon-button subtle" disabled={!selectedSlot} onclick={deleteSelectedSlot} aria-label="Delete selected slot">⌫</button></div>
			{#if selectedSlot}
				<div class="inspector-scroll">
					<label class="field-label">Name<input class="text-input" value={selectedSlot.name} oninput={(event) => updateSlot({ name: (event.currentTarget as HTMLInputElement).value })} /></label>
					<div class="inspector-section"><div class="section-header"><span>Transform</span><span class="component-count">Local</span></div>{#each ['position', 'rotation', 'scale'] as transform}<div class="vector-row"><span>{transform === 'position' ? 'Position' : transform === 'rotation' ? 'Rotation' : 'Scale'}</span><div class="vector-inputs">{#each selectedSlot[transform as 'position' | 'rotation' | 'scale'] as value, axis}<label><i class={`axis axis-${axis}`}>{['X', 'Y', 'Z'][axis]}</i><input type="number" step="0.1" value={value} oninput={(event) => updateVector(transform as 'position' | 'rotation' | 'scale', axis, (event.currentTarget as HTMLInputElement).value)} /></label>{/each}</div></div>{/each}</div>
					<div class="inspector-section components-section"><div class="section-header"><span>Components</span><div class="component-actions"><span class="component-count">{selectedSlot.components.length}</span><button class="mini-add" onclick={() => (showComponentMenu = !showComponentMenu)}>＋</button>{#if showComponentMenu}<div class="popover component-popover">{#each ['Render', 'Interaction', 'Logic', 'Media', 'World'] as group}<div class="popover-group"><small>{group}</small>{#each COMPONENT_DEFINITIONS.filter((definition) => definition.group === group) as definition}<button onclick={() => addComponent(definition)}><span>{componentGlyph(definition.type)}</span><span><strong>{definition.label}</strong><small>{definition.description}</small></span></button>{/each}</div>{/each}</div>{/if}</div></div>
						{#if selectedSlot.components.length === 0}<div class="no-components">This slot is empty. Add a component to give it behaviour.</div>{/if}
						{#each selectedSlot.components as component, index}
							<div class="component-card" class:component-selected={selectedComponentIndex === index}>
								<button class="component-card-header" onclick={() => { selectedComponentIndex = index; if (component.type === 'codeBlock') activeView = 'code'; }}><span class="component-symbol">{componentGlyph(component.type)}</span><span><strong>{componentDefinition(component.type).label}</strong><small>{componentDefinition(component.type).group}</small></span><span class="component-chevron">{selectedComponentIndex === index ? '⌃' : '⌄'}</span></button>
								{#if selectedComponentIndex === index}
									<div class="component-fields">
										{#each componentFieldEntries(component) as [field, value]}
											<label class="field-label compact"><span>{field}</span>{#if typeof value === 'boolean'}<button class="toggle" class:on={value} aria-label={`Toggle ${field}`} onclick={() => updateComponentField(index, field, !value)}><span></span></button>{:else if Array.isArray(value) || typeof value === 'object'}<textarea class="json-input" rows="2" value={JSON.stringify(value)} oninput={(event) => updateComponentField(index, field, parseField((event.currentTarget as HTMLTextAreaElement).value, value))}></textarea>{:else}<input class="text-input" type={typeof value === 'number' ? 'number' : 'text'} value={String(value ?? '')} oninput={(event) => updateComponentField(index, field, parseField((event.currentTarget as HTMLInputElement).value, value))} />{/if}</label>
										{/each}
										{#if component.type === 'codeBlock'}<button class="open-code-button" onclick={() => (activeView = 'code')}>Open in code editor <span>→</span></button>{/if}
										<button class="remove-component" onclick={() => removeComponent(index)}>Remove component</button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{:else}
				<div class="inspector-empty"><div class="empty-glyph">⌘</div><strong>Select an object</strong><span>Choose a slot in the scene graph to inspect its transform and components.</span></div>
			{/if}
		</aside>
	</div>
</div>
