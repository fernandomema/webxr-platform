<script lang="ts">
	import { explore } from '../state/explore.svelte';
	import ExploreBrowser from './ExploreBrowser.svelte';
	import Icon from '../ui/Icon.svelte';

	const request = $derived(explore.request);
</script>

<svelte:window onkeydown={request ? (event) => { if (event.key === 'Escape') { event.preventDefault(); explore.finish(null); } } : undefined} />

{#if request}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="studio-backdrop" onclick={(event) => event.target === event.currentTarget && explore.finish(null)}>
		<div class="studio-modal explore-modal" role="dialog" aria-modal="true" aria-label={request.title}>
			<header>
				<h2>{request.title}</h2>
				<button class="icon-btn" type="button" aria-label="Close" onclick={() => explore.finish(null)}><Icon name="close" size={14} /></button>
			</header>
			<div class="body">
				<ExploreBrowser kind={request.kind} actionLabel={request.actionLabel} optimizedLabel={request.optimizedLabel} onimported={(result) => explore.finish(result)} />
			</div>
		</div>
	</div>
{/if}

<style>
	.explore-modal { width: min(760px, 94vw); height: min(640px, 88vh); display: flex; flex-direction: column; padding: 0; overflow: hidden; }
	header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px 4px; }
	header h2 { margin: 0; font-size: 15px; }
	.body { flex: 1; min-height: 0; }
</style>
