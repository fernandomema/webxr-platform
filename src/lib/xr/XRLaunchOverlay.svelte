<script lang="ts">
	import { PLATFORM_NAME } from '$lib/platform';
	interface Props {
		state: 'loading' | 'vr' | 'desktop' | 'playing';
		error?: string;
		onEnterVR: () => void;
		onContinueDesktop: () => void;
	}

	let { state, error = '', onEnterVR, onContinueDesktop }: Props = $props();
</script>

{#if state !== 'playing'}
	<div class="overlay" role="dialog" aria-modal="true" aria-live="polite">
		<div class="card">
			<div class="mark" aria-hidden="true">◈</div>
			{#if state === 'loading'}
				<p class="eyebrow">{PLATFORM_NAME}</p>
				<h1>Preparing your space</h1>
				<p class="copy">Checking the available experience and loading the world.</p>
				<div class="spinner" aria-label="Loading"></div>
			{:else if state === 'vr'}
				<p class="eyebrow">{PLATFORM_NAME}</p>
				<h1>Your space is ready</h1>
				<p class="copy">Put on your headset and enter the shared world.</p>
				{#if error}<p class="error">{error}</p>{/if}
				<button class="primary" type="button" onclick={onEnterVR}>Enter VR</button>
				<button class="secondary" type="button" onclick={onContinueDesktop}>Continue on desktop</button>
			{:else}
				<p class="eyebrow">Desktop mode</p>
				<h1>Your space is ready</h1>
				<p class="copy">WebXR is not available in this browser. You can continue with keyboard and mouse.</p>
				<button class="primary" type="button" onclick={onContinueDesktop}>Continue on desktop</button>
				<ul class="controls">
					<li><kbd>W A S D</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump</li>
					<li><kbd>Click</kbd> grab and drag · <kbd>E</kbd> carry · <kbd>Wheel</kbd> push / pull</li>
					<li><kbd>Right click</kbd> options · <kbd>M</kbd> menu · <kbd>I</kbd> inspector</li>
					<li><kbd>Esc</kbd> release the mouse</li>
				</ul>
			{/if}
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: 24px;
		background: radial-gradient(circle at 50% 20%, rgb(38 55 105 / 0.28), rgb(5 7 15 / 0.96) 62%);
		color: #f8fafc;
		font-family: system-ui, sans-serif;
	}

	.card {
		display: grid;
		justify-items: center;
		width: min(100%, 430px);
		padding: 38px 34px 34px;
		border: 1px solid rgb(148 163 184 / 0.2);
		border-radius: 24px;
		background: rgb(15 23 42 / 0.86);
		box-shadow: 0 24px 80px rgb(0 0 0 / 0.38);
		text-align: center;
		backdrop-filter: blur(18px);
	}

	.mark {
		display: grid;
		place-items: center;
		width: 52px;
		height: 52px;
		margin-bottom: 22px;
		border-radius: 16px;
		background: linear-gradient(135deg, #8b5cf6, #2563eb);
		color: white;
		font-size: 25px;
		box-shadow: 0 10px 30px rgb(59 130 246 / 0.25);
	}

	.eyebrow {
		margin: 0 0 8px;
		color: #a5b4fc;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-size: clamp(25px, 5vw, 34px);
		line-height: 1.1;
	}

	.copy {
		max-width: 330px;
		margin: 14px 0 28px;
		color: #cbd5e1;
		font-size: 15px;
		line-height: 1.5;
	}

	button {
		min-width: 190px;
		padding: 13px 20px;
		border: 0;
		border-radius: 12px;
		font: 700 14px system-ui, sans-serif;
		cursor: pointer;
	}

	.primary {
		background: #6366f1;
		color: white;
		box-shadow: 0 8px 24px rgb(99 102 241 / 0.3);
	}

	.primary:hover { background: #818cf8; }
	.primary:focus-visible { outline: 3px solid #bfdbfe; outline-offset: 3px; }

	.secondary {
		margin-top: 10px;
		background: transparent;
		color: #cbd5e1;
		box-shadow: inset 0 0 0 1px rgb(148 163 184 / 0.4);
	}

	.secondary:hover { color: white; box-shadow: inset 0 0 0 1px rgb(203 213 225 / 0.7); }
	.secondary:focus-visible { outline: 3px solid #bfdbfe; outline-offset: 3px; }

	.controls {
		display: grid;
		gap: 6px;
		margin: 22px 0 0;
		padding: 0;
		color: #94a3b8;
		font-size: 12.5px;
		line-height: 1.4;
		list-style: none;
	}

	kbd {
		padding: 1px 6px;
		border: 1px solid rgb(148 163 184 / 0.4);
		border-radius: 5px;
		background: rgb(30 41 59 / 0.8);
		color: #e2e8f0;
		font: 600 11px system-ui, sans-serif;
	}

	.spinner {
		width: 26px;
		height: 26px;
		border: 3px solid rgb(165 180 252 / 0.25);
		border-top-color: #a5b4fc;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.error {
		max-width: 330px;
		margin: -10px 0 20px;
		color: #fca5a5;
		font-size: 12px;
		line-height: 1.4;
	}

	@keyframes spin { to { transform: rotate(360deg); } }
</style>
