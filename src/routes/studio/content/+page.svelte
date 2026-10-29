<script lang="ts">
	import { allAssetKinds, getAssetKind } from '@kithin/engine/assets/kinds/index';
	import type { AssetId } from '@kithin/engine/assets/ref';
	import { loadBaseAvatar } from '@kithin/engine/xr/avatar/baseAvatar';
	import { resolve } from '$app/paths';
	import { contentSourceFor } from '$lib/studio/content/sources';
	import { isRemovable, isUnused, totalBytes, type ContentEntry, type ContentUsage } from '$lib/studio/content/entries';
	import { describeFields, formatDate } from '$lib/studio/content/describe';
	import { dialogs } from '$lib/studio/state/dialogs.svelte';
	import { formatBytes, studioAssets } from '$lib/studio/state/models.svelte';
	import { studioSession } from '$lib/studio/state/session.svelte';
	import { toasts } from '$lib/studio/state/toasts.svelte';
	import { adapterIcon, adapterLabel } from '$lib/studio/ui/adapters';
	import Icon, { type IconName } from '$lib/studio/ui/Icon.svelte';
	import ContentPreview from '$lib/studio/components/ContentPreview.svelte';
	import LauncherShell from '$lib/studio/components/LauncherShell.svelte';

	type Sort = 'recent' | 'name' | 'size';

	const KIND_ICON: Record<string, IconName> = { model: 'cube', audio: 'music', image: 'image', lightmap: 'layers', fragment: 'layers' };
	const kindIcon = (type: string): IconName => KIND_ICON[type] ?? 'layers';
	const kindLabel = (type: string): string => getAssetKind(type)?.label ?? type;

	// Only the storages that keep files of their own are listed here; the others (starter kit, marketplace) have nothing to manage.
	const STORAGES: Array<{ id: string; label: string }> = [{ id: 'local', label: 'This device' }, { id: 'cloud', label: 'Cloud' }];
	let sourceId = $state('local');
	const signedOut = $derived(sourceId === 'cloud' && !studioSession.userId);
	const source = $derived(signedOut ? undefined : contentSourceFor(sourceId, studioSession.context));

	// How much each storage holds, side by side, so it is clear where the space goes.
	let overview = $state<Record<string, ContentUsage | null>>({});
	async function refreshOverview() {
		for (const { id } of STORAGES) {
			const storage = id === 'cloud' && !studioSession.userId ? undefined : contentSourceFor(id, studioSession.context);
			overview[id] = storage ? await storage.usage().catch(() => null) : null;
		}
	}

	let entries = $state<ContentEntry[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	let query = $state('');
	let type = $state('all');
	let sort = $state<Sort>('recent');
	let onlyUnused = $state(false);
	let showCache = $state(false);
	let selected = $state<AssetId[]>([]);
	let focusId = $state<AssetId | null>(null);

	let loadToken = 0;
	let baseAvatarChecked = false;
	async function load(quiet = false) {
		const current = source;
		const token = ++loadToken;
		if (!quiet) {
			selected = [];
			focusId = null;
		}
		if (!current) { entries = []; return; }
		loading = true;
		error = null;
		try {
			const [list, used] = await Promise.all([current.list(), current.usage()]);
			if (token !== loadToken) return;
			entries = list;
			overview[current.adapterId] = used;
			// The app's own avatar model is kept in this store too; opening it once makes sure it is marked as the app's, not as yours.
			if (current.adapterId === 'local' && !baseAvatarChecked) {
				baseAvatarChecked = true;
				void loadBaseAvatar().then((tree) => { if (tree && token === loadToken) void load(true); });
			}
		} catch (failure) {
			if (token !== loadToken) return;
			entries = [];
			error = failure instanceof Error ? failure.message : 'Could not read the content';
		} finally {
			if (token === loadToken) loading = false;
		}
	}

	$effect(() => {
		if (!studioSession.ready) return;
		void sourceId;
		void studioSession.userId;
		void load();
		void refreshOverview();
	});

	const types = $derived(allAssetKinds().filter((kind) => entries.some((entry) => entry.manifest.type === kind.type)));
	const visible = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		const shown = entries.filter((entry) =>
			(type === 'all' || entry.manifest.type === type) &&
			(showCache || !isCacheOnly(entry)) &&
			(!onlyUnused || isUnused(entry)) &&
			(!needle || entry.manifest.name.toLowerCase().includes(needle))
		);
		if (sort === 'name') return shown.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
		if (sort === 'size') return shown.sort((a, b) => b.manifest.byteSize - a.manifest.byteSize);
		return shown.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
	});
	/** A downloaded copy nothing of yours uses: hidden by default, since it is not part of your own content. */
	const isCacheOnly = (entry: ContentEntry): boolean => entry.cached && isUnused(entry);
	const cache = $derived(entries.filter(isCacheOnly));
	const unused = $derived(entries.filter((entry) => isUnused(entry) && !entry.cached && source && isRemovable(source, entry)));
	const focused = $derived(entries.find((entry) => entry.assetId === focusId) ?? null);

	function toggle(id: AssetId) {
		selected = selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id];
	}

	function selectAllVisible() {
		const ids = visible.map((entry) => entry.assetId);
		selected = ids.every((id) => selected.includes(id)) ? [] : ids;
	}

	async function remove(targets: ContentEntry[]) {
		const current = source;
		if (!current || !targets.length) return;
		const blocked = targets.filter((entry) => !isRemovable(current, entry));
		const removable = targets.filter((entry) => isRemovable(current, entry));
		if (!removable.length) {
			toasts.push('error', 'Everything selected is still used by an object or world.');
			return;
		}
		const single = removable.length === 1 ? `“${removable[0].manifest.name}”` : `${removable.length} files`;
		const ok = await dialogs.confirm({
			title: `Remove ${single}?`,
			message: current.adapterId === 'cloud'
				? `Frees ${formatBytes(totalBytes(removable))} of cloud storage.${blocked.length ? ` ${blocked.length} still in use will be kept.` : ''}`
				: `Frees ${formatBytes(totalBytes(removable))} on this device. Objects and worlds that use a removed file show a placeholder until it is imported again or downloaded from the cloud.`,
			confirmLabel: 'Remove',
			danger: true
		});
		if (!ok) return;
		let failed = 0;
		for (const entry of removable) {
			try { await current.remove(entry.assetId); } catch { failed++; }
		}
		if (failed) toasts.push('error', `${failed} could not be removed.`);
		else toasts.success(`Removed ${removable.length === 1 ? removable[0].manifest.name : `${removable.length} files`}`);
		await load();
	}

	async function download(entry: ContentEntry) {
		const bytes = await source?.bytes(entry.assetId).catch(() => null);
		if (!bytes) { toasts.push('error', 'The file is not available right now.'); return; }
		const kind = getAssetKind(entry.manifest.type);
		const extension = kind?.formats.find((format) => format.format === entry.manifest.format)?.extensions[0] ?? '';
		const name = entry.manifest.name.toLowerCase().endsWith(extension) ? entry.manifest.name : `${entry.manifest.name}${extension}`;
		const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: entry.manifest.mimeType }));
		const link = Object.assign(document.createElement('a'), { href: url, download: name });
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}

	async function importFiles() {
		await studioAssets.pickAndImport();
		await load();
	}

	let dragging = $state(false);
	async function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		if (sourceId !== 'local' || !event.dataTransfer?.files.length) return;
		await studioAssets.importFiles([...event.dataTransfer.files]);
		await load();
	}

	async function copyId(entry: ContentEntry) {
		try { await navigator.clipboard.writeText(entry.assetId); toasts.success('Copied the asset id'); }
		catch { toasts.push('error', 'Could not copy to the clipboard.'); }
	}

	// The bytes of the focused file, for the preview. Every kind is previewed from them, whichever storage they came from.
	let previewBytes = $state<Uint8Array | null>(null);
	let previewLoading = $state(false);
	let previewFor = $state<AssetId | null>(null);
	$effect(() => {
		const id = focusId;
		const current = source;
		previewBytes = null;
		previewFor = null;
		if (!id || !current) return;
		let alive = true;
		previewLoading = true;
		void current.bytes(id).catch(() => null).then((bytes) => {
			if (!alive) return;
			previewBytes = bytes;
			previewFor = id;
			previewLoading = false;
		});
		return () => { alive = false; };
	});

	const idleLabel = (entry: ContentEntry): string => entry.cached ? 'Cache' : 'Unused';

	const usedLabel = (entry: ContentEntry): string => {
		if (!entry.usedBy) return 'Unknown';
		const parts = [
			entry.usedBy.items && `${entry.usedBy.items} object${entry.usedBy.items === 1 ? '' : 's'}`,
			entry.usedBy.worlds && `${entry.usedBy.worlds} world${entry.usedBy.worlds === 1 ? '' : 's'}`,
			entry.usedBy.publications && `${entry.usedBy.publications} publication${entry.usedBy.publications === 1 ? '' : 's'}`
		].filter(Boolean);
		return parts.length ? parts.join(', ') : entry.builtin ? 'The app (base avatar)' : entry.cached ? 'Nothing (cached copy)' : 'Not used';
	};
</script>

<LauncherShell active="content">
	<div
		class="page"
		class:dragging
		role="region"
		aria-label="Content"
		ondragover={(event) => { if (sourceId === 'local' && event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragging = true; } }}
		ondragleave={() => (dragging = false)}
		ondrop={onDrop}
	>
		<div class="row">
			<h1>Content</h1>
			<div class="tools">
				{#if sourceId === 'local'}<button class="btn primary" onclick={importFiles} disabled={studioAssets.importing}><Icon name="upload" size={14} />Import files</button>{/if}
			</div>
		</div>

		<div class="storages" role="tablist" aria-label="Storage">
			{#each STORAGES as storage (storage.id)}
				{@const info = overview[storage.id]}
				{@const percent = info && info.quota > 0 ? Math.min(100, (info.bytes / info.quota) * 100) : 0}
				<button class="storage" role="tab" aria-selected={sourceId === storage.id} onclick={() => (sourceId = storage.id)}>
					<span class="storage-head"><Icon name={adapterIcon(storage.id)} size={16} /><strong>{storage.label}</strong></span>
					{#if storage.id === 'cloud' && !studioSession.userId}
						<span class="muted">Sign in to see it</span>
					{:else if info}
						<span><strong>{formatBytes(info.bytes)}</strong> <span class="muted">{info.quota > 0 ? `of ${formatBytes(info.quota)}` : 'used'} · {info.count} file{info.count === 1 ? '' : 's'}</span></span>
						{#if info.quota > 0}<span class="bar" role="progressbar" aria-label="Storage used" aria-valuenow={Math.round(percent)} aria-valuemin="0" aria-valuemax="100"><span style:width="{percent}%" class:full={percent > 90}></span></span>{/if}
						{#each info.parts ?? [] as part (part.label)}<span class="muted part">{part.label}: {formatBytes(part.bytes)}</span>{/each}
					{:else}
						<span class="muted">Loading…</span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="filters">
			<label class="search">
				<Icon name="search" size={14} />
				<span class="sr-only">Search content</span>
				<input class="input" placeholder="Search" bind:value={query} />
			</label>
			<div class="tabs" role="tablist" aria-label="Type">
				<button class="tab" role="tab" aria-selected={type === 'all'} onclick={() => (type = 'all')}>All</button>
				{#each types as kind (kind.type)}
					<button class="tab" role="tab" aria-selected={type === kind.type} onclick={() => (type = kind.type)}><Icon name={kindIcon(kind.type)} size={14} />{kind.label}</button>
				{/each}
			</div>
			<select class="select sort" aria-label="Sort by" bind:value={sort}>
				<option value="recent">Newest</option>
				<option value="name">Name</option>
				<option value="size">Largest</option>
			</select>
			<label class="check"><input type="checkbox" bind:checked={onlyUnused} />Unused only</label>
			{#if cache.length}<label class="check"><input type="checkbox" bind:checked={showCache} />Show cache ({cache.length})</label>{/if}
			<span class="spacer"></span>
			{#if cache.length}<button class="btn" onclick={() => remove(cache)}><Icon name="trash" size={14} />Clear cache ({formatBytes(totalBytes(cache))})</button>{/if}
			{#if unused.length}<button class="btn" onclick={() => remove(unused)}><Icon name="trash" size={14} />Remove unused ({unused.length} · {formatBytes(totalBytes(unused))})</button>{/if}
		</div>

		{#if selected.length}
			<div class="selection" role="status">
				<strong>{selected.length} selected</strong>
				<button class="btn sm" onclick={() => remove(entries.filter((entry) => selected.includes(entry.assetId)))}><Icon name="trash" size={12} />Remove</button>
				<button class="btn ghost sm" onclick={() => (selected = [])}>Clear</button>
			</div>
		{/if}

		<div class="layout" class:with-detail={focused}>
			<div class="list">
				{#if signedOut}
					<div class="empty"><Icon name="cloud" size={22} /><strong>Your cloud content</strong>Sign in to see the files stored in your account and how much of your quota they use.<a class="btn primary" href={resolve('/login')}>Sign in</a></div>
				{:else if error}
					<div class="empty" role="alert"><Icon name="warning" size={22} /><strong>Could not load the content</strong>{error}<button class="btn" onclick={load}>Try again</button></div>
				{:else if loading && !entries.length}
					<div class="empty">Loading…</div>
				{:else if !visible.length}
					<div class="empty">
						<strong>{entries.length ? 'No matches' : 'Nothing here yet'}</strong>
						{entries.length ? 'Try a different search or filter.' : sourceId === 'local' ? 'Import models, sounds and images, or drop files here.' : 'Files you upload from an object or world appear here.'}
					</div>
				{:else}
					<div class="head">
						<input type="checkbox" aria-label="Select all shown" checked={visible.every((entry) => selected.includes(entry.assetId))} onchange={selectAllVisible} />
						<span>{visible.length} file{visible.length === 1 ? '' : 's'} · {formatBytes(totalBytes(visible))}</span>
					</div>
					<ul>
						{#each visible as entry (entry.assetId)}
							<li class="entry" class:focused={focusId === entry.assetId}>
								<input type="checkbox" aria-label={`Select ${entry.manifest.name}`} checked={selected.includes(entry.assetId)} onchange={() => toggle(entry.assetId)} />
								<button class="entry-main" onclick={() => (focusId = focusId === entry.assetId ? null : entry.assetId)}>
									<span class="entry-icon"><Icon name={kindIcon(entry.manifest.type)} size={18} /></span>
									<span class="entry-text">
										<strong>{entry.manifest.name}</strong>
										<span class="muted">{kindLabel(entry.manifest.type)} · {entry.manifest.format.toUpperCase()} · {formatBytes(entry.manifest.byteSize)}</span>
									</span>
								</button>
								{#if entry.builtin}<span class="badge">Built-in</span>{:else if isUnused(entry)}<span class="badge warning">{idleLabel(entry)}</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if focused}
				<aside class="detail" aria-label="Details">
					<div class="detail-head">
						<h2>{focused.manifest.name}</h2>
						<button class="icon-btn" aria-label="Close details" onclick={() => (focusId = null)}><Icon name="close" size={14} /></button>
					</div>
					{#key focused.assetId}<ContentPreview manifest={focused.manifest} bytes={previewFor === focused.assetId ? previewBytes : null} loading={previewLoading || previewFor !== focused.assetId} icon={kindIcon(focused.manifest.type)} />{/key}
					<dl>
						<dt>Type</dt><dd>{kindLabel(focused.manifest.type)} ({focused.manifest.format.toUpperCase()})</dd>
						<dt>Size</dt><dd>{formatBytes(focused.manifest.byteSize)}</dd>
						<dt>Used by</dt><dd>{usedLabel(focused)}</dd>
						{#if focused.usedIn?.length}
							<dt>Used in</dt>
							<dd class="used-in">
								{#each focused.usedIn.slice(0, 8) as place (place.label)}
									{#if place.href}<a href={place.href}>{place.label}</a>{:else}<span>{place.label}</span>{/if}
								{/each}
								{#if focused.usedIn.length > 8}<span class="muted">and {focused.usedIn.length - 8} more</span>{/if}
							</dd>
						{/if}
						{#if focused.addedAt}<dt>Added</dt><dd>{formatDate(focused.addedAt)}</dd>{/if}
						{#if focused.lastUsedAt}<dt>Last used</dt><dd>{formatDate(focused.lastUsedAt)}</dd>{/if}
						{#each describeFields(focused.manifest) as field (field.label)}<dt>{field.label}</dt><dd>{field.value}</dd>{/each}
						<dt>Id</dt><dd class="id">{focused.assetId}</dd>
					</dl>
					<div class="actions">
						<button class="btn" onclick={() => download(focused)}><Icon name="download" size={14} />Download</button>
						<button class="btn" onclick={() => copyId(focused)}><Icon name="copy" size={14} />Copy id</button>
						<button class="btn danger" disabled={!source || !isRemovable(source, focused)} title={source && !isRemovable(source, focused) ? 'Still used by an object or world' : undefined} onclick={() => remove([focused])}><Icon name="trash" size={14} />Remove</button>
					</div>
				</aside>
			{/if}
		</div>
	</div>
</LauncherShell>

<style>
	.page { display: grid; gap: 16px; max-width: var(--page-width); }
	.page.dragging { outline: 2px dashed var(--accent); outline-offset: 8px; border-radius: 12px; }
	h1 { margin: 0; font-size: 22px; font-weight: 650; }
	h2 { margin: 0; overflow: hidden; font-size: 15px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
	.row, .tools, .filters, .selection { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
	.row { justify-content: space-between; gap: 12px; }
	.storages { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
	.storage { display: grid; align-content: start; gap: 4px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); color: inherit; font: inherit; text-align: left; cursor: pointer; }
	.storage:hover { border-color: #3a4157; }
	.storage[aria-selected='true'] { border-color: var(--accent); }
	.storage-head { display: flex; align-items: center; gap: 8px; }
	.part { font-size: 12px; }
	.bar { display: block; height: 6px; overflow: hidden; border-radius: 3px; background: var(--panel-3); }
	.bar span { display: block; height: 100%; background: var(--accent); }
	.bar span.full { background: var(--warning); }
	.search { position: relative; display: flex; align-items: center; width: 200px; color: var(--muted); }
	.search :global(svg) { position: absolute; left: 9px; pointer-events: none; }
	.search .input { padding-left: 28px; }
	.sort { width: auto; }
	.check { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); cursor: pointer; }
	.spacer { flex: 1; }
	.selection { padding: 6px 10px; border: 1px solid var(--accent); border-radius: 8px; background: var(--accent-soft); }
	.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
	.layout.with-detail { grid-template-columns: minmax(0, 1fr) 320px; }
	.head { display: flex; align-items: center; gap: 10px; padding: 0 10px 8px; color: var(--muted); font-size: 12px; }
	ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
	.entry { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); }
	.entry:hover { border-color: #3a4157; }
	.entry.focused { border-color: var(--accent); }
	.entry-main { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; padding: 2px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
	.entry-icon { display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 8px; background: var(--accent-soft); color: var(--accent); }
	.entry-text { display: grid; min-width: 0; gap: 1px; }
	.entry-text strong, .entry-text .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.detail { position: sticky; top: 16px; display: grid; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); }
	.detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; margin: 0; }
	dt { color: var(--muted); }
	dd { margin: 0; overflow-wrap: anywhere; }
	.used-in { display: grid; gap: 2px; }
	.used-in a { color: var(--accent); }
	.used-in a:hover { text-decoration: underline; }
	dd.id { font: 11px var(--mono); color: var(--muted); }
	.actions { display: flex; flex-wrap: wrap; gap: 8px; }
	@media (max-width: 900px) {
		.layout.with-detail { grid-template-columns: minmax(0, 1fr); }
		.detail { position: static; }
	}
	@media (max-width: 600px) { .search { width: 100%; } }
</style>
