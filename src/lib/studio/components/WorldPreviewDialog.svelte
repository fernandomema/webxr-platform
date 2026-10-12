<script lang="ts">
	import type { Component, Slot, SlotTree } from '$lib/ecs/types';
	import { CloudResolver } from '$lib/assets/cloud';
	import { thumbnailUrl } from '$lib/assets/thumbnails';
	import { captureItemThumbnail } from '../../xr/thumbnail/capture';
	import { localPose } from '../../xr/thumbnail/cameraPose';
	import type { Q4, V3 } from '../../xr/avatar/ik';
	import { CAPTURE_CAMERA_NAME } from '../lighting/bakeText';
	import type { InspectorDocument } from '../state/docOps';
	import { studioAssets } from '../state/models.svelte';
	import { studioSession } from '../state/session.svelte';
	import { toasts } from '../state/toasts.svelte';

	interface Props {
		doc: InspectorDocument;
		/** The slot that holds the world settings. */
		slot: Slot;
		/** The pose of the editor's camera in the world, or null if the viewport is not ready. May answer later. */
		getViewPose: () => { position: V3; rotation: Q4 } | null | Promise<{ position: V3; rotation: Q4 } | null>;
		onclose: () => void;
	}

	let { doc, slot, getViewPose, onclose }: Props = $props();

	let capturing = $state(false);
	let imageUrl = $state<string | null>(null);

	const settingsIndex = $derived(slot.components.findIndex((component) => component.type === 'worldSettings'));
	const preview = $derived((slot.components[settingsIndex] as Extract<Component, { type: 'worldSettings' }> | undefined)?.preview);

	$effect(() => {
		const source = preview;
		imageUrl = null;
		if (source?.kind !== 'asset') return;
		let current = true;
		void thumbnailUrl(source.assetId).then((found) => { if (current) imageUrl = found; });
		return () => { current = false; };
	});

	/** Takes the 360° picture from where the editor camera is now and keeps it as this world's preview. */
	async function captureFromView() {
		if (capturing || settingsIndex < 0) return;
		capturing = true;
		try {
			const view = await getViewPose();
			if (!view) throw new Error('The viewport is not ready yet.');
			// A copy of the world with the camera where the editor is, and no other Preview Camera to take precedence.
			const tree: SlotTree = JSON.parse(JSON.stringify(doc.tree));
			for (const candidate of tree) candidate.components = candidate.components.filter((component) => component.type !== 'previewCamera');
			const pose = localPose(tree, null, view);
			tree.push({ id: 'preview-camera-capture', name: CAPTURE_CAMERA_NAME, parentId: null, position: pose.position, rotation: pose.rotation, scale: [1, 1, 1], components: [{ type: 'previewCamera' } as Component] } as Slot);
			const cloud = studioSession.userId ? [new CloudResolver()] : [];
			const assetId = await captureItemThumbnail(tree, 'world', { name: doc.tree.find((candidate) => candidate.parentId === null)?.name, getResolvers: () => cloud });
			if (!assetId) throw new Error('The picture could not be taken. Try again.');
			doc.setField(slot.id, settingsIndex, 'preview', { kind: 'asset', assetId });
			await studioAssets.refresh();
			toasts.success('360° preview captured. Save to keep it.');
		} catch (error) { toasts.error(error, 'Could not capture the 360° preview'); }
		finally { capturing = false; }
	}

	/** Uses a picture from a file (or one already in the library) instead of taking one. */
	async function chooseImage() {
		if (settingsIndex < 0) return;
		const [chosen] = await studioAssets.pickAndImport('image');
		if (chosen) doc.setField(slot.id, settingsIndex, 'preview', { kind: 'asset', assetId: chosen.assetId });
	}

	function clearPreview() {
		if (settingsIndex >= 0) doc.setField(slot.id, settingsIndex, 'preview', undefined);
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="studio-backdrop" onclick={(event) => event.target === event.currentTarget && onclose()}>
	<div class="studio-modal" role="dialog" aria-modal="true" aria-label="360° preview">
		<h2>360° preview</h2>
		<p>The picture that stands for this world. Without one, it is taken from the Preview Camera when you save.</p>
		{#if imageUrl}<img class="shot" src={imageUrl} alt="The 360° preview of this world" />{/if}
		<div class="actions">
			{#if preview}<button class="btn" disabled={doc.readonly} onclick={clearPreview}>Use the Preview Camera</button>{/if}
			<button class="btn" disabled={doc.readonly} onclick={() => void chooseImage()}>Choose image…</button>
			<button class="btn" onclick={onclose}>Close</button>
			<button class="btn primary" disabled={capturing || doc.readonly || settingsIndex < 0} onclick={() => void captureFromView()}>{capturing ? 'Capturing…' : 'Capture from editor view'}</button>
		</div>
	</div>
</div>

<style>
	.shot { width: 100%; aspect-ratio: 2; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); }
</style>
