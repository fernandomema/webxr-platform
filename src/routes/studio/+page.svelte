<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { listRecentProjects, type RecentProject } from '@kithin/engine/inventory/recent';
	import { studioSession } from '$lib/studio/state/session.svelte';
	import { studioModels } from '$lib/studio/state/models.svelte';
	import { handOverNewAvatar } from '$lib/studio/state/newAvatar';
	import { TEMPLATES } from '$lib/studio/templates';
	import Icon from '$lib/studio/ui/Icon.svelte';
	import AvatarWizard from '$lib/studio/components/AvatarWizard.svelte';
	import ItemThumb from '$lib/studio/components/ItemThumb.svelte';
	import { importProjectFile } from '$lib/studio/state/containerFiles';
	import { toasts } from '$lib/studio/state/toasts.svelte';
	import LauncherShell from '$lib/studio/components/LauncherShell.svelte';
	import type { SlotTree } from '@kithin/engine/ecs/types';

	const RECENT_LIMIT = 12;

	// A file dropped on the Home screen is imported into this device's projects.
	async function importDropped(files: File[]) {
		try {
			for (const file of files) {
				const result = await importProjectFile(file, { adapterId: 'local', folderId: null, context: studioSession.context });
				if (result.missing) toasts.error(new Error(`${result.missing} asset${result.missing === 1 ? ' is' : 's are'} missing from the file and from this device.`), `Imported “${result.item.name}” incomplete`);
				else toasts.success(`Imported “${result.item.name}”`);
			}
			await goto(resolve('/studio/projects'));
		} catch (error) {
			toasts.error(error, 'Could not import the file');
		}
	}

	let recent = $state<RecentProject[]>([]);
	let recentLoaded = $state(false);
	let loadedFor = $state<string | null | undefined>(undefined);

	// Recents span every storage the user can write to, so they are reloaded when the account changes (signing in adds the cloud).
	$effect(() => {
		if (!studioSession.ready || loadedFor === studioSession.userId) return;
		loadedFor = studioSession.userId;
		void listRecentProjects(studioSession.context, RECENT_LIMIT)
			.then((projects) => { recent = projects; })
			.catch(() => { recent = []; })
			.finally(() => { recentLoaded = true; });
	});

	function editUrl(params: Record<string, string>): string {
		return `${resolve('/studio/edit')}?${new URLSearchParams(params)}`;
	}

	function startFromTemplate(id: string) {
		void goto(editUrl({ template: id, draft: crypto.randomUUID() }));
	}

	let wizardOpen = $state(false);

	function openWizard() {
		void studioModels.refresh();
		wizardOpen = true;
	}

	function startAvatar(tree: SlotTree, name: string) {
		const draft = crypto.randomUUID();
		handOverNewAvatar(draft, tree, name);
		wizardOpen = false;
		void goto(editUrl({ template: 'avatar', draft }));
	}

	function openRecent(project: RecentProject) {
		void goto(editUrl({ source: project.adapterId, folder: project.item.folderId ?? 'root', item: project.item.id }));
	}

	const kindLabel = (project: RecentProject): string => project.item.kind === 'world' ? 'World' : project.item.kind === 'avatar' ? 'Avatar' : 'Object';
	const kindIcon = (project: RecentProject) => project.item.kind === 'world' ? 'world' : project.item.kind === 'avatar' ? 'user' : 'cube';

	function ago(iso: string): string {
		const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
		if (Number.isNaN(minutes)) return '';
		if (minutes < 60) return `${minutes} min ago`;
		if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
		return `${Math.round(minutes / 60 / 24)} d ago`;
	}
</script>

<LauncherShell active="home" ondropfiles={(files) => void importDropped(files)}>
	<div class="page">
		<section aria-labelledby="new-heading">
			<h1 id="new-heading">Create new</h1>
			<div class="tiles">
				{#each TEMPLATES as template (template.id)}
					<button class="tile" onclick={() => startFromTemplate(template.id)}>
						<span class="tile-icon"><Icon name={template.kind === 'world' ? 'world' : 'cube'} size={26} /></span>
						<strong>{template.label}</strong>
						<span class="muted">{template.description}</span>
					</button>
				{/each}
				<button class="tile" onclick={openWizard}>
					<span class="tile-icon"><Icon name="user" size={26} /></span>
					<strong>New avatar</strong>
					<span class="muted">A guided wizard that turns a rigged .glb model into a player avatar.</span>
				</button>
				<a class="tile" href={resolve('/studio/content')}>
					<span class="tile-icon alt"><Icon name="layers" size={26} /></span>
					<strong>Manage content</strong>
					<span class="muted">Models, sounds and images kept on this device or in the cloud.</span>
				</a>
			</div>
		</section>

		<section aria-labelledby="recent-heading">
			<div class="row">
				<h2 id="recent-heading"><Icon name="clock" size={15} />Recent</h2>
				<a class="btn ghost sm" href={resolve('/studio/projects')}>All projects<Icon name="chevron-right" size={12} /></a>
			</div>
			{#if !recentLoaded}
				<div class="empty">Loading…</div>
			{:else if !recent.length}
				<div class="empty"><strong>Nothing here yet</strong>Pick one of the options above to create your first project.</div>
			{:else}
				<ul class="recent">
					{#each recent as project (project.adapterId + project.item.id)}
						<li>
							<button class="project" onclick={() => openRecent(project)}>
								<span class="preview"><ItemThumb assetId={project.item.thumbnailAssetId} icon={kindIcon(project)} iconSize={28} /></span>
								<strong>{project.item.name}</strong>
								<span class="meta muted">{kindLabel(project)} · {project.adapterLabel} · {ago(project.item.createdAt)}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</LauncherShell>

{#if wizardOpen}
	<AvatarWizard models={studioModels.items.filter((item) => item.type === 'model')} canCreate={true} oncreate={startAvatar} onclose={() => (wizardOpen = false)} />
{/if}

<style>
	.page { display: grid; gap: 40px; max-width: var(--page-width); }
	h1 { margin: 0 0 14px; font-size: 22px; font-weight: 650; }
	h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 16px; font-weight: 600; }
	.row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
	.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
	.tile { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); color: inherit; text-align: left; cursor: pointer; font: inherit; }
	.tile:hover { border-color: var(--accent); background: var(--panel-2); }
	.tile-icon { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 8px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); }
	.tile-icon.alt { background: var(--panel-3); color: var(--muted); }
	.recent { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
	.project { display: grid; gap: 2px; width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); color: inherit; text-align: left; cursor: pointer; font: inherit; }
	.project:hover { border-color: var(--accent); }
	.preview { display: grid; place-items: center; aspect-ratio: 16 / 10; margin-bottom: 6px; overflow: hidden; border-radius: 8px; background: var(--panel-3); color: var(--muted); }
	.project strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
</style>
