<script lang="ts">
	import { parseFragment } from '@kithin/engine/assets/fragment';
	import { decodeTexelsAsync } from '@kithin/engine/lighting/format';
	import type { AssetManifest } from '@kithin/engine/assets/manifest';
	import Icon, { type IconName } from '../ui/Icon.svelte';
	import ModelViewer from './ModelViewer.svelte';

	interface Props {
		manifest: AssetManifest;
		/** The file's bytes, or null while they load or when they cannot be had. */
		bytes: Uint8Array | null;
		loading: boolean;
		icon: IconName;
	}

	let { manifest, bytes, loading, icon }: Props = $props();

	let url = $state<string | null>(null);
	$effect(() => {
		url = null;
		if (!bytes || (manifest.type !== 'image' && manifest.type !== 'audio')) return;
		const created = URL.createObjectURL(new Blob([bytes as BlobPart], { type: manifest.mimeType }));
		url = created;
		return () => URL.revokeObjectURL(created);
	});

	const slotNames = $derived.by(() => {
		if (manifest.type !== 'fragment' || !bytes) return null;
		try { return parseFragment(bytes).slots.map((slot) => slot.name || slot.id); } catch { return null; }
	});

	// A baked lighting volume is drawn as one horizontal slice through its middle: what the light looks like at standing height.
	let slice: HTMLCanvasElement | undefined = $state();
	$effect(() => {
		if (manifest.type !== 'lightmap' || !bytes || !slice) return;
		let alive = true;
		const target = slice;
		void decodeTexelsAsync(bytes).then(({ header, texels }) => {
			if (!alive) return;
			const [nx, ny, nz] = header.spec.dims;
			const y = Math.floor(ny / 2);
			target.width = nx;
			target.height = nz;
			const context = target.getContext('2d');
			if (!context) return;
			const image = context.createImageData(nx, nz);
			for (let z = 0; z < nz; z++) {
				for (let x = 0; x < nx; x++) {
					const from = ((z * ny + y) * nx + x) * 4;
					const to = (z * nx + x) * 4;
					image.data.set(texels.subarray(from, from + 4), to);
				}
			}
			context.putImageData(image, 0, 0);
		}).catch(() => {});
		return () => { alive = false; };
	});
</script>

<div class="stage" class:model={manifest.type === 'model' && !!bytes}>
	{#if loading}
		<span class="muted">Loading…</span>
	{:else if !bytes}
		<Icon name={icon} size={40} />
		<span class="muted note">Preview not available right now.</span>
	{:else if manifest.type === 'model'}
		<ModelViewer {bytes} />
	{:else if manifest.type === 'image' && url}
		<img src={url} alt={manifest.name} />
	{:else if manifest.type === 'audio' && url}
		<Icon name="music" size={40} />
		<!-- svelte-ignore a11y_media_has_caption -->
		<audio src={url} controls></audio>
	{:else if manifest.type === 'lightmap'}
		<canvas class="slice" bind:this={slice} aria-label="Lighting slice"></canvas>
	{:else if slotNames}
		<ul class="slots">{#each slotNames.slice(0, 40) as name, index (index)}<li>{name}</li>{/each}{#if slotNames.length > 40}<li class="muted">+{slotNames.length - 40} more</li>{/if}</ul>
	{:else}
		<Icon name={icon} size={40} />
	{/if}
</div>

<style>
	.stage { position: relative; display: grid; place-items: center; gap: 8px; min-height: 160px; max-height: 260px; overflow: hidden; border-radius: 8px; background: var(--panel-3); color: var(--muted); }
	.stage.model { height: 240px; }
	img { width: 100%; max-height: 260px; object-fit: contain; }
	audio { width: calc(100% - 24px); margin-bottom: 12px; }
	.slice { width: 100%; max-height: 260px; object-fit: contain; image-rendering: pixelated; }
	.slots { align-self: stretch; margin: 0; padding: 10px 14px; overflow: auto; list-style: none; color: var(--text); font-size: 12px; }
	.note { font-size: 12px; }
</style>
