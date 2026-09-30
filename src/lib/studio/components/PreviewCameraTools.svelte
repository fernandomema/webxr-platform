<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Slot } from '$lib/ecs/types';
	import { CloudResolver } from '$lib/assets/cloud';
	import { quatToEuler, roundDisplay } from '$lib/math/euler';
	import { isAvatarTree } from '../../xr/avatar/build';
	import type { Q4, V3 } from '../../xr/avatar/ik';
	import { localPose } from '../../xr/thumbnail/cameraPose';
	import { renderObjectThumbnail, renderWorldPanorama } from '../../xr/thumbnail/renderThumbnail';
	import type { InspectorDocument } from '../state/docOps';
	import Tooltip from '../ui/Tooltip.svelte';
	import { studioSession } from '../state/session.svelte';
	import { toasts } from '../state/toasts.svelte';

	interface Props {
		doc: InspectorDocument;
		slot: Slot;
		/** The pose of the editor's camera in the world, or null if the viewport is not ready. May answer later. */
		getViewPose: () => { position: V3; rotation: Q4 } | null | Promise<{ position: V3; rotation: Q4 } | null>;
	}

	let { doc, slot, getViewPose }: Props = $props();

	let busy = $state(false);
	let image = $state<string | null>(null);
	let panorama = $state(false);

	onDestroy(() => image && URL.revokeObjectURL(image));

	/** True when this slot is more than a camera: it draws something, or holds other slots, and would carry them along when moved. */
	const sharesSlot = $derived(slot.components.some((component) => component.type !== 'previewCamera') || doc.tree.some((other) => other.parentId === slot.id));

	/** Gives the camera a slot of its own, at the same place, so moving it no longer moves what shares its slot. */
	function separate() {
		const index = slot.components.findIndex((component) => component.type === 'previewCamera');
		if (index < 0) return;
		const component = slot.components[index];
		doc.removeComponent(slot.id, index);
		doc.addSlot({ name: 'Preview Camera', position: [0, 0, 0], components: [component] }, slot.id);
	}

	/** Puts this slot where the editor's camera is now, looking the same way, whatever slot it is nested in. */
	async function useEditorView() {
		const view = await getViewPose();
		if (!view) return toasts.error(new Error('The viewport is not ready yet.'), 'Could not read the editor view');
		const local = localPose(doc.tree, slot.parentId, view);
		doc.setPosition(slot.id, local.position);
		doc.setRotationEuler(slot.id, quatToEuler(local.rotation).map((value) => roundDisplay(value, 2)) as [number, number, number]);
	}

	/** Draws the preview the way it will be saved, so the framing can be judged before saving. */
	async function preview() {
		busy = true;
		try {
			const tree = JSON.parse(JSON.stringify(doc.tree));
			const cloud = studioSession.userId ? [new CloudResolver()] : [];
			const blob = doc.kind === 'world' ? await renderWorldPanorama(tree, { getResolvers: () => cloud }) : await renderObjectThumbnail(tree, isAvatarTree(tree) ? 'avatar' : 'object', { getResolvers: () => cloud });
			if (!blob) throw new Error('Nothing to draw yet.');
			if (image) URL.revokeObjectURL(image);
			image = URL.createObjectURL(blob);
			panorama = doc.kind === 'world';
		} catch (error) {
			toasts.error(error, 'Could not draw the preview');
		} finally {
			busy = false;
		}
	}
</script>

<div class="tools">
	{#if sharesSlot}
		<p class="warn">This slot also holds an object, so moving the camera moves the object with it.</p>
		<button class="btn sm" onclick={separate}>Move the camera to its own slot</button>
	{/if}
	<div class="buttons">
		<Tooltip text="Move this slot to where the editor camera is, looking the same way" side="top"><button class="btn sm" onclick={() => void useEditorView()}>Use editor view</button></Tooltip>
		<button class="btn sm" disabled={busy} onclick={preview}>{busy ? 'Drawing…' : 'Preview'}</button>
	</div>
	{#if image}
		<img class="shot" class:wide={panorama} src={image} alt="How the saved preview will look" />
		{#if panorama}<p class="muted">The saved preview is this 360° picture; lists show its middle.</p>{/if}
	{:else}
		<p class="muted">Place the slot where the picture should be taken from. It looks along its forward direction (blue axis).</p>
	{/if}
</div>

<style>
	.tools { display: grid; gap: 8px; margin: -2px 0 10px; padding: 8px 10px; border: 1px dashed var(--border); border-radius: 10px; }
	.buttons { display: flex; gap: 6px; flex-wrap: wrap; }
	.shot { width: 100%; max-width: 256px; aspect-ratio: 1; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); }
	.shot.wide { max-width: 100%; aspect-ratio: 2; }
	p { margin: 0; font-size: 12px; }
	.warn { color: var(--warning, #f0b44c); }
</style>
