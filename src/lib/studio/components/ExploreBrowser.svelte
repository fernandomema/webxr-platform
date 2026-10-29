<script lang="ts">
	import { describeLicense } from '@kithin/engine/library/license';
	import type { AssetDetail, AssetKind, AssetSummary } from '@kithin/engine/library/types';
	import { getAssetDetail, listSources, searchLibrary, type SourceLite } from '../library/client';
	import { browserImportDeps } from '../library/deps';
	import { canImportKind, canOptimizeKind, importFromLibrary, variantFor, type ImportResult } from '../library/importers';
	import { formatBytes } from '../state/models.svelte';
	import Icon from '../ui/Icon.svelte';
	import Select from '../ui/Select.svelte';

	interface Props {
		kind: AssetKind;
		/** The button that imports the chosen asset. */
		actionLabel: string;
		/** A second button that imports it made lighter (WebP textures, a lighter file…). Left out, there is none. Materials never show it: they are always optimized. */
		optimizedLabel?: string;
		/** Called with what was imported; the browser stays open unless the caller closes it. */
		onimported: (result: ImportResult, detail: AssetDetail) => void | Promise<void>;
	}

	let { kind, actionLabel, optimizedLabel, onimported }: Props = $props();

	const PAGE = 24;
	const MIN_SHOWN = 8;
	let sources = $state<SourceLite[]>([]);
	let source = $state('all');
	let query = $state('');
	// Music is not CC0 (its license is on each card), so asking for commercial use only would leave Sounds empty.
	let commercialOnly = $state(kind !== 'audio');
	// By default only what can be imported here is listed; this also shows what has to be taken from its own site.
	let showAll = $state(false);
	// Search results are only read, so they are kept as plain data rather than reactive proxies.
	let items = $state.raw<AssetSummary[]>([]);
	// Pages are read one at a time. `cursors[n]` is where page n starts; it is known once the page before it has been read.
	let page = $state(0);
	let cursors = $state.raw<(string | null)[]>([null]);
	let total = $state<number | undefined>(undefined);
	let loading = $state(false);
	let error = $state('');
	let warnings = $state<string[]>([]);
	let selected = $state.raw<AssetSummary | null>(null);
	let detail = $state.raw<AssetDetail | null>(null);
	let detailError = $state('');
	let variantId = $state('');
	let importing = $state<'plain' | 'optimized' | null>(null);
	let importError = $state('');

	let searchAbort: AbortController | null = null;
	let detailAbort: AbortController | null = null;

	const kindSources = $derived(sources.filter((entry) => entry.kinds.includes(kind)));
	const sourceName = (ref: string) => sources.find((entry) => ref.startsWith(`${entry.id}:`))?.name ?? 'the source';

	$effect(() => {
		const abort = new AbortController();
		void listSources(abort.signal).then((found) => (sources = found)).catch(() => { /* The search reports it. */ });
		return () => abort.abort();
	});

	async function search(pageIndex: number) {
		searchAbort?.abort();
		const abort = new AbortController();
		searchAbort = abort;
		loading = true; error = '';
		try {
			// Leaving out what can not be imported can leave a page nearly empty, so a few more are read until it has something to show.
			let cursor = cursors[pageIndex] ?? null;
			let collected: AssetSummary[] = [];
			for (let read = 0; read < 5; read++) {
				const found = await searchLibrary({ source, kind, text: query, cursor, limit: PAGE, commercialOnly, importableOnly: !showAll }, abort.signal);
				if (abort.signal.aborted) return;
				const seen = new Set(collected.map((item) => item.ref));
				collected = [...collected, ...found.items.filter((item) => !seen.has(item.ref))];
				cursor = found.next; total = found.total;
				warnings = (found.errors ?? []).map((entry) => `${sources.find((candidate) => candidate.id === entry.source)?.name ?? entry.source}: ${entry.message}`);
				if (!cursor || collected.length >= MIN_SHOWN) break;
			}
			items = collected; page = pageIndex;
			cursors = [...cursors.slice(0, pageIndex + 1), ...(cursor ? [cursor] : [])];
		} catch (caught) {
			if (!abort.signal.aborted) { error = caught instanceof Error ? caught.message : 'Could not search right now.'; if (pageIndex === 0) { items = []; cursors = [null]; page = 0; } }
		} finally {
			if (searchAbort === abort) loading = false;
		}
	}

	const hasNext = $derived(cursors.length > page + 1);
	/** The page count is only exact when nothing is left out of the list. */
	const pageCount = $derived(showAll && total !== undefined ? Math.max(1, Math.ceil(total / PAGE)) : undefined);

	// A new search when the kind, the source, the filter or (after a short pause) the words change.
	$effect(() => {
		void kind; void source; void commercialOnly; void showAll;
		const text = query;
		const timer = setTimeout(() => { cursors = [null]; void search(0); }, text ? 300 : 0);
		return () => clearTimeout(timer);
	});
	$effect(() => () => { searchAbort?.abort(); detailAbort?.abort(); });

	async function choose(item: AssetSummary) {
		selected = item; detail = null; detailError = ''; importError = ''; variantId = '';
		detailAbort?.abort();
		const abort = new AbortController();
		detailAbort = abort;
		try {
			const found = await getAssetDetail(item.ref, abort.signal);
			if (abort.signal.aborted) return;
			detail = found;
			variantId = variantFor(found)?.id ?? '';
		} catch (caught) {
			if (!abort.signal.aborted) detailError = caught instanceof Error ? caught.message : 'Could not read this asset.';
		}
	}

	const blocker = $derived.by(() => {
		if (!detail) return '';
		if (!canImportKind(detail.kind)) return `Importing ${detail.kind} is not available yet.`;
		if (!detail.downloadable) return detail.variants.find((variant) => variant.unsupported)?.unsupported ?? `This one has to be taken from ${sourceName(detail.ref)}'s own site.`;
		if (!variantId) return detail.variants.find((variant) => variant.unsupported)?.unsupported ?? 'There is no version of this that can be imported.';
		return '';
	});

	async function doImport(optimize: boolean) {
		if (!detail || blocker || importing) return;
		importing = optimize ? 'optimized' : 'plain'; importError = '';
		try {
			const result = await importFromLibrary(detail, browserImportDeps, { variantId, optimize });
			await onimported(result, detail);
		} catch (caught) {
			importError = caught instanceof Error ? caught.message : 'Could not import this.';
		} finally { importing = null; }
	}

	function facts(item: AssetSummary): string {
		const parts: string[] = [];
		if (item.facts?.polyCount) parts.push(`${item.facts.polyCount >= 1000 ? `${(item.facts.polyCount / 1000).toFixed(item.facts.polyCount >= 10000 ? 0 : 1)}k` : item.facts.polyCount} tris`);
		if (item.facts?.realWorldSize) parts.push(`${item.facts.realWorldSize} m`);
		if (item.facts?.rigged) parts.push('rigged');
		return parts.join(' · ');
	}

	const variantOptions = $derived((detail?.variants ?? []).map((variant) => ({ value: variant.id, label: `${variant.label}${variant.totalBytes ? ` · ${formatBytes(variant.totalBytes)}` : ''}${variant.unsupported ? ' (not importable)' : ''}`, disabled: Boolean(variant.unsupported) })));
</script>

<div class="explore">
	<div class="bar">
		<label class="search"><Icon name="search" size={14} /><input class="input" type="search" placeholder="Search…" aria-label="Search the online libraries" bind:value={query} /></label>
		{#if kindSources.length > 1}
			<Select label="Source" value={source} options={[{ value: 'all', label: 'All sources' }, ...kindSources.map((entry) => ({ value: entry.id, label: entry.name }))]} onchange={(next) => (source = next)} />
		{/if}
	</div>
	<div class="filters">
		<label class="check"><input type="checkbox" bind:checked={commercialOnly} /> Commercial use allowed only</label>
		<label class="check"><input type="checkbox" bind:checked={showAll} /> Also show what can only be taken from its own site</label>
	</div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#each warnings as warning (warning)}<p class="warn">{warning}</p>{/each}

	<div class="results" role="group" aria-label="Results" aria-busy={loading}>
		{#each items as item (item.ref)}
			<button class="card" class:on={selected?.ref === item.ref} type="button" aria-pressed={selected?.ref === item.ref} onclick={() => void choose(item)}>
				<span class="thumb">{#if item.thumbnailUrl}<img src={item.thumbnailUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />{:else}<Icon name="image" size={20} />{/if}</span>
				<span class="title">{item.title}</span>
				<span class="meta">{facts(item)}{#if facts(item)} · {/if}{item.license.name}{#if !item.downloadable} · link only{/if}</span>
			</button>
		{/each}
		{#if !loading && !items.length && !error}<p class="muted empty">Nothing found. Try other words{commercialOnly ? ' or allow all licenses' : ''}.</p>{/if}
	</div>
	{#if loading}<p class="muted status">Searching…</p>{/if}
	{#if page > 0 || hasNext}
		<nav class="pager" aria-label="Pages">
			<button class="btn sm" type="button" disabled={loading || page === 0} onclick={() => void search(page - 1)}><Icon name="chevron-left" size={12} />Previous</button>
			<span class="muted">Page {page + 1}{#if pageCount} of {pageCount.toLocaleString('en-US')}{/if}</span>
			<button class="btn sm" type="button" disabled={loading || !hasNext} onclick={() => void search(page + 1)}>Next<Icon name="chevron-right" size={12} /></button>
		</nav>
	{/if}

	{#if selected}
		<section class="detail" aria-label="Selected asset">
			<div class="head">
				<strong>{selected.title}</strong>
				<button class="icon-btn" type="button" aria-label="Close details" onclick={() => { selected = null; detail = null; }}><Icon name="close" size={12} /></button>
			</div>
			<p class="muted small">{#if selected.author}by {selected.author} · {/if}{describeLicense(selected.license)}{#if selected.license.url} · <a href={selected.license.url} target="_blank" rel="noopener noreferrer">license</a>{/if}</p>
			{#if detailError}<p class="error" role="alert">{detailError}</p>
			{:else if !detail}<p class="muted small">Loading…</p>
			{:else}
				{#if detail.description}<p class="small description">{detail.description}</p>{/if}
				{#if detail.license.attributionRequired === true}<p class="notice small">The author asks for credit. It is recorded with the asset so it can be credited when you publish.</p>{/if}
				{#if variantOptions.length > 1}
					<div class="field"><span class="label">Version</span><Select label="Version" value={variantId} options={variantOptions} onchange={(next) => (variantId = next)} /></div>
				{/if}
				{#if blocker}<p class="muted small">{blocker}</p>{/if}
				{#if importError}<p class="error" role="alert">{importError}</p>{/if}
				<div class="actions">
					<a class="btn sm" href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">View on {sourceName(detail.ref)}</a>
					{#if optimizedLabel && canOptimizeKind(detail.kind)}
						<button class="btn sm" type="button" disabled={Boolean(blocker) || importing !== null} onclick={() => void doImport(true)}>{importing === 'optimized' ? 'Optimizing…' : optimizedLabel}</button>
					{/if}
					<button class="btn primary sm" type="button" disabled={Boolean(blocker) || importing !== null} onclick={() => void doImport(false)}>{importing === 'plain' ? 'Importing…' : actionLabel}</button>
				</div>
			{/if}
		</section>
	{/if}
</div>

<style>
	.explore { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; padding: 12px; font-size: 12px; }
	.bar { display: flex; gap: 8px; align-items: center; }
	.search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--muted); }
	.search .input { flex: 1; min-width: 0; }
	.filters { display: grid; gap: 10px; padding: 2px 2px 4px; }
	.check { display: flex; align-items: center; gap: 8px; color: var(--muted); line-height: 1.35; }
	.results { flex: 1; min-height: 80px; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; align-content: start; }
	.card { display: grid; gap: 4px; padding: 6px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel-2); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
	.card:hover { background: var(--panel-3); }
	.card.on { border-color: var(--accent); }
	.thumb { display: grid; place-items: center; aspect-ratio: 1; border-radius: 6px; background: var(--panel); color: var(--muted); overflow: hidden; }
	.thumb img { width: 100%; height: 100%; object-fit: cover; }
	.title { font-weight: 600; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
	.meta { color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
	.empty, .status { grid-column: 1 / -1; margin: 6px 0; }
	.pager { display: flex; align-items: center; justify-content: center; gap: 12px; }
	.detail { border-top: 1px solid var(--border); padding-top: 8px; display: grid; gap: 6px; max-height: 45%; overflow-y: auto; }
	.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
	.small { font-size: 11px; margin: 0; }
	.description { color: var(--muted); display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
	.notice { padding: 6px 8px; border-radius: 8px; background: var(--accent-soft); }
	.field { display: grid; gap: 4px; }
	.label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
	.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; align-items: center; }
	.error { color: var(--danger); margin: 0; }
	.warn { color: var(--warning); margin: 0; font-size: 11px; }
	a { color: var(--accent); }
</style>
