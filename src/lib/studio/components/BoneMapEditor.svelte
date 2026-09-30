<script lang="ts">
	import Select, { type SelectOption } from '../ui/Select.svelte';
	import Tooltip from '../ui/Tooltip.svelte';
	import Icon from '../ui/Icon.svelte';
	import { BODY_BONES, REQUIRED_BONES, avatarCapabilities, detectHumanoidMap, fingerJoints, pruneHumanoidMap, type HumanoidBone, type HumanoidMap } from '../../xr/avatar/humanoid';

	interface Props {
		value: HumanoidMap;
		/** The bones of the avatar's model. Empty when the model is not on this device. */
		joints: readonly string[];
		onchange: (map: HumanoidMap) => void;
	}

	let { value, joints, onchange }: Props = $props();

	const LABELS: Partial<Record<HumanoidBone, string>> = {
		hips: 'Hips', spine: 'Spine', chest: 'Chest', neck: 'Neck', head: 'Head',
		leftShoulder: 'Shoulder', leftUpperArm: 'Upper arm', leftLowerArm: 'Forearm', leftHand: 'Hand',
		rightShoulder: 'Shoulder', rightUpperArm: 'Upper arm', rightLowerArm: 'Forearm', rightHand: 'Hand',
		leftUpperLeg: 'Thigh', leftLowerLeg: 'Shin', leftFoot: 'Foot',
		rightUpperLeg: 'Thigh', rightLowerLeg: 'Shin', rightFoot: 'Foot'
	};
	const SECTIONS: { title: string; roles: HumanoidBone[] }[] = [
		{ title: 'Body', roles: ['hips', 'spine', 'chest', 'neck', 'head'] },
		{ title: 'Left arm', roles: ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'] },
		{ title: 'Right arm', roles: ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'] },
		{ title: 'Legs', roles: ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'] }
	];
	const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;

	const known = $derived(new Set(joints));
	const capabilities = $derived(avatarCapabilities(value));
	const stale = $derived(Object.entries(value).filter(([, bone]) => bone && joints.length > 0 && !known.has(bone)).length);
	const missing = $derived(REQUIRED_BONES.filter((role) => !value[role]));
	const mappedBody = $derived(BODY_BONES.filter((role) => value[role]).length);

	function set(role: HumanoidBone, bone: string) {
		const next = { ...value };
		if (bone) next[role] = bone;
		else delete next[role];
		onchange(next);
	}

	/** Fills what is empty from the model's own bone names and drops entries the model no longer has; keeps what was picked by hand. */
	function fill() {
		onchange({ ...detectHumanoidMap(joints), ...pruneHumanoidMap(value, joints) });
	}
	function detectAgain() {
		onchange(detectHumanoidMap(joints));
	}
	/** Which collapsible sections the user has toggled; the rest follow their default. */
	let toggled = $state<Record<string, boolean>>({});
	const isOpen = (key: string, fallback: boolean) => toggled[key] ?? fallback;
	const toggle = (key: string, fallback: boolean) => (toggled[key] = !isOpen(key, fallback));

	function options(current: string, none: string): SelectOption[] {
		return [
			{ value: '', label: none },
			...(current && !known.has(current) ? [{ value: current, label: `${current} (not in model)`, disabled: true }] : []),
			...joints.map((joint) => ({ value: joint, label: joint }))
		];
	}
	const mark = (ok: boolean) => (ok ? '✓' : '—');
</script>

<div class="bones">
	{#if joints.length === 0}
		<p class="notice">This avatar’s model is not on this device, so its bones cannot be listed. Import the model (Library → Models) to edit them.</p>
	{:else}
		<div class="summary" aria-label="What this bone map allows">
			<span class:ok={capabilities.wearable}>Wearable {mark(capabilities.wearable)}</span>
			<span class:ok={capabilities.arms.left && capabilities.arms.right}>Arms {mark(capabilities.arms.left && capabilities.arms.right)}</span>
			<span class:ok={capabilities.legs.left && capabilities.legs.right}>Legs {mark(capabilities.legs.left && capabilities.legs.right)}</span>
			<span class:ok={capabilities.fingers.left === 5 && capabilities.fingers.right === 5}>Fingers {capabilities.fingers.left + capabilities.fingers.right}/10</span>
		</div>
		{#if missing.length}<p class="notice error">Still needed to wear it: {missing.join(', ')}.</p>{/if}
		{#if stale}<p class="notice error">{stale} mapped {stale === 1 ? 'bone is' : 'bones are'} not in this model any more (marked in red).</p>{/if}
		<div class="tools">
			<Tooltip text="Fill empty roles from the model’s bone names and drop the ones it no longer has" side="top"><button type="button" class="btn sm" onclick={fill}>Fix &amp; fill</button></Tooltip>
			<Tooltip text="Throw the map away and detect it again from the model" side="top"><button type="button" class="btn sm" onclick={detectAgain}>Detect again</button></Tooltip>
			<span class="muted">{mappedBody}/{BODY_BONES.length} body bones</span>
		</div>

		{#each SECTIONS as section (section.title)}
			{@const fallback = section.title === 'Body' || missing.some((role) => section.roles.includes(role))}
			<div class="section">
				<button type="button" class="summary-btn" aria-expanded={isOpen(section.title, fallback)} onclick={() => toggle(section.title, fallback)}>
					<Icon name={isOpen(section.title, fallback) ? 'chevron-down' : 'chevron-right'} size={12} />{section.title}
				</button>
				{#if isOpen(section.title, fallback)}<div class="rows">
					{#each section.roles as role (role)}
						{@const current = value[role] ?? ''}
						<div class="role" class:required={REQUIRED_BONES.includes(role)} class:unset={!current} class:bad={current && !known.has(current)}>
							<span>{LABELS[role]}{REQUIRED_BONES.includes(role) ? ' *' : ''}</span>
							<Select searchable label={LABELS[role] ?? role} value={current} invalid={Boolean(current && !known.has(current))} options={options(current, '— none —')} onchange={(bone) => set(role, bone)} />
						</div>
					{/each}
				</div>{/if}
			</div>
		{/each}

		{#each ['left', 'right'] as const as side (side)}
			<div class="section">
				<button type="button" class="summary-btn" aria-expanded={isOpen(`${side}-fingers`, false)} onclick={() => toggle(`${side}-fingers`, false)}>
					<Icon name={isOpen(`${side}-fingers`, false) ? 'chevron-down' : 'chevron-right'} size={12} />{side === 'left' ? 'Left' : 'Right'} fingers ({capabilities.fingers[side]}/5)
				</button>
				{#if isOpen(`${side}-fingers`, false)}<div class="fingers">
					{#each FINGERS as finger (finger)}
						<span class="finger-name">{finger}</span>
						{#each fingerJoints(side, finger) as role, index (role)}
							{@const current = value[role] ?? ''}
							<Select searchable label={`${side} ${finger} joint ${index + 1}`} value={current} invalid={Boolean(current && !known.has(current))} options={options(current, '—')} onchange={(bone) => set(role, bone)} />
						{/each}
					{/each}
				</div>{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	.bones { display: grid; gap: 8px; width: 100%; min-width: 0; }
	.summary { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--muted); }
	.summary .ok { color: var(--success); }
	.tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
	.notice { margin: 0; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; font-size: 12px; }
	.notice.error { border-color: var(--danger); color: var(--danger); }
	.section { border: 1px solid var(--border); border-radius: 8px; padding: 4px 8px; }
	.summary-btn { display: flex; align-items: center; gap: 6px; width: 100%; min-height: var(--control-h, 30px); padding: 0; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
	.rows { display: grid; gap: 6px; padding: 6px 0; }
	.role { display: grid; grid-template-columns: 84px 1fr; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
	.role.required.unset span, .role.bad span { color: var(--danger); }
	.fingers { display: grid; grid-template-columns: 52px repeat(3, minmax(0, 1fr)); gap: 4px; align-items: center; padding: 6px 0; font-size: 11px; }
	.finger-name { font-size: 11px; color: var(--muted); }
</style>
