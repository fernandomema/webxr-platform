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
