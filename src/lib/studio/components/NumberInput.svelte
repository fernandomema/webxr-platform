<script lang="ts">
	interface Props {
		value: number;
		label: string;
		min?: number;
		max?: number;
		step?: number;
		/** Small axis label shown inside the box, e.g. "X". Dragging it sideways scrubs the value. */
		prefix?: string;
		disabled?: boolean;
		onchange: (value: number) => void;
	}

	let { value, label, min, max, step = 0.1, prefix, disabled = false, onchange }: Props = $props();

	const PIXELS_PER_STEP = 6;

	let draft = $state<string | null>(null);
	let scrub: { x: number; start: number } | null = null;
	const shown = $derived(draft ?? String(Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0));

	function clamp(next: number): number {
		if (min !== undefined) next = Math.max(min, next);
		if (max !== undefined) next = Math.min(max, next);
		return next;
	}

	function commit(text: string) {
		draft = text;
		if (text.trim() === '' || text === '-' || text === '.') return; // still typing: don't overwrite with 0
		const next = Number(text);
		if (Number.isFinite(next)) onchange(clamp(next));
	}

	/** Steps the value without float noise (0.1 + 0.2). */
	function nudge(direction: 1 | -1, amount = step) {
		draft = null;
		const places = Math.max(0, -Math.floor(Math.log10(step)) + 1);
		onchange(clamp(Number((value + direction * amount).toFixed(Math.min(places, 6)))));
	}

	function onKey(event: KeyboardEvent) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		event.preventDefault();
		nudge(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey ? step * 10 : step);
	}

	function startScrub(event: PointerEvent) {
		if (disabled || event.button !== 0) return;
		scrub = { x: event.clientX, start: value };
		event.preventDefault();
	}

	function moveScrub(event: PointerEvent) {
		if (!scrub) return;
		const steps = Math.round((event.clientX - scrub.x) / PIXELS_PER_STEP);
		const places = Math.max(0, -Math.floor(Math.log10(step)) + 1);
		draft = null;
		onchange(clamp(Number((scrub.start + steps * step).toFixed(Math.min(places, 6)))));
	}
</script>

<svelte:window onpointermove={moveScrub} onpointerup={() => (scrub = null)} />

<div class="wrap" class:has-prefix={prefix}>
	{#if prefix}<span class="prefix" role="presentation" onpointerdown={startScrub}>{prefix}</span>{/if}
	<input
		class="input"
		type="text"
		inputmode="decimal"
		aria-label={label}
		{disabled}
		value={shown}
		oninput={(event) => commit(event.currentTarget.value)}
		onkeydown={onKey}
		onblur={() => (draft = null)}
	/>
	<div class="steppers">
		<button type="button" tabindex="-1" aria-label="Decrease {label}" {disabled} onclick={() => nudge(-1)}>−</button>
		<button type="button" tabindex="-1" aria-label="Increase {label}" {disabled} onclick={() => nudge(1)}>+</button>
	</div>
</div>

<style>
	.wrap { position: relative; display: flex; align-items: center; min-width: 0; flex: 1; }
	.prefix { position: absolute; left: 0; display: grid; place-items: center; width: 22px; height: 100%; color: var(--muted); font: 600 11px var(--mono); cursor: ew-resize; touch-action: none; }
	.wrap.has-prefix .input { padding-left: 22px; }
	.input { width: 100%; height: var(--control-h, 30px); }
	/* On the desktop the − and + appear over the field's right edge when it is in use; in the XR panel they always flank it. */
	.steppers { position: absolute; top: 1px; right: 1px; bottom: 1px; display: none; overflow: hidden; border-radius: 5px; background: var(--panel-3); }
	.wrap:hover .steppers, .wrap:focus-within .steppers, .wrap:global([data-xr-hover]) .steppers { display: flex; }
	.steppers button { display: grid; place-items: center; width: 18px; padding: 0; border: 0; background: transparent; color: var(--muted); font: 600 13px var(--font); cursor: pointer; }
	.steppers button:hover:not(:disabled) { background: var(--accent-soft); color: var(--text); }
	:global(.xr-panel) .steppers { position: static; display: flex; order: 2; margin-left: 4px; background: transparent; }
	:global(.xr-panel) .steppers button { width: var(--control-h); height: var(--control-h); border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2); font-size: 18px; }
	:global(.xr-panel) .steppers button + button { margin-left: 2px; }
</style>
