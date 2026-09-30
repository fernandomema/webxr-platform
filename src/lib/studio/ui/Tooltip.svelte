<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		text: string;
		/** What the tip is for. With no children the tip is a small "?" that also opens on tap, which a headset laser or a phone needs. */
		children?: Snippet;
		side?: 'top' | 'bottom';
		align?: 'start' | 'end';
	}

	let { text, children, side = 'bottom', align = 'start' }: Props = $props();

	let pinned = $state(false);
</script>

<!-- A tip drawn in the page: the native `title` popup is not part of the document, so the XR rasterizer never shows it. -->
<span class="tip" class:pinned>
	{#if children}
		{@render children()}
	{:else}
		<button type="button" class="help" aria-label="Help: {text}" aria-expanded={pinned} onclick={() => (pinned = !pinned)}>?</button>
	{/if}
	<span class="bubble {side} {align}" role="tooltip">{text}</span>
</span>

<style>
	.tip { position: relative; display: inline-flex; }
	.help { display: inline-grid; place-items: center; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%; background: var(--panel-3); color: var(--muted); font: 600 10px var(--font); cursor: help; }
	.bubble {
		position: absolute; z-index: 50; display: none; width: max-content; max-width: 240px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px;
		background: var(--panel-3); color: var(--text); font: 12px/1.4 var(--font); font-weight: 400; text-transform: none; letter-spacing: 0; white-space: normal; pointer-events: none;
		box-shadow: 0 8px 20px rgb(0 0 0 / 0.45);
	}
	.bubble.bottom { top: calc(100% + 6px); }
	.bubble.top { bottom: calc(100% + 6px); }
	.bubble.start { left: 0; }
	.bubble.end { right: 0; }
	.tip:hover > .bubble, .tip:global([data-xr-hover]) > .bubble, .tip:focus-within > .bubble, .tip.pinned > .bubble { display: block; }
</style>
