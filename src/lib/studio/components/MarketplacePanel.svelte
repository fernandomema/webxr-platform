<script lang="ts">
	import type { StudioProject } from '../state/project.svelte';
	import { studioSession } from '../state/session.svelte';
	import { toasts } from '../state/toasts.svelte';

	interface Props { project: StudioProject }
	let { project }: Props = $props();

	interface Listing { name: string; description: string; thumbnailUrl: string | null; status: 'published' | 'hidden'; latestRevision: number; updatedAt: string; containsCode: boolean }

	const marketplaceItemId = $derived(project.item?.marketplaceItemId ?? null);
	const canPublish = $derived(Boolean(project.item) && project.adapterId !== 'purchased');

	let name = $state('');
	let description = $state('');
	let thumbnailUrl = $state('');
	let listing = $state.raw<Listing | null>(null);
	let loading = $state(false);
	let saving = $state(false);
	let visibilityBusy = $state(false);
	let error = $state('');
	let loadedItemId: string | null = null;

	// Runs on mount and whenever this object goes from unpublished to published
	// (or a different item is open), never on every render of the same listing.
	$effect(() => {
		const id = marketplaceItemId;
		if (!id) {
			loadedItemId = null;
			listing = null;
			name = project.doc.name;
			description = '';
			thumbnailUrl = '';
			return;
		}
		if (id === loadedItemId) return;
		loadedItemId = id;
		loading = true;
		error = '';
		void fetch(`/api/marketplace/items/${id}`)
			.then(async (response) => {
				if (!response.ok) throw new Error('Could not load this listing.');
				const item = (await response.json()) as Listing;
				listing = item;
				name = item.name;
				description = item.description;
				thumbnailUrl = item.thumbnailUrl ?? '';
			})
			.catch((cause) => { error = cause instanceof Error ? cause.message : 'Could not load this listing.'; })
			.finally(() => { loading = false; });
	});

	async function publish() {
		saving = true;
		error = '';
		try {
			const result = await project.publishMarketplaceItem(name, description, thumbnailUrl);
			toasts.success(marketplaceItemId ? `Published revision ${result.revision}` : `Published “${name}” to the marketplace`);
			loadedItemId = null; // force a refetch so status/revision/updatedAt reflect what just happened
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not publish this item.';
		} finally { saving = false; }
	}

	async function toggleVisibility() {
		if (!listing) return;
		const next = listing.status === 'published' ? 'hidden' : 'published';
		visibilityBusy = true;
		error = '';
		try {
			await project.setMarketplaceVisibility(next);
			listing = { ...listing, status: next };
			toasts.info(next === 'hidden' ? 'Listing hidden from the marketplace.' : 'Listing is visible again.');
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not change visibility.';
		} finally { visibilityBusy = false; }
	}

	function timeLabel(iso: string): string {
		return new Date(iso).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
	}
</script>

<div class="marketplace-panel">
	{#if !studioSession.userId}
		<div class="gate">
			<p>Sign in to publish objects to the marketplace.</p>
			<a class="btn primary" href="/login">Sign in</a>
		</div>
	{:else if !canPublish}
		<div class="gate">
			<p>Save this object to a writable inventory before publishing it.</p>
		</div>
	{:else}
		<div class="scroll">
			{#if marketplaceItemId}
				<div class="status-row">
					<span class="badge {listing?.status === 'hidden' ? 'warning' : 'success'}">{loading ? 'Loading…' : listing?.status === 'hidden' ? 'Hidden' : 'Published'}</span>
					{#if listing}<span class="muted">Revision {listing.latestRevision} · updated {timeLabel(listing.updatedAt)}</span>{/if}
				</div>
				{#if listing?.containsCode}<p class="muted small">Contains a code block — anyone who acquires this runs it as unsandboxed JavaScript.</p>{/if}
			{:else}
				<p class="muted">Publishing shares this object on the marketplace. Acquisitions are free and automatically include revisions you publish later.</p>
			{/if}

			<label>Name<input class="input" bind:value={name} maxlength="120" disabled={loading} /></label>
			<label>Description<textarea class="input" bind:value={description} rows="4" maxlength="2000" disabled={loading}></textarea></label>
			<label>Thumbnail URL <span class="muted">(optional)</span><input class="input" bind:value={thumbnailUrl} maxlength="2048" disabled={loading} /></label>

			{#if error}<p class="error" role="alert">{error}</p>{/if}

			<div class="actions">
				<button class="btn primary" disabled={saving || loading || !name.trim()} onclick={publish}>
					{saving ? 'Publishing…' : marketplaceItemId ? 'Publish update' : 'Publish to Marketplace'}
				</button>
				{#if marketplaceItemId && listing}
					<button class="btn" disabled={visibilityBusy || loading} onclick={toggleVisibility}>
						{visibilityBusy ? 'Working…' : listing.status === 'hidden' ? 'Unhide listing' : 'Hide listing'}
					</button>
				{/if}
			</div>
			{#if marketplaceItemId}<p class="muted small">Publishing an update also pushes your current scene as a new revision.</p>{/if}
		</div>
	{/if}
</div>

<style>
	.marketplace-panel { height: 100%; display: flex; flex-direction: column; min-height: 0; font-size: 12px; }
	.gate { display: grid; gap: 10px; padding: 16px 10px; justify-items: start; }
	.gate a.btn { text-decoration: none; }
	.scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; display: grid; gap: 10px; align-content: start; }
	.scroll label { display: grid; gap: 4px; }
	.status-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.muted.small { font-size: 11px; line-height: 1.4; }
	.actions { display: flex; gap: 8px; }
	.error { color: var(--danger); margin: 0; }
</style>
