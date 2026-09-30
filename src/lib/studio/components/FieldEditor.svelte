<script lang="ts">
	import type { FieldDef } from '../schema/components';
	import NumberInput from './NumberInput.svelte';
	import Icon from '../ui/Icon.svelte';
	import { handPreview } from '../state/handPreview.svelte';
	import type { EquipPose } from '$lib/ecs/types';
	import { assetMesh, assetSource, BUILTIN_MESH_IDS, isAssetId, normalizeMeshRef, normalizeSourceRef, urlSource, type BuiltinMeshId } from '$lib/assets/ref';
	import { studioAssets, studioModels } from '../state/models.svelte';
	import BoneMapEditor from './BoneMapEditor.svelte';
	import Select, { type SelectGroup, type SelectOption } from '../ui/Select.svelte';
	import Checkbox from '../ui/Checkbox.svelte';
	import ColorInput from '../ui/ColorInput.svelte';
	import Combobox from '../ui/Combobox.svelte';
	import Tooltip from '../ui/Tooltip.svelte';
	import type { HumanoidMap } from '../../xr/avatar/humanoid';

	interface Props {
		field: FieldDef;
		value: unknown;
		/** `undefined` clears an optional field. */
		onchange: (value: unknown) => void;
		onOpenCode?: () => void;
		/** The bones of the model this field belongs to, for the bone editors. */
		joints?: readonly string[];
	}

	let { field, value, onchange, onOpenCode, joints = [] }: Props = $props();

	const id = $props.id();
	let jsonDraft = $state<string | null>(null);
	let jsonError = $state('');

	const unset = $derived(value === undefined);
	const fallback = $derived.by(() => {
		switch (field.kind) {
			case 'number': return field.default ?? field.min ?? 0;
			case 'text': case 'url': return field.default ?? '';
			case 'bool': return field.default ?? false;
			case 'color': return field.default ?? '#ffffff';
			case 'enum': return field.default ?? field.options[0]?.value;
			case 'vec3': return field.default ?? [0, 0, 0];
			default: return undefined;
		}
	});

	function meshOptions(current: string, known: boolean): (SelectOption | SelectGroup)[] {
		return [
			{ label: 'Shapes', options: BUILTIN_MESH_IDS.map((meshId) => ({ value: meshId, label: meshId[0].toUpperCase() + meshId.slice(1) })) },
			{
				label: 'Models',
				options: [
					...studioModels.items.map((model) => ({ value: model.assetId, label: model.name })),
					...(known ? [] : [{ value: current, label: `Model ${current.slice(7, 15)}… (not on this device)`, disabled: true }]),
					{ value: '__import', label: 'Import a .glb…' }
				]
			}
		];
	}

	function assetOptions(choices: { assetId: string; name: string }[], missing: string | null): (SelectOption | SelectGroup)[] {
		return [
			{ value: '__url', label: 'From a URL' },
			{
				label: 'Imported',
				options: [
					...choices.map((item) => ({ value: item.assetId, label: item.name })),
					...(missing ? [{ value: missing, label: `${missing.slice(7, 15)}… (not on this device)`, disabled: true }] : []),
					{ value: '__import', label: 'Import a file…' }
				]
			}
		];
	}

	function boneOptions(current: string): SelectOption[] {
		return [
			{ value: '', label: '— choose a bone —' },
			...(current && !joints.includes(current) ? [{ value: current, label: `${current} (not in model)`, disabled: true }] : []),
			...joints.map((joint) => ({ value: joint, label: joint }))
		];
	}

	function vec(index: number, next: number) {
		const current = Array.isArray(value) ? [...(value as number[])] : [0, 0, 0];
		current[index] = next;
		onchange(current);
	}

	function pose(): EquipPose {
		const current = value as Partial<EquipPose> | undefined;
		return { position: current?.position ?? [0, 0, 0], rotation: current?.rotation ?? [0, 0, 0] };
	}

	function setPose(part: 'position' | 'rotation', index: number, next: number) {
		const current = pose();
		const list = [...current[part]] as [number, number, number];
		list[index] = next;
		onchange({ ...current, [part]: list });
	}

	function commitJson(text: string) {
		jsonDraft = text;
		try {
			onchange(JSON.parse(text));
			jsonError = '';
		} catch (error) {
			jsonError = error instanceof Error ? error.message : 'Invalid JSON';
		}
	}
</script>

<div class="field" class:wide={field.kind === 'pose' || field.kind === 'boneMap'}>
	<label class="label" for={id}>
		{field.label}
		{#if field.help}<Tooltip text={field.help} />{/if}
	</label>

	<div class="control">
		{#if field.optional && unset}
			<button class="btn sm" onclick={() => onchange(fallback)}><Icon name="plus" size={12} />Set</button>
		{:else if field.kind === 'number'}
			<NumberInput value={Number(value ?? 0)} label={field.label} min={field.min} max={field.max} step={field.step ?? 1} onchange={onchange} />
			{#if field.unit}<span class="unit">{field.unit}</span>{/if}
		{:else if field.kind === 'text'}
			{#if field.multiline}
				<textarea class="input" {id} rows="3" value={String(value ?? '')} oninput={(event) => onchange(event.currentTarget.value)}></textarea>
			{:else}
				{#if field.suggestions}
					<Combobox {id} label={field.label} value={String(value ?? '')} suggestions={field.suggestions} {onchange} />
				{:else}
					<input class="input" {id} value={String(value ?? '')} oninput={(event) => onchange(event.currentTarget.value)} />
				{/if}
			{/if}
		{:else if field.kind === 'url'}
			<input class="input" {id} type="url" placeholder="https://…" value={String(value ?? '')} oninput={(event) => onchange(event.currentTarget.value)} />
		{:else if field.kind === 'bool'}
			<Checkbox {id} label={field.label} checked={Boolean(value ?? fallback)} {onchange} />
		{:else if field.kind === 'color'}
			<ColorInput {id} label={field.label} value={String(value ?? '#ffffff')} {onchange} />
		{:else if field.kind === 'enum'}
			<Select {id} label={field.label} value={String(value ?? '')} options={field.options} {onchange} />
		{:else if field.kind === 'vec3'}
			<div class="vec">
				{#each ['X', 'Y', 'Z'] as axis, index (axis)}
					<NumberInput prefix={axis} label={`${field.label} ${axis}`} step={field.step ?? 0.1} value={Array.isArray(value) ? Number(value[index] ?? 0) : 0} onchange={(next) => vec(index, next)} />
				{/each}
			</div>
		{:else if field.kind === 'mesh'}
			{@const mesh = normalizeMeshRef(value)}
			{@const current = mesh.kind === 'builtin' ? mesh.id : mesh.assetId}
			{@const known = mesh.kind === 'builtin' || studioModels.byId(mesh.assetId) !== undefined}
			<Select
				{id}
				label={field.label}
				value={current}
				options={meshOptions(current, known)}
				onchange={async (next) => {
					if (next === '__import') {
						const [first] = await studioModels.pickAndImport();
						if (first) onchange(assetMesh(first.assetId));
					} else if (isAssetId(next)) onchange(assetMesh(next));
					else onchange({ kind: 'builtin', id: next as BuiltinMeshId });
				}}
			/>
		{:else if field.kind === 'asset'}
			{@const source = normalizeSourceRef(value)}
			{@const choices = studioAssets.items.filter((item) => item.type === field.assetType)}
			{@const known = source.kind !== 'asset' || choices.some((item) => item.assetId === source.assetId)}
			<div class="asset-field">
				<Select
					{id}
					label={field.label}
					value={source.kind === 'asset' ? source.assetId : '__url'}
					options={assetOptions(choices, source.kind === 'asset' && !known ? source.assetId : null)}
					onchange={async (next) => {
						if (next === '__import') {
							const [first] = await studioAssets.pickAndImport(field.assetType);
							if (first) onchange(assetSource(first.assetId));
						} else if (isAssetId(next)) onchange(assetSource(next));
						else onchange(urlSource(source.kind === 'url' ? source.url : ''));
					}}
				/>
				{#if source.kind === 'url'}
					<input class="input" type="url" placeholder="https://…" aria-label={field.label} value={source.url} oninput={(event) => onchange(urlSource(event.currentTarget.value))} />
				{/if}
			</div>
		{:else if field.kind === 'pose'}
			<div class="pose">
				{#each [['position', 'Pos', 0.01], ['rotation', 'Rot °', 5]] as const as [part, label, step] (part)}
					<div class="pose-row">
						<span class="unit">{label}</span>
						<div class="vec">
							{#each ['X', 'Y', 'Z'] as axis, index (axis)}
								<NumberInput prefix={axis} label={`${field.label} ${label} ${axis}`} {step} value={pose()[part][index]} onchange={(next) => setPose(part, index, next)} />
							{/each}
						</div>
					</div>
				{/each}
				<button class="btn sm" aria-pressed={handPreview.hand === (field.key as 'left' | 'right')} onclick={() => handPreview.toggle(field.key as 'left' | 'right')}>
					<Icon name="cube" size={12} />{handPreview.hand === field.key ? 'Stop previewing' : 'Preview in hand'}
				</button>
			</div>
		{:else if field.kind === 'lines'}
			<textarea class="input" {id} rows="3" value={Array.isArray(value) ? (value as string[]).join('\n') : ''} oninput={(event) => onchange(event.currentTarget.value.split('\n'))}></textarea>
		{:else if field.kind === 'code'}
			<button class="btn sm" onclick={() => onOpenCode?.()} disabled={!onOpenCode}><Icon name="code" size={12} />Edit code</button>
			<span class="unit">{String(value ?? '').split('\n').length} lines</span>
		{:else if field.kind === 'boneMap'}
			<BoneMapEditor value={(value ?? {}) as HumanoidMap} {joints} onchange={(map) => onchange(map)} />
		{:else if field.kind === 'bone'}
			{#if joints.length}
				<Select {id} label={field.label} searchable value={String(value ?? '')} options={boneOptions(String(value ?? ''))} {onchange} placeholder="— choose a bone —" />
			{:else}
				<input class="input" {id} value={String(value ?? '')} placeholder="Bone name" oninput={(event) => onchange(event.currentTarget.value)} />
				<span class="unit">parent model has no bones on this device</span>
			{/if}
		{:else if field.kind === 'json'}
			<textarea class="input" {id} rows="4" aria-invalid={jsonError ? 'true' : undefined} value={jsonDraft ?? JSON.stringify(value ?? null, null, 2)} oninput={(event) => commitJson(event.currentTarget.value)} onblur={() => { if (!jsonError) jsonDraft = null; }}></textarea>
		{/if}

		{#if field.optional && !unset}
			<button class="icon-btn" aria-label={`Clear ${field.label}`} onclick={() => onchange(undefined)}><Icon name="close" size={12} /></button>
		{/if}
	</div>
	{#if jsonError}<p class="error" role="alert">{jsonError}</p>{/if}
</div>

<style>
	.field { display: grid; grid-template-columns: var(--label-w, 96px) 1fr; align-items: start; gap: 8px; }
	.field.wide { grid-template-columns: 1fr; gap: 4px; }
	.field.wide .label { min-height: 0; }
	.label { display: flex; align-items: center; gap: 4px; min-height: var(--control-h, 30px); color: var(--muted); font-size: 12px; }
	.control { display: flex; align-items: center; gap: 6px; min-width: 0; }
	.control > :global(textarea) { flex: 1; }
	.vec { display: flex; gap: 4px; width: 100%; }
	.pose { display: grid; gap: 6px; width: 100%; }
	.pose-row { display: grid; grid-template-columns: 42px 1fr; align-items: center; gap: 4px; }
	.btn[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); }
	.unit { color: var(--muted); font-size: 11px; white-space: nowrap; }
	.error { grid-column: 2; margin: 0; color: var(--danger); font-size: 11px; }
	.asset-field { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
</style>
