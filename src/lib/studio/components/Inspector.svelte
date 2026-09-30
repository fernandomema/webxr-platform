<script lang="ts">
	import type { Vec3 } from '$lib/ecs/types';
	import { quatToEuler, roundDisplay } from '$lib/math/euler';
	import type { StudioDocument } from '../state/document.svelte';
	import AddComponentMenu from './AddComponentMenu.svelte';
	import ComponentCard from './ComponentCard.svelte';
	import NumberInput from './NumberInput.svelte';
	import Icon from '../ui/Icon.svelte';
	import { skeletons } from '../state/skeletons.svelte';
	import { normalizeMeshRef, type AssetId } from '$lib/assets/ref';
	import type { Component, Slot } from '$lib/ecs/types';

	interface Props {
		doc: StudioDocument;
		advanced: boolean;
		onOpenCode: () => void;
	}

	let { doc, advanced, onOpenCode }: Props = $props();

	let showAdd = $state(false);

	/** The asset id of the model a slot shows, if it shows one. */
	function modelOf(candidate: Slot | undefined): AssetId | null {
		const mesh = candidate?.components.find((component) => component.type === 'meshRenderer');
		if (!mesh || mesh.type !== 'meshRenderer') return null;
		const ref = normalizeMeshRef(mesh.meshRef);
		return ref.kind === 'asset' ? ref.assetId : null;
	}
	/** The model whose bones a component refers to: an avatar's own, or for a bone attachment the nearest ancestor's. */
	function boneModelFor(component: Component): AssetId | null {
		if (!slot) return null;
		if (component.type === 'avatar') return modelOf(slot);
		if (component.type !== 'boneAttach') return null;
		for (let parent = slot.parentId ? doc.tree.find((s) => s.id === slot.parentId) : undefined; parent; parent = parent.parentId ? doc.tree.find((s) => s.id === parent!.parentId) : undefined) {
			const model = modelOf(parent);
			if (model) return model;
		}
		return null;
	}
	$effect(() => {
		for (const component of slot?.components ?? []) {
			const model = boneModelFor(component);
			if (model) void skeletons.ensure(model);
		}
	});
	const slot = $derived(doc.selected);
	const euler = $derived(slot ? (quatToEuler(slot.rotation).map((value) => roundDisplay(value, 2)) as Vec3) : ([0, 0, 0] as Vec3));

	function setAxis(kind: 'position' | 'rotation' | 'scale', axis: number, value: number) {
		if (!slot) return;
		const next = [...(kind === 'rotation' ? euler : slot[kind])] as Vec3;
		next[axis] = value;
		if (kind === 'position') doc.setPosition(slot.id, next);
		else if (kind === 'scale') doc.setScale(slot.id, next);
		else doc.setRotationEuler(slot.id, next);
	}

	const rows = [
		{ kind: 'position', label: 'Position', step: 0.1 },
		{ kind: 'rotation', label: 'Rotation', step: 5 },
		{ kind: 'scale', label: 'Scale', step: 0.1 }
	] as const;
</script>

<aside class="inspector" aria-label="Inspector">
	{#if !slot}
		<div class="empty">
			<Icon name="sliders" size={22} />
			<strong>Nothing selected</strong>
			Pick an object in the hierarchy or click it in the 3D view.
		</div>
	{:else}
		<div class="section">
			<label class="name">
				<span class="sr-only">Name</span>
				<input class="input" value={slot.name} oninput={(event) => doc.renameSlot(slot.id, event.currentTarget.value)} aria-label="Object name" />
			</label>
		</div>

		<div class="section">
			<h3>Transform</h3>
			{#each rows as row (row.kind)}
				<div class="transform">
					<span class="row-label">{row.label}{row.kind === 'rotation' ? ' °' : ''}</span>
					<div class="vec">
						{#each ['X', 'Y', 'Z'] as axis, index (axis)}
							<NumberInput
								prefix={axis}
								label={`${row.label} ${axis}`}
								step={row.step}
								value={row.kind === 'rotation' ? euler[index] : slot[row.kind][index]}
								onchange={(value) => setAxis(row.kind, index, value)}
							/>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<div class="section grow">
			<div class="head">
				<h3>Components</h3>
				<div class="add">
					<button class="btn sm" aria-haspopup="menu" aria-expanded={showAdd} onclick={() => (showAdd = !showAdd)}><Icon name="plus" size={12} />Add</button>
					{#if showAdd}
						<AddComponentMenu
							{advanced}
							onclose={() => (showAdd = false)}
							onpick={(type) => { doc.addComponent(slot.id, type); showAdd = false; }}
						/>
					{/if}
				</div>
			</div>
			<div class="list">
				{#each slot.components as component, index (`${slot.id}:${index}:${component.type}`)}
					<ComponentCard
						{component}
						{advanced}
						onfield={(key, value) => doc.setField(slot.id, index, key, value)}
						onremove={() => doc.removeComponent(slot.id, index)}
						{onOpenCode}
						joints={skeletons.get(boneModelFor(component)) ?? []}
					/>
				{:else}
					<div class="empty small">No components yet. This object is just a group and a position.</div>
				{/each}
			</div>
		</div>
	{/if}
</aside>

<style>
	.inspector { display: flex; flex-direction: column; height: 100%; overflow-y: auto; background: var(--panel); }
	.section { display: grid; gap: 8px; padding: 12px; border-bottom: 1px solid var(--border); }
	.section.grow { flex: 1; border-bottom: 0; align-content: start; }
	h3 { margin: 0; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
	.name .input { height: 34px; font-size: 14px; font-weight: 600; }
	.transform { display: grid; grid-template-columns: 70px 1fr; align-items: center; gap: 8px; }
	.row-label { color: var(--muted); font-size: 12px; }
	.vec { display: flex; gap: 4px; }
	.head { display: flex; align-items: center; justify-content: space-between; }
	.add { position: relative; }
	.list { display: grid; gap: 8px; }
	.small { padding: 16px 8px; font-size: 12px; }
</style>
