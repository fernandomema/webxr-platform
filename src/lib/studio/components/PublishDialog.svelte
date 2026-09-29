<script lang="ts">
	import { onMount } from 'svelte';
	import type { PublicationSummary, PublishResult, StudioProject } from '../state/project.svelte';
	import { studioSession } from '../state/session.svelte';

	interface Props {
		project: StudioProject;
		onclose: () => void;
		ondone: (result: PublishResult) => void;
	}

	let { project, onclose, ondone }: Props = $props();

	let publications = $state<PublicationSummary[]>([]);
	let loading = $state(true);
	let mode = $state<'new' | 'revision'>('new');
	let target = $state('');
	let publishing = $state(false);
	let error = $state('');

	const signedIn = $derived(Boolean(studioSession.userId));
	const chosen = $derived(publications.find((publication) => publication.id === target));

	onMount(async () => {
		if (!studioSession.userId) {
			loading = false;
			return;
		}
		try {
			publications = await project.listMyPublications(studioSession.userId);
			const remembered = project.lastPublicationId;
			const match = publications.find((publication) => publication.id === remembered) ?? publications.find((publication) => publication.name === project.doc.name);
			if (match) {
				mode = 'revision';
				target = match.id;
			} else target = publications[0]?.id ?? '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not load your published worlds';
		} finally {
			loading = false;
		}
	});

	async function publish() {
		publishing = true;
		error = '';
		try {
			ondone(await project.publish(mode === 'revision' ? target : undefined));
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not publish this world';
		} finally {
			publishing = false;
		}
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="studio-backdrop" onclick={(event) => event.target === event.currentTarget && onclose()}>
	<div class="studio-modal" role="dialog" aria-modal="true" aria-label="Publish world">
		<h2>Publish “{project.doc.name}”</h2>
		{#if !signedIn}
			<p>You need to sign in to publish worlds.</p>
			<div class="actions"><button class="btn" onclick={onclose}>Close</button><a class="btn primary" href="/login">Sign in</a></div>
		{:else}
			<p>Publishing snapshots the world as it is right now. Each publish is an immutable revision.</p>
			{#if loading}
				<div class="empty">Loading…</div>
			{:else}
				<label class="choice">
					<input type="radio" bind:group={mode} value="new" />
					<span><strong>Publish as a new world</strong><span class="muted">Starts at revision 1.</span></span>
				</label>
				<label class="choice" class:disabled={!publications.length}>
					<input type="radio" bind:group={mode} value="revision" disabled={!publications.length} />
					<span>
						<strong>Add a revision to an existing world</strong>
						{#if publications.length}
							<select class="select" bind:value={target} disabled={mode !== 'revision'} aria-label="World to update">
								{#each publications as publication (publication.id)}
									<option value={publication.id}>{publication.name} (revision {publication.latestRevision})</option>
								{/each}
							</select>
						{:else}<span class="muted">You haven’t published a world yet.</span>{/if}
					</span>
				</label>
				{#if mode === 'revision' && chosen}<p class="note">This will create revision {chosen.latestRevision + 1}.</p>{/if}
			{/if}
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<div class="actions">
				<button class="btn" onclick={onclose}>Cancel</button>
				<button class="btn primary" disabled={publishing || loading || (mode === 'revision' && !target)} onclick={publish}>
					{project.assetProgress ? `Uploading models ${project.assetProgress.done + 1}/${project.assetProgress.total}…` : publishing ? 'Publishing…' : 'Publish'}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.choice { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 6px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
	.choice:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
	.choice.disabled { opacity: 0.55; cursor: not-allowed; }
	.choice input { margin-top: 2px; }
	.choice > span { display: grid; flex: 1; gap: 6px; }
	.note { margin: 6px 0 0; font-size: 12px; }
	.error { margin: 10px 0 0; color: var(--danger); }
	a.btn { text-decoration: none; }
</style>
