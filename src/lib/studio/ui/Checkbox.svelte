<script lang="ts">
	interface Props {
		checked: boolean;
		onchange: (checked: boolean) => void;
		label: string;
		id?: string;
		disabled?: boolean;
	}

	let { checked, onchange, label, id, disabled = false }: Props = $props();
</script>

<!-- A switch built from a button: a native checkbox cannot be drawn by the XR rasterizer. -->
<button {id} type="button" role="switch" class="switch" class:on={checked} aria-checked={checked} aria-label={label} {disabled} onclick={() => onchange(!checked)}>
	<span class="knob"></span>
</button>

<style>
	.switch {
		position: relative; flex: none; width: calc(var(--control-h, 30px) * 1.2); height: calc(var(--control-h, 30px) * 0.66); padding: 0;
		border: 1px solid var(--border); border-radius: 999px; background: var(--bg); cursor: pointer;
	}
	.switch:hover:not(:disabled), .switch:global([data-xr-hover]) { border-color: #3a4157; }
	.switch.on { border-color: var(--accent); background: var(--accent); }
	.switch:disabled { opacity: 0.5; cursor: not-allowed; }
	.knob { position: absolute; top: 2px; left: 2px; height: calc(100% - 4px); aspect-ratio: 1; border-radius: 50%; background: var(--muted); }
	.on .knob { left: auto; right: 2px; background: white; }
</style>
