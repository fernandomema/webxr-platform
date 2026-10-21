<script lang="ts">
	import { getPlatformConfig } from './platform/config.ts';
	import { getFeatures } from './features.ts';
	import { t } from './i18n/svelte.svelte.ts';
	interface Props {
		state: 'loading' | 'vr' | 'desktop' | 'playing';
		error?: string;
		onEnterVR: () => void;
		onContinueDesktop: () => void;
	}

	let { state, error = '', onEnterVR, onContinueDesktop }: Props = $props();
	const platformName = getPlatformConfig().name;
	const inspectorOn = getFeatures().inspector;
</script>

{#if state !== 'playing'}
	<div class="overlay" role="dialog" aria-modal="true" aria-live="polite">
		<div class="card">
			<div class="mark" aria-hidden="true">◈</div>
			{#if state === 'loading'}
				<p class="eyebrow">{platformName}</p>
				<h1>{t('Preparing your space')}</h1>
				<p class="copy">{t('Checking the available experience and loading the world.')}</p>
				<div class="spinner" aria-label={t('Loading')}></div>
			{:else if state === 'vr'}
				<p class="eyebrow">{platformName}</p>
				<h1>{t('Your space is ready')}</h1>
				<p class="copy">{t('Put on your headset and enter the shared world.')}</p>
				{#if error}<p class="error">{error}</p>{/if}
				<button class="primary" type="button" onclick={onEnterVR}>{t('Enter VR')}</button>
				<button class="secondary" type="button" onclick={onContinueDesktop}>{t('Continue on desktop')}</button>
			{:else}
				<p class="eyebrow">{t('Desktop mode')}</p>
				<h1>{t('Your space is ready')}</h1>
				<p class="copy">{t('WebXR is not available in this browser. You can continue with keyboard and mouse.')}</p>
				<button class="primary" type="button" onclick={onContinueDesktop}>{t('Continue on desktop')}</button>
				<ul class="controls">
					<li><kbd>W A S D</kbd> {t('move')} · <kbd>Shift</kbd> {t('run')} · <kbd>Space</kbd> {t('jump')}</li>
					<li><kbd>{t('Click')}</kbd> {t('grab and drag')} · <kbd>E</kbd> {t('carry')} · <kbd>{t('Wheel')}</kbd> {t('push / pull')}</li>
					<li><kbd>{t('Right click')}</kbd> {t('options')} · <kbd>Tab</kbd> {t('menu')}{#if inspectorOn} · <kbd>I</kbd> {t('inspector')}{/if}</li>
					<li><kbd>Esc</kbd> {t('release the mouse')}</li>
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
		background: radial-gradient(circle at 50% 20%, rgb(255 122 69 / 0.12), rgb(7 7 12 / 0.96) 62%);
		color: var(--color-bone, #f4f1ea);
		font-family: var(--font-sans, "Inter", ui-sans-serif, system-ui, sans-serif);
	}

	.card {
		display: grid;
		justify-items: center;
		width: min(100%, 430px);
		padding: 38px 34px 34px;
		border: 1px solid rgb(255 255 255 / 0.12);
		border-radius: 24px;
		background: rgb(13 13 22 / 0.86);
		box-shadow: 0 24px 80px rgb(0 0 0 / 0.5);
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
		background: linear-gradient(135deg, var(--color-ember, #ff7a45), var(--color-glow, #ffcf7a));
		color: var(--color-ink, #07070c);
		font-size: 25px;
		box-shadow: 0 10px 30px rgb(255 122 69 / 0.28);
	}

	.eyebrow {
		margin: 0 0 8px;
		color: var(--color-glow, #ffcf7a);
		font: 500 11px var(--font-display, "Space Grotesk", ui-sans-serif, system-ui, sans-serif);
		letter-spacing: 0.22em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0;
		font-family: var(--font-display, "Space Grotesk", ui-sans-serif, system-ui, sans-serif);
		font-size: clamp(25px, 5vw, 34px);
		font-weight: 500;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}

	.copy {
		max-width: 330px;
		margin: 14px 0 28px;
		color: rgb(244 241 234 / 0.6);
		font-size: 15px;
		line-height: 1.5;
	}

	button {
		min-width: 190px;
		padding: 13px 22px;
		border: 0;
		border-radius: 999px;
		font: 500 14px var(--font-display, "Space Grotesk", ui-sans-serif, system-ui, sans-serif);
		cursor: pointer;
		transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
	}

	.primary {
		background: var(--color-bone, #f4f1ea);
		color: var(--color-ink, #07070c);
		box-shadow: 0 0 28px rgb(255 207 122 / 0.2);
	}

	.primary:hover { background: var(--color-glow, #ffcf7a); transform: scale(1.03); }
	.primary:focus-visible { outline: 3px solid var(--color-glow, #ffcf7a); outline-offset: 3px; }

	.secondary {
		margin-top: 10px;
		background: rgb(255 255 255 / 0.05);
		color: var(--color-bone, #f4f1ea);
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.2);
	}

	.secondary:hover { background: rgb(255 255 255 / 0.1); }
	.secondary:focus-visible { outline: 3px solid var(--color-glow, #ffcf7a); outline-offset: 3px; }

	.controls {
		display: grid;
		gap: 6px;
		margin: 22px 0 0;
		padding: 0;
		color: rgb(244 241 234 / 0.5);
		font-size: 12.5px;
		line-height: 1.4;
		list-style: none;
	}

	kbd {
		padding: 1px 6px;
		border: 1px solid rgb(255 255 255 / 0.2);
		border-radius: 5px;
		background: rgb(255 255 255 / 0.06);
		color: var(--color-bone, #f4f1ea);
		font: 500 11px var(--font-display, "Space Grotesk", ui-sans-serif, system-ui, sans-serif);
	}

	.spinner {
		width: 26px;
		height: 26px;
		border: 3px solid rgb(255 207 122 / 0.22);
		border-top-color: var(--color-glow, #ffcf7a);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.error {
		max-width: 330px;
		margin: -10px 0 20px;
		color: #ff7b6b;
		font-size: 12px;
		line-height: 1.4;
	}

	@keyframes spin { to { transform: rotate(360deg); } }
</style>
