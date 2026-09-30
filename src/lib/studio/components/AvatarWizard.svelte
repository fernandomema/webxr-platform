<script lang="ts">
	import type { SlotTree } from '$lib/ecs/types';
	import type { AssetId } from '$lib/assets/ref';
	import { getLocalAssetStore, type AssetListing } from '$lib/assets/store';
	import { parseGlb } from '$lib/assets/glb';
	import { studioModels } from '../state/models.svelte';
	import { buildAvatarTree, eyeHeightOf } from '../../xr/avatar/build';
	import { BODY_BONES, REQUIRED_BONES, avatarCapabilities, detectHumanoidMap, type HumanoidBone, type HumanoidMap } from '../../xr/avatar/humanoid';
	import BoneMapEditor from './BoneMapEditor.svelte';

	type ModelListing = Extract<AssetListing, { type: 'model' }>;

	interface Props {
		models: ModelListing[];
		/** Start on the bones step with this model already chosen. */
		initialAssetId?: AssetId;
		/** False when the open project is a world: an avatar is saved as an object, so it would not be wearable from there. */
		canCreate: boolean;
		oncreate: (tree: SlotTree, name: string) => void;
		onclose: () => void;
	}

	let { models, initialAssetId, canCreate, oncreate, onclose }: Props = $props();

	const ROLE_NAMES: Partial<Record<HumanoidBone, string>> = { head: 'head', leftHand: 'left hand', rightHand: 'right hand' };
	// A wizard is opened with everything it needs decided once; later prop changes do not restart it.
	// svelte-ignore state_referenced_locally
	let step = $state<1 | 2 | 3>(initialAssetId ? 2 : 1);
	// svelte-ignore state_referenced_locally
	let assetId = $state<AssetId | null>(initialAssetId ?? null);
	let joints = $state<string[]>([]);
	let map = $state<HumanoidMap>({});
	let height = $state(1.6);
	let name = $state('');
	let shoulderSocket = $state(true);
	let hipSocket = $state(true);
	let loading = $state(false);
	let problem = $state('');

	const model = $derived(models.find((candidate) => candidate.assetId === assetId) ?? null);
	const capabilities = $derived(avatarCapabilities(map));
	const missing = $derived(REQUIRED_BONES.filter((role) => !map[role]));
	const detected = $derived(BODY_BONES.filter((role) => map[role]).length);

	/** Bone names come from the manifest, or, for a model imported before that was recorded, from the file itself. */
	async function readJoints(listing: ModelListing): Promise<string[]> {
		if (listing.skeleton) return listing.skeleton.joints;
		const bytes = await getLocalAssetStore().getBytes(listing.assetId);
		return bytes ? (parseGlb(bytes).skeleton?.joints ?? []) : [];
	}

	async function choose(listing: ModelListing) {
		assetId = listing.assetId;
		loading = true;
		problem = '';
		try {
			joints = await readJoints(listing);
			if (joints.length === 0) {
				problem = 'This model has no skeleton, so it cannot be worn. Export it with a rig (a skinned .glb).';
				return;
			}
			map = detectHumanoidMap(joints);
			height = eyeHeightOf(listing.bounds);
			name = listing.name;
			step = 2;
		} catch (error) {
			problem = error instanceof Error ? error.message : 'The model could not be read.';
		} finally {
			loading = false;
		}
	}

	// svelte-ignore state_referenced_locally
	if (initialAssetId) {
		const initial = models.find((candidate) => candidate.assetId === initialAssetId);
		if (initial) void choose(initial);
	}

	function create() {
		if (!model || !capabilities.wearable) return;
		const tree = buildAvatarTree(
			{ assetId: model.assetId, name: name.trim() || model.name, joints, bounds: model.bounds },
			{ bones: map, height, sockets: { shoulder: shoulderSocket, hip: hipSocket } }
		);
		oncreate(tree, name.trim() || model.name);
	}

	const mark = (ok: boolean) => (ok ? '✓' : '—');
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="studio-backdrop" onclick={(event) => event.target === event.currentTarget && onclose()}>
	<div class="studio-modal wizard" role="dialog" aria-modal="true" aria-label="Create avatar">
		<ol class="steps" aria-label="Progress">
			<li class:active={step === 1} class:done={step > 1}>1 · Model</li>
			<li class:active={step === 2} class:done={step > 2}>2 · Bones</li>
			<li class:active={step === 3}>3 · Create</li>
		</ol>

		{#if step === 1}
			<h2>Choose a rigged model</h2>
			<p>An avatar is a skinned .glb with a skeleton. Import one from the Library panel first if it is not listed.</p>
			{#if models.length}
				<ul class="models">
					{#each models as listing (listing.assetId)}
						<li>
							<button type="button" class="pick" class:selected={listing.assetId === assetId} disabled={loading} onclick={() => choose(listing)}>
								<strong>{listing.name}</strong>
								<span class="muted">{listing.triangles.toLocaleString('en-US')} tris{listing.skeleton ? ` · ${listing.skeleton.joints.length} bones` : ''}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="notice">No models on this device yet.</p>
			{/if}
			{#if problem}<p class="notice error" role="alert">{problem}</p>{/if}
			<div class="actions">
				<button type="button" class="btn" disabled={studioModels.importing} onclick={() => studioModels.pickAndImport()}>{studioModels.importing ? 'Importing…' : 'Import .glb'}</button>
				<button type="button" class="btn" onclick={onclose}>Cancel</button>
			</div>
		{:else if step === 2}
			<h2>Match the bones</h2>
			<p>
				Found {detected} of {BODY_BONES.length} body bones in “{model?.name}”. Head and both hands are required; the rest make the body move more naturally.
			</p>
			<BoneMapEditor value={map} {joints} onchange={(next) => (map = next)} />
			{#if missing.length}<p class="notice error" role="alert">Still needed: {missing.map((role) => ROLE_NAMES[role] ?? role).join(', ')}.</p>{/if}
			<div class="actions">
				<button type="button" class="btn" onclick={() => (step = 1)}>Back</button>
				<button type="button" class="btn primary" disabled={!capabilities.wearable} onclick={() => (step = 3)}>Next</button>
			</div>
		{:else}
			<h2>Finish</h2>
			<label class="field">
				<span>Name</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input class="input" bind:value={name} autofocus />
			</label>
			<label class="field">
				<span>Eye height (m)</span>
				<input class="input" type="number" min="0.3" max="3" step="0.01" bind:value={height} />
				<small class="muted">The body is scaled so the model’s eyes meet the player’s real height.</small>
			</label>
			<fieldset class="options">
				<legend>Carrying spots</legend>
				<label class="check"><input type="checkbox" bind:checked={shoulderSocket} /> Shoulder socket — a place to keep an item within reach</label>
				<label class="check"><input type="checkbox" bind:checked={hipSocket} /> Hip socket</label>
			</fieldset>
			<div class="caps" aria-label="What this avatar can do">
				<span>Head {mark(capabilities.wearable)}</span>
				<span>Left arm {mark(capabilities.arms.left)}</span>
				<span>Right arm {mark(capabilities.arms.right)}</span>
				<span>Legs {mark(capabilities.legs.left && capabilities.legs.right)}</span>
				<span>Crouch {mark(capabilities.crouch)}</span>
				<span>Fingers L {capabilities.fingers.left}/5 · R {capabilities.fingers.right}/5</span>
			</div>
			{#if !canCreate}<p class="notice error" role="alert">This project is a world. Open or create an object project to build an avatar in.</p>{/if}
			<p class="muted">The avatar is added to this project. Save it as an object, then choose “Set as default” from your inventory in the game.</p>
			<div class="actions">
				<button type="button" class="btn" onclick={() => (step = 2)}>Back</button>
				<button type="button" class="btn primary" disabled={!canCreate || !name.trim()} onclick={create}>Create avatar</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.wizard { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; }
	.steps { display: flex; gap: 6px; margin: 0 0 14px; padding: 0; list-style: none; font-size: 12px; color: var(--muted); }
	.steps li { padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); }
	.steps li.active { color: var(--text); border-color: var(--accent); background: var(--accent-soft); }
	.steps li.done { color: var(--success); }
	.models { display: grid; gap: 6px; max-height: 260px; margin: 0 0 8px; padding: 0; overflow-y: auto; list-style: none; }
	.pick { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
	.pick:hover:not(:disabled), .pick.selected { border-color: var(--accent); background: var(--accent-soft); }
	.field { display: grid; gap: 4px; margin-bottom: 12px; color: var(--muted); font-size: 12px; }
	fieldset { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; }
	legend { margin-bottom: 6px; padding: 0; color: var(--muted); font-size: 12px; }
	.options { margin-bottom: 12px; }
	.check { display: flex; align-items: center; gap: 8px; }
	.caps { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 12px; font-size: 12px; color: var(--muted); }
	.notice { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; }
	.notice.error { border-color: var(--danger, #f87171); color: var(--danger, #f87171); }
</style>
