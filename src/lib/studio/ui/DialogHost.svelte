<script lang="ts">
	import { dialogs } from '../state/dialogs.svelte';

	let promptValue = $state('');
	let input = $state<HTMLInputElement>();
	let lastRequest: unknown = null;

	const request = $derived(dialogs.current);

	$effect(() => {
		if (request && request !== lastRequest) {
			lastRequest = request;
			if (request.kind === 'prompt') {
				promptValue = request.value;
				queueMicrotask(() => input?.select());
			}
		}
	});

	function finish(value: boolean | string | null) {
		const current = dialogs.current;
		if (!current) return;
		dialogs.close();
		if (current.kind === 'confirm') current.resolve(value === true);
		else current.resolve(typeof value === 'string' ? value : null);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			finish(request?.kind === 'confirm' ? false : null);
		}
	}
</script>

<svelte:window onkeydown={request ? onKeydown : undefined} />

{#if request}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="studio-backdrop" onclick={(event) => event.target === event.currentTarget && finish(request.kind === 'confirm' ? false : null)}>
		<div class="studio-modal" role="dialog" aria-modal="true" aria-label={request.title}>
			<h2>{request.title}</h2>
			{#if request.message}<p>{request.message}</p>{/if}

			{#if request.kind === 'prompt'}
				<form onsubmit={(event) => { event.preventDefault(); if (promptValue.trim()) finish(promptValue.trim()); }}>
					<!-- svelte-ignore a11y_autofocus -->
					<input class="input" bind:this={input} bind:value={promptValue} autofocus aria-label={request.title} />
					<div class="actions">
						<button type="button" class="btn" onclick={() => finish(null)}>Cancel</button>
						<button type="submit" class="btn primary" disabled={!promptValue.trim()}>{request.confirmLabel}</button>
					</div>
				</form>
			{:else if request.kind === 'confirm'}
				<div class="actions">
					<button class="btn" onclick={() => finish(false)}>Cancel</button>
					<!-- svelte-ignore a11y_autofocus -->
					<button class="btn {request.danger ? 'danger' : 'primary'}" autofocus onclick={() => finish(true)}>{request.confirmLabel}</button>
				</div>
			{:else}
				<div class="actions">
					<button class="btn" onclick={() => finish(null)}>Cancel</button>
					{#each request.choices as choice (choice.id)}
						<button class="btn {choice.danger ? 'danger' : 'primary'}" onclick={() => finish(choice.id)}>{choice.label}</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
