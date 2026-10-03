<script lang="ts">
	import { desktopHud, hudActions } from './desktopHud.svelte';

	/** Radius of the radial ring, in px. Slices sit on it; the pointer's offset is in units of it. */
	const RING = 118;

	const aimHint = $derived.by(() => {
		const { holding, aim } = desktopHud;
		if (holding) {
			const parts = [];
			if (holding.usable) parts.push('Click: use');
			else if (!holding.equipped) parts.push('Click: drop');
			if (!holding.equipped) parts.push('Wheel: push / pull');
			parts.push('Right click: options');
			return { title: holding.equipped ? `${holding.label} (equipped)` : holding.label, detail: parts.join('  ·  ') };
		}
		if (aim.kind === 'grab') return { title: aim.label, detail: 'Hold click: grab  ·  E: carry  ·  Right click: options' };
		if (aim.kind === 'ui') return { title: aim.label, detail: 'Click' };
		if (aim.kind === 'object') return { title: aim.label, detail: 'Right click: options' };
		return null;
	});

	const slicePosition = (index: number, count: number) => {
		const angle = (2 * Math.PI * index) / count - Math.PI / 2;
		return `left: ${Math.cos(angle) * RING}px; top: ${Math.sin(angle) * RING}px;`;
	};
</script>

{#if desktopHud.active}
	{#if desktopHud.panelOpen}
		<button class="close" type="button" onclick={() => hudActions.closePanel()}>
			<span>{desktopHud.panelName}</span>
			<kbd>Esc</kbd> Close
		</button>
	{:else if desktopHud.locked}
		<div class="crosshair" class:grab={desktopHud.aim.kind === 'grab'} class:ui={desktopHud.aim.kind === 'ui'} class:holding={desktopHud.holding !== null} class:hidden={desktopHud.radial !== null}></div>
		{#if aimHint && !desktopHud.radial}
			<div class="hint">
				<strong>{aimHint.title}</strong>
				<span>{aimHint.detail}</span>
			</div>
		{/if}
		{#if desktopHud.radial}
			{@const radial = desktopHud.radial}
			<div class="radial" role="menu">
				<div class="ring"></div>
				{#each radial.items as item, index (index)}
					<div class="slice" class:hovered={radial.hovered === index} class:disabled={!item.enabled} style={slicePosition(index, radial.items.length)}>{item.label}</div>
				{/each}
				<div class="pointer" style={`left: ${radial.pointer.x * RING}px; top: ${radial.pointer.y * RING}px;`}></div>
				<p class="radial-hint">{radial.sticky ? 'Click an option · Right click to cancel' : 'Move to an option and release'}</p>
			</div>
		{/if}
	{:else}
		<div class="pause">
			<h2>Paused</h2>
			<p class="resume">Click to resume</p>
			<ul>
				<li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move <kbd>Shift</kbd> Run <kbd>Space</kbd> Jump</li>
				<li><kbd>Click</kbd> Click / grab and drag <kbd>E</kbd> Carry <kbd>Q</kbd> Drop</li>
				<li><kbd>Wheel</kbd> Push / pull <kbd>Ctrl</kbd>+<kbd>Wheel</kbd> Scale <kbd>Shift</kbd>+<kbd>Wheel</kbd> Turn</li>
				<li><kbd>Right click</kbd> Options of what you aim at or carry</li>
				<li><kbd>M</kbd> Menu <kbd>I</kbd> Inspector <kbd>Esc</kbd> Release the mouse</li>
			</ul>
		</div>
	{/if}
{/if}

<style>
	.crosshair {
		position: fixed;
		left: 50%;
		top: 50%;
		z-index: 10;
		width: 6px;
		height: 6px;
		margin: -3px 0 0 -3px;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.85);
		box-shadow: 0 0 0 1.5px rgb(0 0 0 / 0.55);
		pointer-events: none;
		transition: width 0.12s, height 0.12s, margin 0.12s, background 0.12s, border-color 0.12s;
	}
	.crosshair.grab,
	.crosshair.ui,
	.crosshair.holding {
		width: 18px;
		height: 18px;
		margin: -9px 0 0 -9px;
		border: 2px solid #60a5fa;
		background: transparent;
		box-shadow: 0 0 0 1.5px rgb(0 0 0 / 0.45);
	}
	.crosshair.grab { border-color: #fb923c; }
	.crosshair.holding { border-color: #fb923c; background: rgb(251 146 60 / 0.35); }
	.crosshair.hidden { opacity: 0; }

	.hint {
		position: fixed;
		left: 50%;
		bottom: 28px;
		z-index: 10;
		display: grid;
		justify-items: center;
		gap: 2px;
		max-width: min(90vw, 460px);
		padding: 6px 12px;
		border-radius: 10px;
		background: rgb(15 23 42 / 0.78);
		color: #f8fafc;
		font: 500 13px system-ui, sans-serif;
		text-align: center;
		transform: translateX(-50%);
		pointer-events: none;
	}
	.hint strong { font-weight: 700; }
	.hint span { color: #cbd5e1; font-size: 12px; }

	.close {
		position: fixed;
		top: 14px;
		right: 14px;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border: 1px solid rgb(148 163 184 / 0.3);
		border-radius: 10px;
		background: rgb(15 23 42 / 0.88);
		color: #e2e8f0;
		font: 600 13px system-ui, sans-serif;
		cursor: pointer;
	}
	.close:hover { background: rgb(30 41 59 / 0.95); }
	.close span { color: #a5b4fc; }

	kbd {
		display: inline-block;
		min-width: 1.5em;
		margin: 0 3px;
		padding: 1px 6px;
		border: 1px solid rgb(148 163 184 / 0.45);
		border-bottom-width: 2px;
		border-radius: 5px;
		background: rgb(30 41 59 / 0.9);
		color: #f1f5f9;
		font: 600 11px system-ui, sans-serif;
		text-align: center;
	}

	.radial {
		position: fixed;
		left: 50%;
		top: 50%;
		z-index: 15;
		width: 0;
		height: 0;
		pointer-events: none;
	}
	.ring {
		position: absolute;
		width: 236px;
		height: 236px;
		margin: -118px 0 0 -118px;
		border: 1px solid rgb(148 163 184 / 0.25);
		border-radius: 50%;
		background: rgb(15 23 42 / 0.35);
		backdrop-filter: blur(2px);
	}
	.slice {
		position: absolute;
		display: grid;
		place-items: center;
		width: 92px;
		height: 92px;
		margin: -46px 0 0 -46px;
		border-radius: 50%;
		background: #1f2937;
		color: #f8fafc;
		font: 600 14px system-ui, sans-serif;
		text-align: center;
		line-height: 1.15;
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
		transition: background 0.08s, transform 0.08s;
	}
	.slice.hovered { background: #6d28d9; transform: scale(1.1); }
	.slice.disabled { background: #374151; opacity: 0.45; }
	.pointer {
		position: absolute;
		width: 10px;
		height: 10px;
		margin: -5px 0 0 -5px;
		border-radius: 50%;
		background: #f8fafc;
		box-shadow: 0 0 0 2px rgb(0 0 0 / 0.5);
	}
	.radial-hint {
		position: absolute;
		top: 152px;
		left: 0;
		width: 320px;
		margin: 0 0 0 -160px;
		color: #e2e8f0;
		font: 500 12px system-ui, sans-serif;
		text-align: center;
		text-shadow: 0 1px 3px rgb(0 0 0 / 0.8);
	}

	.pause {
		position: fixed;
		left: 50%;
		top: 50%;
		z-index: 10;
		display: grid;
		justify-items: center;
		gap: 4px;
		width: min(92vw, 560px);
		padding: 22px 26px;
		border: 1px solid rgb(148 163 184 / 0.2);
		border-radius: 18px;
		background: rgb(15 23 42 / 0.82);
		color: #f8fafc;
		font-family: system-ui, sans-serif;
		text-align: center;
		transform: translate(-50%, -50%);
		backdrop-filter: blur(10px);
		pointer-events: none;
	}
	.pause h2 { margin: 0; font-size: 22px; }
	.resume { margin: 0 0 10px; color: #a5b4fc; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
	ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; color: #cbd5e1; font-size: 13px; line-height: 1.5; }
</style>
