<script lang="ts">
	import { isAssetId } from '$lib/assets/ref';
	import { thumbnailUrl } from '$lib/assets/thumbnails';

	interface Props {
		/** `user.image`: an asset id (uploaded picture), an external URL (e.g. Discord), or empty. */
		image: string | null | undefined;
		name: string;
		size?: number;
	}

	let { image, name, size = 64 }: Props = $props();
	let src = $state<string | null>(null);

	$effect(() => {
		const current = image;
		src = null;
		if (!current) return;
		if (!isAssetId(current)) { src = current; return; }
		let live = true;
		void thumbnailUrl(current).then((url) => { if (live) src = url; });
		return () => { live = false; };
	});

	const initial = $derived(name.trim().charAt(0).toUpperCase() || '?');
</script>

{#if src}
	<img {src} alt="" width={size} height={size} class="shrink-0 rounded-full object-cover" style="width: {size}px; height: {size}px" referrerpolicy="no-referrer" />
{:else}
	<span class="inline-grid shrink-0 place-items-center rounded-full bg-iris/20 font-display font-semibold text-iris" style="width: {size}px; height: {size}px; font-size: {size * 0.42}px" aria-hidden="true">{initial}</span>
{/if}
