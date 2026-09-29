<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate, goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { validateWorldScene } from '$lib/worlds/package';
	import { StudioProject, type SaveTarget } from '$lib/studio/state/project.svelte';
	import { studioSession } from '$lib/studio/state/session.svelte';
	import { dialogs } from '$lib/studio/state/dialogs.svelte';
	import { toasts } from '$lib/studio/state/toasts.svelte';
	import { canRemoveSlot } from '$lib/studio/tree/ops';
	import ScenePreview from '$lib/studio/ScenePreview.svelte';
	import TopBar from '$lib/studio/components/TopBar.svelte';
	import Hierarchy from '$lib/studio/components/Hierarchy.svelte';
	import Inspector from '$lib/studio/components/Inspector.svelte';
	import AssetsPanel from '$lib/studio/components/AssetsPanel.svelte';
	import AddObjectMenu, { type ObjectPreset } from '$lib/studio/components/AddObjectMenu.svelte';
	import SaveDialog from '$lib/studio/components/SaveDialog.svelte';
	import PublishDialog from '$lib/studio/components/PublishDialog.svelte';
	import CommandPalette, { type Command } from '$lib/studio/components/CommandPalette.svelte';
	import CodeView from '$lib/studio/views/CodeView.svelte';
	import JsonView from '$lib/studio/views/JsonView.svelte';
	import Icon from '$lib/studio/ui/Icon.svelte';

	const project = new StudioProject(studioSession.context);
	const doc = project.doc;

	let advanced = $state(false);
	let centerView = $state<'scene' | 'code' | 'json'>('scene');
	let leftTab = $state<'hierarchy' | 'assets'>('hierarchy');
	let mobilePanel = $state<'left' | 'center' | 'right'>('center');
	let dialog = $state<'save' | 'publish' | 'palette' | null>(null);
	let showAddObject = $state(false);
	let preview = $state<ScenePreview>();
	let bypassGuard = false;

	onMount(() => {
		try {
			advanced = localStorage.getItem('studio:advanced') === '1';
		} catch {
			// Preference is optional.
		}
		void (async () => {
			await studioSession.init();
			await project.open(page.url.searchParams);
		})();
	});

	function setAdvanced(value: boolean) {
		advanced = value;
		if (!value) centerView = 'scene';
		try {
			localStorage.setItem('studio:advanced', value ? '1' : '0');
		} catch {
			// Preference is optional.
		}
	}

	function openCode() {
		setAdvanced(true);
		centerView = 'code';
		mobilePanel = 'center';
	}

	// Keep a local draft while there are unsaved edits, so a crash or reload loses nothing.
	$effect(() => {
		void doc.tree;
		void doc.name;
		if (project.status !== 'ready' || !doc.dirty) return;
		const timer = setTimeout(() => void project.writeDraft(), 1000);
		return () => clearTimeout(timer);
	});

	beforeNavigate((navigation) => {
		if (bypassGuard || !doc.dirty || !navigation.to) return;
		navigation.cancel();
		if (navigation.willUnload) return; // the browser shows its own prompt via beforeunload
		const target = navigation.to.url;
		void (async () => {
			const choice = await dialogs.choose({
				title: 'Leave with unsaved changes?',
				message: 'Your edits are kept as a draft on this device, so you can pick up where you left off.',
				choices: [
					{ id: 'leave', label: 'Leave' },
					{ id: 'save', label: 'Save and leave' }
				]
			});
			if (!choice) return;
			if (choice === 'save' && !(await save())) return;
			bypassGuard = true;
			await goto(target);
		})();
	});

	function onBeforeUnload(event: BeforeUnloadEvent) {
		if (doc.dirty) event.preventDefault();
	}

	async function save(): Promise<boolean> {
		if (!project.isSaved) {
			dialog = 'save';
			return false;
		}
		return persist();
	}

	async function persist(target?: SaveTarget): Promise<boolean> {
		try {
			const saved = await project.save(target);
			toasts.success(`Saved “${saved.name}”`);
			dialog = null;
			syncUrl();
			return true;
		} catch (error) {
			toasts.error(error, 'Could not save');
			return false;
		}
	}

	function syncUrl() {
		if (!project.item || !project.adapterId) return;
		const params = new URLSearchParams({ source: project.adapterId, folder: project.folderId ?? 'root', item: project.item.id });
		replaceState(`${resolve('/studio/edit')}?${params}`, {});
	}

	function back() {
		void goto(resolve('/studio'));
	}

	function addObject(preset: ObjectPreset) {
		showAddObject = false;
		doc.addSlot({ name: preset.name, position: preset.position, components: structuredClone(preset.components) });
		if (preset.id === 'logic') doc.addComponent(doc.selectedId!, 'codeBlock');
	}

	function removeSelected() {
		const name = doc.selected?.name;
		if (doc.removeSelected()) toasts.info(`Deleted “${name}”. Press Ctrl+Z to undo.`);
		else toasts.info('A project needs at least one object.');
	}

	function play() {
		try {
			const scene = JSON.parse(JSON.stringify(doc.tree));
			validateWorldScene(scene);
			const key = crypto.randomUUID();
			localStorage.setItem(`studio:play:${key}`, JSON.stringify({ name: doc.name, scene }));
			window.open(`${resolve('/')}?studioPlay=${key}`, '_blank');
		} catch (error) {
			toasts.error(error, 'This scene cannot be played yet');
		}
	}

	function onPublished(result: { revision: number; name: string }) {
		dialog = null;
		toasts.success(`Published “${result.name}” as revision ${result.revision}`);
	}

	const commands = $derived<Command[]>([
		{ id: 'save', label: 'Save', shortcut: 'Ctrl+S', run: () => void save() },
		{ id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z', enabled: doc.canUndo, run: () => doc.undo() },
		{ id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', enabled: doc.canRedo, run: () => doc.redo() },
		{ id: 'add', label: 'Add object…', run: () => { leftTab = 'hierarchy'; mobilePanel = 'left'; showAddObject = true; } },
		{ id: 'duplicate', label: 'Duplicate selected object', shortcut: 'Ctrl+D', enabled: Boolean(doc.selectedId), run: () => doc.duplicateSelected() },
		{ id: 'delete', label: 'Delete selected object', shortcut: 'Del', enabled: Boolean(doc.selectedId && canRemoveSlot(doc.tree, doc.selectedId)), run: removeSelected },
		{ id: 'focus', label: 'Focus camera on selection', shortcut: 'F', enabled: Boolean(doc.selectedId), run: () => preview?.focusSelected() },
		{ id: 'play', label: 'Play in the game', run: play },
		{ id: 'publish', label: 'Publish world…', enabled: doc.kind === 'world', run: () => (dialog = 'publish') },
		{ id: 'mode', label: advanced ? 'Switch to Simple mode' : 'Switch to Advanced mode', run: () => setAdvanced(!advanced) },
		{ id: 'assets', label: 'Show asset library', run: () => { leftTab = 'assets'; mobilePanel = 'left'; } },
		{ id: 'projects', label: 'Back to projects', run: back }
	]);

	function isTyping(target: EventTarget | null): boolean {
		const element = target as HTMLElement | null;
		return Boolean(element?.closest('input, textarea, select, [contenteditable="true"], .monaco-editor'));
	}

	function onKeydown(event: KeyboardEvent) {
		if (dialog || dialogs.current) return;
		const mod = event.ctrlKey || event.metaKey;
		const key = event.key.toLowerCase();
		if (mod && key === 's') {
			event.preventDefault();
			void save();
		} else if (mod && key === 'k') {
			event.preventDefault();
			dialog = 'palette';
		} else if (isTyping(event.target)) return;
		else if (mod && key === 'z') {
			event.preventDefault();
			if (event.shiftKey) doc.redo();
			else doc.undo();
		} else if (mod && key === 'y') {
			event.preventDefault();
			doc.redo();
		} else if (mod && key === 'd') {
			event.preventDefault();
			doc.duplicateSelected();
		} else if (!mod && (event.key === 'Delete' || event.key === 'Backspace') && doc.selectedId) {
			event.preventDefault();
			removeSelected();
		} else if (!mod && key === 'f') preview?.focusSelected();
		else if (!mod && event.key === '/') {
			event.preventDefault();
			leftTab = 'hierarchy';
			mobilePanel = 'left';
			document.querySelector<HTMLInputElement>('.hierarchy .filter input')?.focus();
		}
	}

	function timeLabel(ms: number): string {
		return new Date(ms).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
	}
</script>

<svelte:head><title>{doc.name || 'Untitled'} · Studio</title></svelte:head>
<svelte:window onkeydown={onKeydown} onbeforeunload={onBeforeUnload} />

{#if project.status === 'loading'}
	<div class="center-state"><span class="muted">Opening project…</span></div>
{:else if project.status === 'error'}
	<div class="center-state">
		<div class="empty" role="alert">
			<Icon name="warning" size={24} />
			<strong>Could not open this project</strong>
			{project.error}
			<button class="btn primary" onclick={back}>Back to projects</button>
		</div>
	</div>
{:else}
	<div class="editor" data-panel={mobilePanel}>
		<TopBar {project} {advanced} onmode={setAdvanced} onback={back} onsave={() => void save()} onpublish={() => (dialog = 'publish')} onplay={play} onpalette={() => (dialog = 'palette')} />

		{#if project.pendingDraft}
			<div class="banner" role="status">
				<Icon name="warning" size={14} />
				<span>There are unsaved changes from {timeLabel(project.pendingDraft.savedAt)} on this device.</span>
				<button class="btn sm" onclick={() => project.restoreDraft()}>Restore</button>
				<button class="btn ghost sm" onclick={() => void project.discardDraft()}>Discard</button>
			</div>
		{/if}

		<div class="panels">
			<section class="left" aria-label="Objects and assets">
				<div class="tabs" role="tablist">
					<button class="tab" role="tab" aria-selected={leftTab === 'hierarchy'} onclick={() => (leftTab = 'hierarchy')}><Icon name="layers" size={14} />Objects</button>
					<button class="tab" role="tab" aria-selected={leftTab === 'assets'} onclick={() => (leftTab = 'assets')}><Icon name="cube" size={14} />Library</button>
				</div>
				<div class="left-body">
					{#if leftTab === 'hierarchy'}
						<Hierarchy {doc} onAdd={() => (showAddObject = !showAddObject)} onDelete={removeSelected} />
						{#if showAddObject}<AddObjectMenu {advanced} onclose={() => (showAddObject = false)} onpick={addObject} />{/if}
					{:else}
						<AssetsPanel {doc} />
					{/if}
				</div>
			</section>

			<section class="center" aria-label="Scene">
				{#if advanced}
					<div class="tabs view-tabs" role="tablist">
						<button class="tab" role="tab" aria-selected={centerView === 'scene'} onclick={() => (centerView = 'scene')}><Icon name="cube" size={14} />Scene</button>
						<button class="tab" role="tab" aria-selected={centerView === 'code'} onclick={() => (centerView = 'code')}><Icon name="code" size={14} />Code</button>
						<button class="tab" role="tab" aria-selected={centerView === 'json'} onclick={() => (centerView = 'json')}><Icon name="json" size={14} />JSON</button>
					</div>
				{/if}
				<!-- The 3D view stays mounted so switching tabs doesn't rebuild the scene. -->
				<div class="view" hidden={centerView !== 'scene'}>
					<ScenePreview bind:this={preview} tree={doc.tree} selectedId={doc.selectedId} onSelect={(id) => doc.select(id)} />
					<p class="hint">Drag to orbit · Scroll to zoom · Right-drag to pan · <span class="kbd">F</span> to focus</p>
				</div>
				{#if centerView === 'code'}<div class="view"><CodeView {doc} /></div>{/if}
				{#if centerView === 'json'}<div class="view"><JsonView {doc} /></div>{/if}
			</section>

			<section class="right" aria-label="Properties">
				<Inspector {doc} {advanced} onOpenCode={openCode} />
			</section>
		</div>

		<nav class="mobile-nav" aria-label="Panels">
			<button aria-current={mobilePanel === 'left'} onclick={() => (mobilePanel = 'left')}><Icon name="layers" />Objects</button>
			<button aria-current={mobilePanel === 'center'} onclick={() => (mobilePanel = 'center')}><Icon name="cube" />View</button>
			<button aria-current={mobilePanel === 'right'} onclick={() => (mobilePanel = 'right')}><Icon name="sliders" />Properties</button>
		</nav>
	</div>

	{#if dialog === 'save'}
		<SaveDialog defaultName={doc.name} kind={doc.kind} adapters={studioSession.adapters} signedIn={Boolean(studioSession.userId)} onsave={(target) => void persist(target)} onclose={() => (dialog = null)} />
	{:else if dialog === 'publish'}
		<PublishDialog {project} onclose={() => (dialog = null)} ondone={onPublished} />
	{:else if dialog === 'palette'}
		<CommandPalette {commands} onclose={() => (dialog = null)} />
	{/if}
{/if}

<style>
	.center-state { display: grid; place-items: center; min-height: 100dvh; }
	.editor { display: flex; flex-direction: column; height: 100dvh; overflow: hidden; }
	.banner { display: flex; align-items: center; gap: 10px; padding: 6px 12px; border-bottom: 1px solid var(--border); background: rgb(240 180 76 / 0.1); color: var(--warning); font-size: 12px; }
	.banner span { flex: 1; }
	.panels { display: grid; grid-template-columns: 260px minmax(0, 1fr) 340px; flex: 1; min-height: 0; }
	.left, .right { min-height: 0; min-width: 0; background: var(--panel); }
	.left { display: flex; flex-direction: column; border-right: 1px solid var(--border); }
	.right { border-left: 1px solid var(--border); overflow: hidden; }
	.left .tabs { margin: 8px 8px 0; }
	.left-body { position: relative; flex: 1; min-height: 0; }
	.center { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
	.view-tabs { margin: 8px 12px 0; align-self: flex-start; }
	.view { position: relative; flex: 1; min-height: 0; }
	.view[hidden] { display: none; }
	.hint { position: absolute; left: 12px; bottom: 10px; margin: 0; padding: 4px 10px; border-radius: 12px; background: rgb(14 16 22 / 0.75); color: var(--muted); font-size: 11px; pointer-events: none; }
	.mobile-nav { display: none; }

	@media (max-width: 1100px) { .panels { grid-template-columns: 220px minmax(0, 1fr) 300px; } }
	@media (max-width: 860px) {
		.panels { display: block; position: relative; }
		.left, .center, .right { display: none; position: absolute; inset: 0; border: 0; }
		.editor[data-panel='left'] .left, .editor[data-panel='right'] .right { display: flex; }
		.editor[data-panel='right'] .right { display: block; overflow-y: auto; }
		.editor[data-panel='center'] .center { display: flex; }
		.mobile-nav { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--border); background: var(--panel); }
		.mobile-nav button { display: grid; justify-items: center; gap: 2px; padding: 8px 0; border: 0; background: transparent; color: var(--muted); font: 500 11px var(--font); }
		.mobile-nav button[aria-current='true'] { color: var(--accent); }
	}
</style>
