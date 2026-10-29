<script lang="ts">
	import { assetSource, urlSource, type SourceRef } from '@kithin/engine/assets/ref';
	import { getAssetKind } from '@kithin/engine/assets/kinds/index';
	import { contentSourceFor } from '../content/sources';
	import { formatBytes, studioAssets } from '../state/models.svelte';
	import { studioSession } from '../state/session.svelte';
	import Icon, { type IconName } from '../ui/Icon.svelte';

	interface Props {
		id?: string;
		label: string;
		/** The kind of asset to choose (`audio`, `model`, …). */
		assetType: string;
		source: SourceRef;
		onchange: (next: SourceRef) => void;
	}

	let { id, label, assetType, source, onchange }: Props = $props();

	interface Choice {
		assetId: string;
		name: string;
		meta: string;
		addedAt: number;
	}

	const PAGE = 60;
	const ICONS: Record<string, IconName> = { model: 'cube', audio: 'music', image: 'image' };
	const icon = $derived(ICONS[assetType] ?? 'layers');
	const kindLabel = $derived(getAssetKind(assetType)?.label.toLowerCase() ?? 'files');

	let open = $state(false);
	let query = $state('');
	let storage = $state<'device' | 'cloud'>('device');
	let page = $state(0);
	let cloud = $state<Choice[] | null>(null);
	let cloudError = $state<string | null>(null);

	// The list is read here, not by whoever shows the field: an inspector opened without the library panel would otherwise see nothing.
	$effect(() => {
		if (open && !studioAssets.loaded) void studioAssets.refresh();
	});

	const duration = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
	function describe(manifest: { byteSize: number; duration?: unknown }): string {
		return [typeof manifest.duration === 'number' ? duration(manifest.duration) : null, formatBytes(manifest.byteSize)].filter(Boolean).join(' · ');
	}

	const device = $derived<Choice[]>(
		studioAssets.items.filter((item) => item.type === assetType).map((item) => ({ assetId: item.assetId, name: item.name, meta: describe(item), addedAt: item.importedAt }))
	);

	async function loadCloud() {
		cloudError = null;
		try {
			const entries = (await contentSourceFor('cloud', studioSession.context)?.list()) ?? [];
			cloud = entries
				.filter((entry) => entry.manifest.type === assetType)
				.map((entry) => ({ assetId: entry.assetId, name: entry.manifest.name, meta: describe(entry.manifest), addedAt: entry.addedAt ?? 0 }));
		} catch (error) {
			cloud = [];
			cloudError = error instanceof Error ? error.message : 'Could not read the cloud';
		}
	}

	function chooseStorage(next: 'device' | 'cloud') {
		storage = next;
		page = 0;
		if (next === 'cloud' && cloud === null) void loadCloud();
	}

	const matches = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		const list = (storage === 'device' ? device : cloud ?? []).filter((choice) => !needle || choice.name.toLowerCase().includes(needle));
		return [...list].sort((a, b) => b.addedAt - a.addedAt);
	});
	const pageCount = $derived(Math.max(1, Math.ceil(matches.length / PAGE)));
	// A page that no longer exists (the list got shorter) falls back to the last one.
	const current_page = $derived(Math.min(page, pageCount - 1));
	const shown = $derived(matches.slice(current_page * PAGE, (current_page + 1) * PAGE));

	// What the field shows now: a file from either storage, or a note that it is not here.
	const current = $derived(source.kind === 'asset' ? (device.find((choice) => choice.assetId === source.assetId) ?? cloud?.find((choice) => choice.assetId === source.assetId)) : undefined);
	const currentLabel = $derived(source.kind === 'url' ? 'From a URL' : (current?.name ?? `${source.assetId.slice(7, 15)}… (not on this device)`));

	function pick(choice: Choice) {
		onchange(assetSource(choice.assetId as `sha256:${string}`));
		open = false;
	}

	async function importFile() {
		if (storage === 'cloud' && studioSession.userId) {
			const [first] = await studioAssets.pickAndUpload(assetType);
			if (!first) return;
			void loadCloud();
			onchange(assetSource(first));
			open = false;
			return;
		}
		const [first] = await studioAssets.pickAndImport(assetType);
		if (first) {
			onchange(assetSource(first.assetId));
			open = false;
		}
	}
</script>

<div class="picker">
	<button {id} class="current" aria-expanded={open} aria-label={`${label}: ${currentLabel}`} onclick={() => { open = !open; query = ''; page = 0; }}>
		<Icon name={icon} size={14} /><span class="name">{currentLabel}</span><Icon name="chevron-down" size={12} />
	</button>

	{#if open}
		<div class="panel">
			<input class="input" type="search" placeholder={`Search ${kindLabel}`} aria-label={`Search ${kindLabel}`} bind:value={query} oninput={() => (page = 0)} />
			{#if studioSession.userId}
				<div class="tabs" role="tablist" aria-label="Storage">
					<button class="tab" role="tab" aria-selected={storage === 'device'} onclick={() => chooseStorage('device')}><Icon name="device" size={14} /><span class="name">This device ({device.length})</span></button>
					<button class="tab" role="tab" aria-selected={storage === 'cloud'} onclick={() => chooseStorage('cloud')}><Icon name="cloud" size={14} /><span class="name">Cloud{cloud ? ` (${cloud.length})` : ''}</span></button>
				</div>
			{/if}

			<div class="list" role="listbox" aria-label={label}>
				{#each shown as choice (choice.assetId)}
					<button class="row" role="option" aria-selected={source.kind === 'asset' && source.assetId === choice.assetId} onclick={() => pick(choice)}>
						<span class="name">{choice.name}</span><span class="meta">{choice.meta}</span>
					</button>
				{:else}
					<p class="empty muted">{storage === 'cloud' && cloud === null ? 'Loading…' : cloudError ?? (query ? 'No matches.' : `No ${kindLabel} here yet.`)}</p>
				{/each}
			</div>
			{#if pageCount > 1}
				<nav class="pager" aria-label="Pages">
					<button class="btn sm" disabled={current_page === 0} onclick={() => (page = current_page - 1)}><Icon name="chevron-left" size={12} />Previous</button>
					<span class="muted">Page {current_page + 1} of {pageCount}</span>
					<button class="btn sm" disabled={current_page >= pageCount - 1} onclick={() => (page = current_page + 1)}>Next<Icon name="chevron-right" size={12} /></button>
				</nav>
			{/if}

			<div class="foot">
				<button class="btn sm" onclick={importFile}><Icon name="upload" size={12} />Import a file…</button>
				<button class="btn sm" onclick={() => { onchange(urlSource(source.kind === 'url' ? source.url : '')); open = false; }}><Icon name="code" size={12} />Use a URL</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.picker { display: grid; gap: 6px; min-width: 0; }
	.current { display: flex; align-items: center; gap: 8px; width: 100%; height: var(--control-h, 30px); padding: 0 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font: 13px var(--font); text-align: left; cursor: pointer; }
	.current:hover, .current[data-xr-hover] { border-color: #3a4157; }
	.current .name { flex: 1; }
	.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.panel { display: grid; min-width: 0; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); }
	.panel .tabs { min-width: 0; }
	.panel .tab { flex: 1 1 0; min-width: 0; justify-content: center; white-space: nowrap; }
	.panel .tab :global(svg) { flex: none; }
	.list { display: grid; align-content: start; max-height: calc(var(--row-h, 30px) * 7); overflow-y: auto; }
	.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: var(--row-h, 30px); padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text); font: 13px var(--font); text-align: left; cursor: pointer; }
	.row:hover, .row[data-xr-hover] { background: var(--panel-3); }
	.row[aria-selected='true'] { background: var(--accent-soft); }
	.pager { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	.meta { flex: none; color: var(--muted); font-size: 12px; }
	.empty { margin: 0; padding: 12px 8px; text-align: center; }
	.foot { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
