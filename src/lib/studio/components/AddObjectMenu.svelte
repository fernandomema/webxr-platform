<script lang="ts" module>
	import type { Component } from '$lib/ecs/types';
	import type { IconName } from '../ui/Icon.svelte';
	export interface ObjectPreset {
		id: string;
		label: string;
		icon: IconName;
		name: string;
		position: [number, number, number];
		components: Component[];
		advanced?: boolean;
	}
</script>

<script lang="ts">
	import Icon from '../ui/Icon.svelte';

	interface Props {
		advanced: boolean;
		onpick: (preset: ObjectPreset) => void;
		onclose: () => void;
	}

	let { advanced, onpick, onclose }: Props = $props();

	const PRESETS: ObjectPreset[] = [
		{ id: 'cube', label: 'Cube', icon: 'cube', name: 'Cube', position: [0, 0.5, 0], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#8b7cf6' }, { type: 'collider', shape: 'box' }, { type: 'grabbable', scalable: true }] },
		{ id: 'sphere', label: 'Sphere', icon: 'cube', name: 'Sphere', position: [0, 0.5, 0], components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#4fd1c5' }, { type: 'collider', shape: 'sphere' }, { type: 'grabbable', scalable: true }] },
		{ id: 'text', label: 'Text label', icon: 'layers', name: 'Text', position: [0, 1.5, 0], components: [{ type: 'textDisplay', title: 'Hello', lines: ['Edit this text'] }] },
		{ id: 'ui-panel', label: 'UI panel', icon: 'layers', name: 'UI Panel', position: [0, 1.5, 0], components: [{ type: 'uiPanel', width: 1024, height: 640, worldWidth: 1.2, background: '#111827' }] },
		{ id: 'ui-container', label: 'UI container', icon: 'layers', name: 'UI Container', position: [0, 0, 0], components: [{ type: 'uiElement', kind: 'container', flexDirection: 'column', visible: true, gap: 8, padding: 12, width: 920 }] },
		{ id: 'ui-text', label: 'UI text', icon: 'layers', name: 'UI Text', position: [0, 0, 0], components: [{ type: 'uiElement', kind: 'text', text: 'Hello', width: 880, height: 40, color: '#ffffff', fontSize: 28 }] },
		{ id: 'ui-button', label: 'UI button', icon: 'layers', name: 'UI Button', position: [0, 0, 0], components: [{ type: 'uiElement', kind: 'button', text: 'Button', width: 240, height: 48, color: '#ffffff', background: '#2563eb' }] },
		{ id: 'ui-input', label: 'UI text input', icon: 'layers', name: 'UI Input', position: [0, 0, 0], components: [{ type: 'uiElement', kind: 'input', placeholder: 'Type here', width: 880, height: 48, fontSize: 24 }] },
		{ id: 'ui-image', label: 'UI image', icon: 'layers', name: 'UI Image', position: [0, 0, 0], components: [{ type: 'uiElement', kind: 'image', src: '', width: 320, height: 180 }] },
		{ id: 'ui-video', label: 'UI video', icon: 'layers', name: 'UI Video', position: [0, 0, 0], components: [{ type: 'uiElement', kind: 'video', src: '', width: 640, height: 360, playing: false, loop: false, muted: false, volume: 1 }] },
		{ id: 'group', label: 'Empty group', icon: 'folder', name: 'Group', position: [0, 0, 0], components: [] },
		{ id: 'logic', label: 'Logic node', icon: 'code', name: 'Logic node', position: [0, 0, 0], components: [], advanced: true }
	];

	let root = $state<HTMLDivElement>();
	const visible = $derived(PRESETS.filter((preset) => advanced || !preset.advanced));
</script>

<svelte:window onpointerdown={(event) => root && !root.contains(event.target as Node) && onclose()} onkeydown={(event) => event.key === 'Escape' && onclose()} />

<div class="menu" bind:this={root} role="menu" aria-label="Add object">
	{#each visible as preset (preset.id)}
		<button class="menu-item" role="menuitem" onclick={() => onpick(preset)}><Icon name={preset.icon} size={14} />{preset.label}</button>
	{/each}
</div>

<style>
	.menu { top: 42px; right: 8px; min-width: 180px; }
</style>
