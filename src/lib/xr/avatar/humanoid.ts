/**
 * Humanoid bone roles an avatar can be driven through, and a best-effort
 * detector that maps them onto the bone names found in a skinned GLB.
 * Pure: no Babylon, so it runs (and is tested) in Node.
 */

export const BODY_BONES = [
	'hips', 'spine', 'chest', 'neck', 'head',
	'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
	'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
	'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
	'rightUpperLeg', 'rightLowerLeg', 'rightFoot'
] as const;

const FINGER_CAPS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;

/** `leftIndex2` is the middle joint of the left index finger. Three joints per finger; a fourth tip bone is ignored. */
export type FingerBone = `${'left' | 'right'}${(typeof FINGER_CAPS)[number]}${1 | 2 | 3}`;

export const FINGER_BONES: readonly FingerBone[] = (['left', 'right'] as const).flatMap((side) =>
	FINGER_CAPS.flatMap((finger) => ([1, 2, 3] as const).map((joint) => `${side}${finger}${joint}` as FingerBone))
);

export type HumanoidBone = (typeof BODY_BONES)[number] | FingerBone;

export const HUMANOID_BONES: readonly HumanoidBone[] = [...BODY_BONES, ...FINGER_BONES];

/** The joints of one finger, base to tip, as bone roles. */
export const fingerJoints = (side: 'left' | 'right', finger: (typeof FINGER_CAPS)[number]): [FingerBone, FingerBone, FingerBone] => [
	`${side}${finger}1`, `${side}${finger}2`, `${side}${finger}3`
];

/** Role to the bone name in the model. Roles the model does not have are simply absent. */
export type HumanoidMap = Partial<Record<HumanoidBone, string>>;

/** Bones the puppet cannot work without. Everything else degrades gracefully. */
export const REQUIRED_BONES: readonly HumanoidBone[] = ['head', 'leftHand', 'rightHand'];

type Side = 'left' | 'right';

/** Canonical (lower-cased, separator-free, prefix-free) names per role, side-agnostic ones use `{s}`. */
const ALIASES: Record<string, string[]> = {
	hips: ['hips', 'pelvis', 'root_hips', 'hip'],
	spine: ['spine', 'spine1', 'spine01', 'abdomen'],
	chest: ['chest', 'spine2', 'spine02', 'upperchest', 'spine3', 'torso'],
	neck: ['neck', 'neck1'],
	head: ['head'],
	shoulder: ['{s}shoulder', '{s}clavicle', 'clavicle{s}', 'shoulder{s}', 'clavicle{s2}', '{s2}clavicle'],
	upperArm: ['{s}arm', '{s}upperarm', 'upperarm{s}', 'arm{s}', 'upperarm{s2}', 'arm{s2}', '{s2}upperarm', '{s2}arm'],
	lowerArm: ['{s}forearm', '{s}lowerarm', 'lowerarm{s}', 'forearm{s}', 'lowerarm{s2}', 'forearm{s2}', '{s2}lowerarm', '{s2}forearm'],
	hand: ['{s}hand', 'hand{s}', 'hand{s2}', '{s2}hand'],
	upperLeg: ['{s}upleg', '{s}upperleg', '{s}thigh', 'upperleg{s}', 'thigh{s}', 'upperleg{s2}', 'thigh{s2}', '{s2}upperleg', '{s2}thigh'],
	lowerLeg: ['{s}leg', '{s}lowerleg', '{s}calf', '{s}shin', 'lowerleg{s}', 'calf{s}', 'leg{s}', 'lowerleg{s2}', 'calf{s2}', '{s2}lowerleg', '{s2}calf'],
	foot: ['{s}foot', 'foot{s}', 'foot{s2}', '{s2}foot']
};

const SIDE_FORMS: Record<Side, { s: string; s2: string }> = {
	left: { s: 'left', s2: 'l' },
	right: { s: 'right', s2: 'r' }
};

/** Strips rig prefixes (`mixamorig:`, `Armature|`, `J_Bip_C_`...) and separators, then lower-cases. */
export function canonicalBoneName(name: string): string {
	let value = name.trim();
	value = value.replace(/^.*[:|]/, ''); // "mixamorig:Hips", "Armature|Hips"
	value = value.replace(/^j_bip_([lcr])_/i, (_, side: string) => ({ l: 'left', r: 'right', c: '' })[side.toLowerCase()] ?? '');
	value = value.replace(/^(bip\d*[ _]|cc_base_|def[-_]|mixamorig)/i, '');
	value = value.replace(/[\s._\-]+/g, '').toLowerCase();
	return value;
}

function expand(pattern: string, side: Side): string {
	const forms = SIDE_FORMS[side];
	return pattern.replace('{s2}', forms.s2).replace('{s}', forms.s);
}

const ROLE_KEYS: Record<string, (side: Side) => HumanoidBone> = {
	shoulder: (side) => `${side}Shoulder`,
	upperArm: (side) => `${side}UpperArm`,
	lowerArm: (side) => `${side}LowerArm`,
	hand: (side) => `${side}Hand`,
	upperLeg: (side) => `${side}UpperLeg`,
	lowerLeg: (side) => `${side}LowerLeg`,
	foot: (side) => `${side}Foot`
};

/**
 * Best-effort mapping from a model's bone names to humanoid roles. Handles the
 * common conventions (Mixamo, VRM/VRoid, Ready Player Me, Blender `.L/.R`).
 * Exact canonical matches win; nothing is guessed from partial matches, so an
 * unknown rig yields a sparse map the user can complete by hand.
 */
export function detectHumanoidMap(boneNames: readonly string[]): HumanoidMap {
	const byCanonical = new Map<string, string>();
	for (const name of boneNames) {
		const key = canonicalBoneName(name);
		if (key && !byCanonical.has(key)) byCanonical.set(key, name);
	}
	const map: HumanoidMap = {};
	const find = (patterns: string[], side?: Side): string | undefined => {
		for (const pattern of patterns) {
			const key = side ? expand(pattern, side) : pattern;
			const hit = byCanonical.get(key);
			if (hit !== undefined) return hit;
		}
		return undefined;
	};
	for (const role of ['hips', 'spine', 'chest', 'neck', 'head'] as const) {
		const hit = find(ALIASES[role]);
		if (hit !== undefined) map[role] = hit;
	}
	for (const side of ['left', 'right'] as const) {
		for (const role of Object.keys(ROLE_KEYS)) {
			const hit = find(ALIASES[role], side);
			if (hit !== undefined) map[ROLE_KEYS[role](side)] = hit;
		}
	}
	detectFingers(byCanonical, map);
	return map;
}

const FINGER_WORDS: Record<(typeof FINGER_CAPS)[number], string[]> = {
	Thumb: ['thumb'], Index: ['index'], Middle: ['middle'], Ring: ['ring'], Little: ['little', 'pinky', 'pinkie']
};

/** Finger joints are named `LeftHandIndex1` (Mixamo, Ready Player Me), `J_Bip_L_Index1` (VRM) or `f_index.01.L` (Blender). */
function detectFingers(byCanonical: Map<string, string>, map: HumanoidMap): void {
	for (const [side, s2] of [['left', 'l'], ['right', 'r']] as const) {
		for (const finger of FINGER_CAPS) {
			for (const joint of [1, 2, 3] as const) {
				for (const word of FINGER_WORDS[finger]) {
					const candidates = [`${side}hand${word}${joint}`, `${side}${word}${joint}`, `${word}0${joint}${s2}`, `f${word}0${joint}${s2}`, `${word}${joint}${s2}`, `${word}${joint}${side}`];
					const hit = candidates.map((key) => byCanonical.get(key)).find((name) => name !== undefined);
					if (hit !== undefined) {
						map[`${side}${finger}${joint}`] = hit;
						break;
					}
				}
			}
		}
	}
}

/** Required roles that are missing from a map. Empty means the avatar can be puppeted. */
export function missingRequiredBones(map: HumanoidMap): HumanoidBone[] {
	return REQUIRED_BONES.filter((role) => !map[role]);
}

export interface AvatarCapabilities {
	/** Head and both hands are mapped: the avatar can be worn at all. */
	wearable: boolean;
	/** Which arms can reach for a hand (shoulder to hand chain complete). */
	arms: { left: boolean; right: boolean };
	/** How many of each hand's five fingers have at least their first joint mapped. */
	fingers: { left: number; right: number };
	/** Which legs can plant a foot (hip to foot chain complete) and whether hips exist to lower when crouching. */
	legs: { left: boolean; right: boolean };
	crouch: boolean;
}

/** What a bone map lets the puppet do, for showing in the avatar wizard. */
export function avatarCapabilities(map: HumanoidMap): AvatarCapabilities {
	const has = (...roles: HumanoidBone[]) => roles.every((role) => Boolean(map[role]));
	const legs = { left: has('leftUpperLeg', 'leftLowerLeg', 'leftFoot'), right: has('rightUpperLeg', 'rightLowerLeg', 'rightFoot') };
	return {
		wearable: missingRequiredBones(map).length === 0,
		arms: { left: has('leftUpperArm', 'leftLowerArm', 'leftHand'), right: has('rightUpperArm', 'rightLowerArm', 'rightHand') },
		legs,
		fingers: {
			left: FINGER_CAPS.filter((finger) => has(`left${finger}1`)).length,
			right: FINGER_CAPS.filter((finger) => has(`right${finger}1`)).length
		},
		crouch: has('hips') && (legs.left || legs.right)
	};
}

/** Drops roles that point at a bone the model does not have (a stale hand-edited map). */
export function pruneHumanoidMap(map: HumanoidMap, boneNames: readonly string[]): HumanoidMap {
	const known = new Set(boneNames);
	const out: HumanoidMap = {};
	for (const role of HUMANOID_BONES) {
		const bone = map[role];
		if (bone !== undefined && known.has(bone)) out[role] = bone;
	}
	return out;
}
