<script lang="ts">
	import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from './color';

	interface Props {
		value: string;
		onchange: (hex: string) => void;
		label: string;
		id?: string;
		disabled?: boolean;
	}

	let { value, onchange, label, id, disabled = false }: Props = $props();

	const PRESETS = ['#ffffff', '#c8ccd8', '#6b7280', '#111827', '#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'];

	let open = $state(false);
	let root = $state<HTMLDivElement>();
	let area = $state<HTMLDivElement>();
	let bar = $state<HTMLDivElement>();
	let hsv = $state<Hsv>({ h: 0, s: 0, v: 1 });
	let draft = $state<string | null>(null);
	let dragging: 'area' | 'bar' | null = null;

	const hex = $derived(normalizeHex(value) ?? '#ffffff');
	const hueColor = $derived(hsvToHex({ h: hsv.h, s: 1, v: 1 }));

	function show() {
		if (disabled) return;
		hsv = hexToHsv(hex);
		open = !open;
	}

	function commit(next: Hsv) {
		hsv = next;
		onchange(hsvToHex(next));
	}

	function fraction(event: PointerEvent, element: HTMLElement): [number, number] {
		const box = element.getBoundingClientRect();
		return [Math.min(1, Math.max(0, (event.clientX - box.left) / (box.width || 1))), Math.min(1, Math.max(0, (event.clientY - box.top) / (box.height || 1)))];
	}

	function track(event: PointerEvent) {
		if (dragging === 'area' && area) {
			const [x, y] = fraction(event, area);
			commit({ h: hsv.h, s: x, v: 1 - y });
		} else if (dragging === 'bar' && bar) {
			const [x] = fraction(event, bar);
			commit({ ...hsv, h: x * 360 });
		}
	}

	// Window listeners, not pointer capture: the XR panel feeds in synthetic events that cannot be captured.
	function start(kind: 'area' | 'bar', event: PointerEvent) {
		dragging = kind;
		track(event);
		event.preventDefault();
	}

	function setHex(text: string) {
		draft = text;
		const parsed = normalizeHex(text);
		if (parsed) {
			hsv = hexToHsv(parsed);
			onchange(parsed);
		}
	}

	function onWindowPointer(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onpointerdown={onWindowPointer} onpointermove={(event) => dragging && track(event)} onpointerup={() => (dragging = null)} onkeydown={(event) => open && event.key === 'Escape' && (open = false)} />

<div class="color-root" bind:this={root}>
	<button {id} type="button" class="swatch" aria-label={label} aria-haspopup="dialog" aria-expanded={open} {disabled} onclick={show}>
		<span class="chip" style:background={hex}></span>
		<span class="hex">{hex}</span>
	</button>
	{#if open}
		<div class="pop" role="dialog" aria-label="{label} picker">
			<div class="sv" bind:this={area} role="presentation" style:background-color={hueColor} onpointerdown={(event) => start('area', event)}>
				<div class="white"></div>
				<div class="black"></div>
				<span class="thumb" style:left="{hsv.s * 100}%" style:top="{(1 - hsv.v) * 100}%"></span>
			</div>
			<div class="hue" bind:this={bar} role="presentation" onpointerdown={(event) => start('bar', event)}>
				<span class="thumb" style:left="{(hsv.h / 360) * 100}%"></span>
			</div>
			<div class="presets">
				{#each PRESETS as preset (preset)}
					<button type="button" class="preset" class:picked={preset === hex} style:background={preset} aria-label={preset} onclick={() => { hsv = hexToHsv(preset); draft = null; onchange(preset); }}></button>
				{/each}
			</div>
			<input class="input mono" aria-label="{label} hex" value={draft ?? hex} oninput={(event) => setHex(event.currentTarget.value)} onblur={() => (draft = null)} />
		</div>
	{/if}
</div>

<style>
	.color-root { position: relative; min-width: 0; }
	.swatch {
		display: flex; align-items: center; gap: 8px; height: var(--control-h, 30px); padding: 0 10px 0 4px; border: 1px solid var(--border); border-radius: 6px;
		background: var(--bg); color: var(--text); font: 12px var(--mono); cursor: pointer;
	}
	.swatch:hover:not(:disabled), .swatch:global([data-xr-hover]) { border-color: #3a4157; }
	.swatch:disabled { opacity: 0.5; cursor: not-allowed; }
	.chip { width: calc(var(--control-h, 30px) - 12px); height: calc(var(--control-h, 30px) - 12px); border-radius: 4px; border: 1px solid rgb(255 255 255 / 0.2); }
	.pop {
		position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; display: grid; gap: 8px; width: 220px; padding: 10px;
		border: 1px solid var(--border); border-radius: 10px; background: var(--panel); box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
	}
	.sv, .hue { position: relative; border-radius: 6px; touch-action: none; cursor: crosshair; }
	.sv { height: 130px; }
	.white, .black { position: absolute; inset: 0; border-radius: inherit; }
	.white { background: linear-gradient(to right, #fff, rgb(255 255 255 / 0)); }
	.black { background: linear-gradient(to top, #000, rgb(0 0 0 / 0)); }
	.hue { height: 16px; background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
	.thumb { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5); pointer-events: none; }
	.hue .thumb { top: 50%; }
	.presets { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
	.preset { aspect-ratio: 1; min-height: 24px; padding: 0; border: 1px solid rgb(255 255 255 / 0.2); border-radius: 6px; cursor: pointer; }
	.preset.picked { outline: 2px solid var(--accent); outline-offset: 1px; }
	.mono { font-family: var(--mono); }
</style>
