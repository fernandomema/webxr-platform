<script lang="ts">
	import { onMount } from 'svelte';
	import { RemoteDocument } from '$lib/xr/panels/remoteDocument.svelte';
	import { toasts } from '$lib/studio/state/toasts.svelte';
	import Hierarchy from '$lib/studio/components/Hierarchy.svelte';
	import Inspector from '$lib/studio/components/Inspector.svelte';
	import WorldObjectActions from '$lib/studio/components/WorldObjectActions.svelte';
	import Checkbox from '$lib/studio/ui/Checkbox.svelte';
	import Icon from '$lib/studio/ui/Icon.svelte';

	const doc = new RemoteDocument();

	let advanced = $state(false);
	let editingCode = $state(false);
	let draft = $state('');

	const codeIndex = $derived(doc.selected?.components.findIndex((component) => component.type === 'codeBlock') ?? -1);
	const log = $derived(doc.debugLog && doc.debugLog.slotId === doc.selectedId ? doc.debugLog.entries : []);

	onMount(() => {
		try {
			advanced = localStorage.getItem('studio:advanced') === '1';
		} catch {
			// Preference is optional.
		}
		doc.connect();
		return () => doc.disconnect();
	});

	$effect(() => {
		const notice = doc.notice;
		if (!notice) return;
		if (notice.level === 'error') toasts.error(new Error(notice.message), 'Inspector');
		else toasts.info(notice.message);
	});

	// A code editor belongs to the slot it was opened for.
	$effect(() => {
		void doc.selectedId;
		editingCode = false;
	});

	function setAdvanced(value: boolean) {
		advanced = value;
		try {
			localStorage.setItem('studio:advanced', value ? '1' : '0');
		} catch {
			// Preference is optional.
		}
	}

	function openCode() {
		const component = doc.selected?.components[codeIndex];
		if (!component || component.type !== 'codeBlock') return;
		draft = component.code;
		editingCode = true;
	}

	function applyCode() {
		const slot = doc.selected;
		if (slot && codeIndex >= 0) doc.setField(slot.id, codeIndex, 'code', draft);
		editingCode = false;
	}
</script>

<svelte:head><title>Inspector</title></svelte:head>

<div class="shell">
	<header>
		<strong>Inspector</strong>
		{#if doc.readonly && doc.ready}<span class="badge warning">Read only</span>{/if}
		<span class="spacer"></span>
		<label class="advanced"><span>Advanced</span><Checkbox label="Advanced mode" checked={advanced} onchange={setAdvanced} /></label>
		<button class="icon-btn" aria-label="Close inspector" onclick={() => doc.close()}><Icon name="close" /></button>
	</header>

	{#if !doc.ready}
		<div class="waiting muted">Connecting to the world…</div>
	{:else}
		<div class="columns">
			<section class="tree" aria-label="Objects">
				<Hierarchy {doc} onAdd={() => doc.addSlot({ name: 'Object', position: [0, 1.2, -1.2] }, null)} onDelete={() => doc.removeSelected()} />
			</section>
			<section class="details" aria-label="Properties">
				{#if editingCode}
					<div class="code">
						<div class="code-head">
							<strong>Code</strong>
							<span class="muted">Applied when you press Apply.</span>
							<span class="spacer"></span>
							<button class="btn primary" onclick={applyCode}>Apply</button>
							<button class="btn" onclick={() => (editingCode = false)}>Cancel</button>
						</div>
						<textarea class="input" aria-label="Code" spellcheck="false" bind:value={draft}></textarea>
					</div>
				{:else}
					<Inspector {doc} {advanced} onOpenCode={openCode} getViewPose={() => doc.viewPose()}>
						{#snippet footer(selected)}
							<WorldObjectActions
								{doc}
								target={selected}
								{log}
								folders={doc.inventoryFolders}
								onSave={(adapterId) => doc.saveToInventory(selected.id, adapterId)}
								onCreateContainer={() => doc.createContainer()}
							/>
						{/snippet}
					</Inspector>
				{/if}
			</section>
		</div>
	{/if}
</div>

<style>
	:global(html), :global(body) { margin: 0; overflow: hidden; background: #0e1016; }
	.shell { display: flex; flex-direction: column; width: 100vw; height: 100vh; }
	header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--panel); font-size: 18px; }
	.spacer { flex: 1; }
	.advanced { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 14px; }
	.waiting { display: grid; flex: 1; place-items: center; font-size: 18px; }
	.columns { display: grid; flex: 1; grid-template-columns: 340px minmax(0, 1fr); min-height: 0; }
	.tree { min-height: 0; border-right: 1px solid var(--border); background: var(--panel); }
	.details { min-height: 0; min-width: 0; }
	.code { display: flex; flex-direction: column; gap: 8px; height: 100%; padding: 12px; background: var(--panel); }
	.code-head { display: flex; align-items: center; gap: 10px; }
	.code textarea { flex: 1; min-height: 0; resize: none; }
</style>
