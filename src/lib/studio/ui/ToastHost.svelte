<script lang="ts">
	import { toasts } from '../state/toasts.svelte';
	import Icon from './Icon.svelte';
</script>

<div class="stack" role="status" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<div class="toast {toast.kind}">
			<Icon name={toast.kind === 'error' ? 'warning' : toast.kind === 'success' ? 'check' : 'layers'} />
			<span>{toast.message}</span>
			<button class="icon-btn" aria-label="Dismiss" onclick={() => toasts.dismiss(toast.id)}><Icon name="close" size={14} /></button>
		</div>
	{/each}
</div>

<style>
	.stack { position: fixed; right: 16px; bottom: 16px; z-index: 200; display: grid; gap: 8px; width: min(360px, calc(100vw - 32px)); }
	.toast { display: flex; align-items: center; gap: 10px; padding: 9px 8px 9px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel-2); box-shadow: 0 10px 28px rgb(0 0 0 / 0.5); }
	.toast span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
	.toast.error { border-color: rgb(240 97 109 / 0.5); color: #ffb3b9; }
	.toast.success { border-color: rgb(62 207 142 / 0.4); }
	.toast.success :global(svg:first-child) { color: var(--success); }
</style>
