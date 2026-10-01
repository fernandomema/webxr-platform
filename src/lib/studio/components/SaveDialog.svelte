<script lang="ts">
	import type { InventoryAdapter } from '$lib/inventory/types';
	import type { SaveTarget } from '../state/project.svelte';

	interface Props {
		defaultName: string;
		kind: 'object' | 'world';
		adapters: InventoryAdapter[];
		signedIn: boolean;
		onsave: (target: SaveTarget) => void;
		onclose: () => void;
	}

	let { defaultName, kind, adapters, signedIn, onsave, onclose }: Props = $props();

	// svelte-ignore state_referenced_locally
	let name = $state(defaultName);
	// svelte-ignore state_referenced_locally
	let adapterId = $state(adapters[0]?.id ?? 'local');
	let folderError = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		folderError = '';
		try {
			if (adapterId === 'filesystem') await adapters.find((adapter) => adapter.id === adapterId)?.connect?.();
			onsave({ adapterId, folderId: null, name: name.trim() });
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			folderError = error instanceof Error ? error.message : 'Could not open the folder';
		}
	}

	const options = $derived(
		[
			{ id: 'local', label: 'This device', hint: 'Stored in this browser only.', enabled: adapters.some((a) => a.id === 'local') },
			{ id: 'cloud', label: 'Cloud', hint: signedIn ? 'Available on all your devices.' : 'Sign in to save to the cloud.', enabled: adapters.some((a) => a.id === 'cloud') },
			...(adapters.some((a) => a.id === 'filesystem')
				? [{ id: 'filesystem', label: 'Project files', hint: 'Save a JSON file in a folder on this computer.', enabled: true }]
				: [])
		]
	);
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="studio-backdrop" onclick={(event) => event.target === event.currentTarget && onclose()}>
	<div class="studio-modal" role="dialog" aria-modal="true" aria-label="Save project">
	<form onsubmit={submit}>
		<h2>Save {kind === 'world' ? 'world' : 'object'}</h2>
		<p>Choose a name and where to keep it.</p>
		<label class="field">
			<span>Name</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="input" bind:value={name} autofocus />
		</label>
		<fieldset>
			<legend>Location</legend>
			{#each options as option (option.id)}
				<label class="choice" class:disabled={!option.enabled}>
					<input type="radio" name="location" value={option.id} bind:group={adapterId} disabled={!option.enabled} />
					<span><strong>{option.label}</strong><span class="muted">{option.hint}</span></span>
				</label>
			{/each}
		</fieldset>
		{#if folderError}<p role="alert">{folderError}</p>{/if}
		<div class="actions">
			<button type="button" class="btn" onclick={onclose}>Cancel</button>
			<button type="submit" class="btn primary" disabled={!name.trim()}>Save</button>
		</div>
	</form>
	</div>
</div>

<style>
	.field { display: grid; gap: 4px; margin-bottom: 12px; color: var(--muted); font-size: 12px; }
	fieldset { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; }
	legend { margin-bottom: 6px; padding: 0; color: var(--muted); font-size: 12px; }
	.choice { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
	.choice:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
	.choice.disabled { opacity: 0.5; cursor: not-allowed; }
	.choice span { display: grid; }
</style>
