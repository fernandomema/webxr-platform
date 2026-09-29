<script lang="ts">
	import type { FieldDef } from '../schema/components';
	import NumberInput from './NumberInput.svelte';
	import Icon from '../ui/Icon.svelte';
	import { handPreview } from '../state/handPreview.svelte';
	import type { EquipPose } from '$lib/ecs/types';

	interface Props {
		field: FieldDef;
		value: unknown;
		/** `undefined` clears an optional field. */
		onchange: (value: unknown) => void;
		onOpenCode?: () => void;
	}

	let { field, value, onchange, onOpenCode }: Props = $props();

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

<div class="field" class:wide={field.kind === 'pose'}>
	<label class="label" for={id}>
		{field.label}
		{#if field.help}<span class="help" title={field.help}>?</span>{/if}
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
				<input class="input" {id} list={field.suggestions ? `${id}-list` : undefined} value={String(value ?? '')} oninput={(event) => onchange(event.currentTarget.value)} />
				{#if field.suggestions}<datalist id="{id}-list">{#each field.suggestions as option (option)}<option value={option}></option>{/each}</datalist>{/if}
			{/if}
		{:else if field.kind === 'url'}
			<input class="input" {id} type="url" placeholder="https://…" value={String(value ?? '')} oninput={(event) => onchange(event.currentTarget.value)} />
		{:else if field.kind === 'bool'}
			<input {id} type="checkbox" checked={Boolean(value)} onchange={(event) => onchange(event.currentTarget.checked)} />
		{:else if field.kind === 'color'}
			<input class="input" {id} type="color" value={String(value ?? '#ffffff')} oninput={(event) => onchange(event.currentTarget.value)} />
			<span class="unit mono">{String(value ?? '')}</span>
		{:else if field.kind === 'enum'}
			<select class="select" {id} value={String(value ?? '')} onchange={(event) => onchange(event.currentTarget.value)}>
				{#each field.options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
			</select>
		{:else if field.kind === 'vec3'}
			<div class="vec">
				{#each ['X', 'Y', 'Z'] as axis, index (axis)}
					<NumberInput prefix={axis} label={`${field.label} ${axis}`} step={field.step ?? 0.1} value={Array.isArray(value) ? Number(value[index] ?? 0) : 0} onchange={(next) => vec(index, next)} />
				{/each}
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
		{:else if field.kind === 'json'}
			<textarea class="input" {id} rows="4" aria-invalid={jsonError ? 'true' : undefined} value={jsonDraft ?? JSON.stringify(value ?? null, null, 2)} oninput={(event) => commitJson(event.currentTarget.value)} onblur={() => { if (!jsonError) jsonDraft = null; }}></textarea>
		{/if}

		{#if field.optional && !unset}
			<button class="icon-btn" aria-label={`Clear ${field.label}`} title="Clear" onclick={() => onchange(undefined)}><Icon name="close" size={12} /></button>
		{/if}
	</div>
	{#if jsonError}<p class="error" role="alert">{jsonError}</p>{/if}
</div>

<style>
	.field { display: grid; grid-template-columns: 96px 1fr; align-items: start; gap: 8px; }
	.field.wide { grid-template-columns: 1fr; gap: 4px; }
	.field.wide .label { min-height: 0; }
	.label { display: flex; align-items: center; gap: 4px; min-height: 30px; color: var(--muted); font-size: 12px; }
	.help { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; background: var(--panel-3); font-size: 10px; cursor: help; }
	.control { display: flex; align-items: center; gap: 6px; min-width: 0; }
	.control > :global(textarea), .control > :global(.select) { flex: 1; }
	.vec { display: flex; gap: 4px; width: 100%; }
	.pose { display: grid; gap: 6px; width: 100%; }
	.pose-row { display: grid; grid-template-columns: 42px 1fr; align-items: center; gap: 4px; }
	.btn[aria-pressed='true'] { border-color: var(--accent); background: var(--accent-soft); }
	.unit { color: var(--muted); font-size: 11px; white-space: nowrap; }
	.mono { font-family: var(--mono); }
	.error { grid-column: 2; margin: 0; color: var(--danger); font-size: 11px; }
</style>
