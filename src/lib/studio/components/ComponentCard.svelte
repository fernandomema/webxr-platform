<script lang="ts">
	import type { Component } from '$lib/ecs/types';
	import { componentSchema } from '../schema/components';
	import FieldEditor from './FieldEditor.svelte';
	import Icon from '../ui/Icon.svelte';

	interface Props {
		component: Component;
		advanced: boolean;
		onfield: (key: string, value: unknown) => void;
		onremove: () => void;
		onOpenCode?: () => void;
	}

	let { component, advanced, onfield, onremove, onOpenCode }: Props = $props();

	let open = $state(true);
	const schema = $derived(componentSchema(component.type));
	const fields = $derived(schema.fields.filter((field) => advanced || !field.advanced));
</script>

<section class="card">
	<header>
		<button class="toggle" aria-expanded={open} onclick={() => (open = !open)}>
			<Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
			<span class="glyph" aria-hidden="true">{schema.glyph}</span>
			<strong>{schema.label}</strong>
		</button>
		<button class="icon-btn danger" aria-label={`Remove ${schema.label}`} onclick={onremove}><Icon name="trash" size={14} /></button>
	</header>
	{#if open}
		<div class="body">
			{#if fields.length === 0}
				<p class="muted">{schema.description}</p>
			{/if}
			{#each fields as field (field.key)}
				<FieldEditor {field} value={(component as unknown as Record<string, unknown>)[field.key]} onchange={(value) => onfield(field.key, value)} {onOpenCode} />
			{/each}
		</div>
	{/if}
</section>

<style>
	.card { border: 1px solid var(--border); border-radius: 10px; background: var(--panel-2); }
	header { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 2px 2px; }
	.toggle { display: flex; align-items: center; gap: 6px; flex: 1; height: 30px; padding: 0 6px; border: 0; background: transparent; color: var(--text); font: inherit; cursor: pointer; }
	.glyph { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: var(--accent-soft); color: var(--accent); font-size: 11px; }
	.body { display: grid; gap: 8px; padding: 4px 10px 12px; }
	.body p { margin: 0; font-size: 12px; }
</style>
