<script lang="ts">
	interface Props {
		value: number;
		label: string;
		min?: number;
		max?: number;
		step?: number;
		/** Small axis label shown inside the box, e.g. "X". */
		prefix?: string;
		onchange: (value: number) => void;
	}

	let { value, label, min, max, step = 0.1, prefix, onchange }: Props = $props();

	let draft = $state<string | null>(null);
	const shown = $derived(draft ?? String(Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0));

	function commit(text: string) {
		draft = text;
		if (text.trim() === '' || text === '-' || text === '.') return; // still typing: don't overwrite with 0
		let next = Number(text);
		if (!Number.isFinite(next)) return;
		if (min !== undefined) next = Math.max(min, next);
		if (max !== undefined) next = Math.min(max, next);
		onchange(next);
	}
</script>

<label class="wrap">
	{#if prefix}<span class="prefix" aria-hidden="true">{prefix}</span>{/if}
	<input
		class="input"
		type="number"
		inputmode="decimal"
		aria-label={label}
		{min}
		{max}
		{step}
		value={shown}
		oninput={(event) => commit(event.currentTarget.value)}
		onblur={() => (draft = null)}
	/>
</label>

<style>
	.wrap { position: relative; display: flex; align-items: center; min-width: 0; flex: 1; }
	.prefix { position: absolute; left: 8px; color: var(--muted); font: 600 11px var(--mono); pointer-events: none; }
	.wrap:has(.prefix) .input { padding-left: 22px; }
	.input { width: 100%; }
</style>
