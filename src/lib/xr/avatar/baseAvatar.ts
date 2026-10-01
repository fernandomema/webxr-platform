import { importGlb } from '$lib/assets/importGlb';
import { getLocalAssetStore } from '$lib/assets/store';
import type { SlotTree } from '$lib/ecs/types';
import { buildAvatarTree } from './build';
import type { HumanoidMap } from './humanoid';

/** "Subject 7" by Cherryvania, CC BY 4.0 (see static/avatars/CREDITS.md). */
const BASE_AVATAR_URL = '/avatars/subject-7.glb';

/** Its bones carry a numeric suffix and Blender-style names, which the detector does not guess, so they are listed here. */
const BASE_AVATAR_BONES: HumanoidMap = {
	hips: 'Hips_01', spine: 'Spine_02', chest: 'Chest_03', neck: 'Neck_04', head: 'Head_05',
	leftShoulder: 'shoulder.L_032', leftUpperArm: 'upper_arm.L_033', leftLowerArm: 'forearm.L_034', leftHand: 'hand.L_035',
	rightShoulder: 'shoulder.R_050', rightUpperArm: 'upper_arm.R_051', rightLowerArm: 'forearm.R_052', rightHand: 'hand.R_053',
	leftUpperLeg: 'thigh.L_076', leftLowerLeg: 'shin.L_077', leftFoot: 'foot.L_078',
	rightUpperLeg: 'thigh.R_081', rightLowerLeg: 'shin.R_082', rightFoot: 'foot.R_083',
	leftThumb1: 'thumb.01.L_038', leftThumb2: 'thumb.02.L_039',
	leftIndex1: 'f_index.01.L_036', leftIndex2: 'f_index.02.L_00', leftIndex3: 'f_index.03.L_037',
	leftMiddle1: 'f_middle.01.L_040', leftMiddle2: 'f_middle.02.L_041', leftMiddle3: 'f_middle.03.L_042',
	leftRing1: 'f_ring.01.L_043', leftRing2: 'f_ring.02.L_044', leftRing3: 'f_ring.03.L_045',
	leftLittle1: 'f_pinky.01.L_046', leftLittle2: 'f_pinky.02.L_047', leftLittle3: 'f_pinky.03.L_048',
	rightThumb1: 'thumb.01.R_057', rightThumb2: 'thumb.02.R_058',
	rightIndex1: 'f_index.01.R_054', rightIndex2: 'f_index.02.R_055', rightIndex3: 'f_index.03.R_056',
	rightMiddle1: 'f_middle.01.R_059', rightMiddle2: 'f_middle.02.R_060', rightMiddle3: 'f_middle.03.R_061',
	rightRing1: 'f_ring.01.R_062', rightRing2: 'f_ring.02.R_063', rightRing3: 'f_ring.03.R_064',
	rightLittle1: 'f_pinky.01.R_065', rightLittle2: 'f_pinky.02.R_066', rightLittle3: 'f_pinky.03.R_067'
};

/** Standing eye height of the model in metres; its measured bounds are skewed by the rig's root rotations. */
const BASE_AVATAR_HEIGHT = 2.55;

let cached: Promise<SlotTree | null> | null = null;

/**
 * The avatar everyone wears until they choose one. Its model ships with the app; importing it into the
 * local asset store gives it the same content address on every device, so it travels to guests like any
 * other model. Resolves to null if it cannot be loaded (the ghost stand-in is used then).
 */
export function loadBaseAvatar(): Promise<SlotTree | null> {
	cached ??= (async () => {
		try {
			const response = await fetch(BASE_AVATAR_URL);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const { manifest } = await importGlb(new Uint8Array(await response.arrayBuffer()), 'Subject 7', getLocalAssetStore());
			if (manifest.type !== 'model') return null;
			return buildAvatarTree({ assetId: manifest.assetId, name: 'Avatar', joints: manifest.skeleton?.joints ?? [], bounds: manifest.bounds }, { bones: BASE_AVATAR_BONES, height: BASE_AVATAR_HEIGHT });
		} catch (error) {
			console.warn('[avatar] the base avatar could not be loaded', error);
			return null;
		}
	})();
	return cached;
}
