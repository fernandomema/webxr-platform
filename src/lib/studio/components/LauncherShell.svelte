<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { PLATFORM_NAME } from '$lib/platform';
	import { studioSession } from '../state/session.svelte';
	import Icon, { type IconName } from '../ui/Icon.svelte';
	import { CONTAINER_EXTENSIONS } from '@kithin/engine/container/kithinFile';

	type Section = 'home' | 'projects' | 'content';

	interface Props {
		active: Section;
		children: Snippet;
		/** Called with the Kithin files (.kiw, .kin, .kia) dropped anywhere on the page. Without it, dropping does nothing. */
		ondropfiles?: (files: File[]) => void;
	}

	let { active, children, ondropfiles }: Props = $props();

	let dragging = $state(false);
	// `dragenter` and `dragleave` also fire for every child the pointer crosses, so the overlay follows a depth count.
	let depth = 0;

	const isContainer = (file: { name: string }) => CONTAINER_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension));
	const hasFiles = (event: DragEvent) => Boolean(ondropfiles) && event.dataTransfer?.types.includes('Files') === true;

	function onDrop(event: DragEvent) {
		if (!hasFiles(event)) return;
		event.preventDefault();
		depth = 0;
		dragging = false;
		const files = [...(event.dataTransfer?.files ?? [])].filter(isContainer);
		if (files.length) ondropfiles?.(files);
	}

	const sections: Array<{ id: Section; label: string; icon: IconName; href: '/studio' | '/studio/projects' | '/studio/content' }> = [
		{ id: 'home', label: 'Home', icon: 'home', href: '/studio' },
		{ id: 'projects', label: 'Projects', icon: 'folder', href: '/studio/projects' },
		{ id: 'content', label: 'Content', icon: 'layers', href: '/studio/content' }
	];
</script>

<svelte:head>
	<title>Studio · {PLATFORM_NAME}</title>
	<meta name="description" content={`Create and edit worlds and objects for ${PLATFORM_NAME}.`} />
</svelte:head>

<div
	class="launcher"
	role="presentation"
	ondragenter={(event) => { if (hasFiles(event)) { depth++; dragging = true; } }}
	ondragover={(event) => { if (hasFiles(event)) event.preventDefault(); }}
	ondragleave={(event) => { if (hasFiles(event) && --depth <= 0) { depth = 0; dragging = false; } }}
	ondrop={onDrop}
>
	<aside class="rail">
		<a class="brand" href={resolve('/studio')}><Icon name="cube" size={20} /><strong>Studio</strong></a>
		<nav aria-label="Studio">
			{#each sections as section (section.id)}
				<a class="item" class:active={active === section.id} aria-current={active === section.id ? 'page' : undefined} href={resolve(section.href)}>
					<Icon name={section.icon} size={16} />{section.label}
				</a>
			{/each}
		</nav>
		<div class="foot">
			<a class="item" href={resolve('/play')}><Icon name="play" size={16} />Open game</a>
			{#if studioSession.userId}
				<a class="item" href={resolve('/settings')} title="Account settings"><Icon name="user" size={16} /><span class="name">{studioSession.userName ?? 'Settings'}</span></a>
			{:else if studioSession.ready}
				<a class="item" href={resolve('/login')}><Icon name="user" size={16} />Sign in</a>
			{/if}
		</div>
	</aside>
	<main>{@render children()}</main>
	{#if dragging}
		<div class="drop" aria-hidden="true"><Icon name="upload" size={28} /><strong>Drop to import</strong><span>.kiw worlds, .kin objects and .kia avatars</span></div>
	{/if}
</div>

<style>
	.launcher { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 100dvh; }
	.rail { position: sticky; top: 0; display: flex; flex-direction: column; gap: 20px; height: 100dvh; padding: 16px 12px; border-right: 1px solid var(--border); background: var(--panel); }
	.brand { display: flex; align-items: center; gap: 8px; padding: 4px 8px 8px; color: var(--accent); }
	.brand strong { color: var(--text); font-size: 15px; }
	nav { display: grid; gap: 2px; }
	.foot { display: grid; gap: 2px; margin-top: auto; }
	.item { display: flex; align-items: center; gap: 10px; min-width: 0; height: 36px; padding: 0 10px; border-radius: 8px; color: var(--muted); font-weight: 500; }
	.item:hover { background: var(--panel-2); color: var(--text); }
	.item.active { background: var(--accent-soft); color: var(--text); }
	.item.active :global(svg) { color: var(--accent); }
	.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.drop { position: fixed; inset: 12px; z-index: 50; display: grid; place-content: center; justify-items: center; gap: 6px; border: 2px dashed var(--accent); border-radius: 16px; background: color-mix(in srgb, var(--bg) 82%, transparent); color: var(--accent); pointer-events: none; }
	.drop strong { color: var(--text); font-size: 16px; }
	.drop span { color: var(--muted); }
	main { min-width: 0; padding: 32px 40px 64px; }
	@media (max-width: 760px) {
		.launcher { grid-template-columns: minmax(0, 1fr); }
		.rail { position: static; flex-direction: row; align-items: center; height: auto; padding: 8px 12px; border-right: 0; border-bottom: 1px solid var(--border); overflow-x: auto; }
		.brand { padding: 0 8px; }
		nav, .foot { display: flex; margin: 0; }
		.foot { margin-left: auto; }
		.item { flex: none; }
		.foot .item { font-size: 0; gap: 0; }
		main { padding: 20px 16px 48px; }
	}
</style>
