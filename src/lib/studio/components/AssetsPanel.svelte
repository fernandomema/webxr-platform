<script lang="ts">
	import { studioSession } from '../state/session.svelte';
	import { Library } from '../state/library.svelte';
	import { toasts } from '../state/toasts.svelte';
	import type { StudioDocument } from '../state/document.svelte';
	import { dialogs } from '../state/dialogs.svelte';
	import { formatBytes, studioAssets, studioModels } from '../state/models.svelte';
	import { assetMesh, assetSource } from '$lib/assets/ref';
	import type { AssetListing } from '$lib/assets/store';
	type ModelListing = Extract<AssetListing, { type: 'model' }>;
	type AudioListing = Extract<AssetListing, { type: 'audio' }>;
	import Icon from '../ui/Icon.svelte';
	import { adapterLabel } from '../ui/adapters';

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

	let dragging = $state(false);

	$effect(() => {
		if (!studioModels.loaded) void studioModels.refresh();
	});

	/** The model's real size in metres (largest side), so it lands in the scene at the scale it was authored. */
	function naturalSize(model: ModelListing): number {
		const { min, max } = model.bounds;
		const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
		return Number.isFinite(size) ? Math.min(50, Math.max(0.05, size)) : 1;
	}

	function addModel(model: ModelListing) {
		const size = naturalSize(model);
		doc.addSlot({
			name: model.name,
			position: [0, size / 2, 0],
			scale: [size, size, size],
			components: [{ type: 'meshRenderer', meshRef: assetMesh(model.assetId) }, { type: 'collider', shape: 'box' }]
		});
		toasts.success(`Added “${model.name}”`);
	}

	function addAudio(audio: AudioListing) {
		doc.addSlot({
			name: audio.name,
			position: [0, 1, 0],
			scale: [0.4, 0.4, 0.4],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' } },
				{ type: 'audioPlayer', source: assetSource(audio.assetId), loop: false, volume: 1 }
			]
		});
		toasts.success(`Added “${audio.name}”`);
	}

	function formatDuration(seconds: number): string {
		const total = Math.round(seconds);
		return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
	}

	async function removeModel(model: AssetListing) {
		const ok = await dialogs.confirm({
			title: `Remove “${model.name}” from this device?`,
			message: 'Objects and worlds that use it will show a placeholder until it is imported again.',
			confirmLabel: 'Remove',
			danger: true
		});
		if (ok) await studioAssets.remove(model.assetId);
	}

	async function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		if (event.dataTransfer?.files.length) await studioAssets.importFiles([...event.dataTransfer.files]);
	}

	function insert(id: string) {
		const item = library.items.find((candidate) => candidate.id === id);
		if (!item) return;
		if (doc.insertFragment(item.slotData)) toasts.success(`Added “${item.name}”`);
	}
</script>

<div
	class="assets"
	class:dragging
	role="region"
	aria-label="Library"
	ondragover={(event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragging = true; } }}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
>
	<section class="models" aria-label="Models">
		<div class="models-head">
			<strong>Models</strong>
			<button class="btn sm" disabled={studioModels.importing} onclick={() => studioModels.pickAndImport()}>
				<Icon name="plus" size={12} />{studioModels.importing ? 'Importing…' : 'Import .glb'}
			</button>
		</div>
		{#if studioModels.items.length}
			<ul class="model-list">
				{#each studioModels.items as model (model.assetId)}
					<li class="model-row">
						<button class="row" title={`Add “${model.name}” to the scene`} onclick={() => addModel(model)}>
							<Icon name="cube" size={14} />
							<span>{model.name}</span>
							<small class="muted">{model.triangles.toLocaleString('en-US')} tris · {formatBytes(model.byteSize)}</small>
						</button>
						<button class="icon-btn danger" aria-label={`Remove ${model.name} from this device`} onclick={() => removeModel(model)}><Icon name="trash" size={13} /></button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="hint muted">Drop a .glb file here, or import one. Models are stored on this device.</p>
		{/if}
	</section>
	<section class="models" aria-label="Audio">
		<div class="models-head">
			<strong>Audio</strong>
			<button class="btn sm" disabled={studioAssets.importing} onclick={() => studioAssets.pickAndImport('audio')}>
				<Icon name="plus" size={12} />{studioAssets.importing ? 'Importing…' : 'Import audio'}
			</button>
		</div>
		{#if studioAssets.ofType('audio').length}
			<ul class="model-list">
				{#each studioAssets.ofType('audio') as audio (audio.assetId)}
					<li class="model-row">
						<button class="row" title={`Add “${audio.name}” to the scene`} onclick={() => addAudio(audio)}>
							<Icon name="play" size={14} />
							<span>{audio.name}</span>
							<small class="muted">{formatDuration(audio.duration)} · {formatBytes(audio.byteSize)}</small>
						</button>
						<button class="icon-btn danger" aria-label={`Remove ${audio.name} from this device`} onclick={() => removeModel(audio)}><Icon name="trash" size={13} /></button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="hint muted">Drop an .mp3, .wav or .ogg file here, or import one. Audio is stored on this device.</p>
		{/if}
	</section>
	<div class="toolbar">
		{#if adapters.length > 1}
			<select class="select" aria-label="Library" value={library.adapterId} onchange={(event) => library.switchAdapter(event.currentTarget.value)}>
				{#each adapters as adapter (adapter.id)}<option value={adapter.id}>{adapterLabel(adapter.id, adapter.label)}</option>{/each}
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
	.assets.dragging { outline: 2px dashed var(--accent); outline-offset: -4px; }
	.models { padding: 8px 8px 4px; border-bottom: 1px solid var(--border); }
	.models-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
	.model-list { max-height: 160px; margin: 0; padding: 0; overflow-y: auto; list-style: none; flex: none; }
	.model-row { display: flex; align-items: center; gap: 2px; }
	.model-row .row small { flex: none; font-size: 10px; }
	.hint { margin: 4px 0 6px; font-size: 12px; }
	.toolbar { display: flex; gap: 6px; padding: 8px; }
	.toolbar .select { width: auto; flex: none; }
	.crumbs { display: flex; align-items: center; gap: 6px; padding: 0 8px 4px; }
	ul { flex: 1; margin: 0; padding: 0 4px 8px; overflow-y: auto; list-style: none; }
	.row { display: flex; align-items: center; gap: 8px; width: 100%; height: 30px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
	.row span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.row:hover { background: var(--panel-2); }
	.row :global(svg:last-child) { color: var(--muted); }
</style>
