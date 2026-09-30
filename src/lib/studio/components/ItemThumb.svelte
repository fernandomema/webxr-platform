<script lang="ts">
	import type { AssetId } from '$lib/assets/ref';
	import { thumbnailUrl } from '$lib/assets/thumbnails';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		/** The item's preview image, if it has one. */
		assetId?: string | null;
		/** Shown while it loads, and when there is none. */
		icon: 'cube' | 'world' | 'user' | 'folder';
		/** Icon size in pixels; the image fills whatever box holds this component. */
		iconSize?: number;
	}

	let { assetId, icon, iconSize = 20 }: Props = $props();

	let url = $state<string | null>(null);

	$effect(() => {
		const id = assetId;
		url = null;
		if (!id) return;
		let current = true;
		void thumbnailUrl(id as AssetId).then((found) => {
			if (current) url = found;
		});
		return () => {
			current = false;
		};
	});
</script>

{#if url}
	<!-- A 360° world preview is twice as wide as tall; cover crops it to the middle, which looks straight ahead from the spawn. -->
	<img class="thumb" src={url} alt="" draggable="false" />
{:else}
	<Icon name={icon} size={iconSize} />
{/if}

<style>
	.thumb { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; border-radius: inherit; }
</style>
