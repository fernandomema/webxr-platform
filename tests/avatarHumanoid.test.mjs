import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalBoneName, detectHumanoidMap, missingRequiredBones, pruneHumanoidMap } from '../src/lib/xr/avatar/humanoid.ts';

test('canonicalBoneName strips rig prefixes and separators', () => {
	assert.equal(canonicalBoneName('mixamorig:LeftForeArm'), 'leftforearm');
	assert.equal(canonicalBoneName('mixamorig1:Hips'), 'hips');
	assert.equal(canonicalBoneName('Armature|Head'), 'head');
	assert.equal(canonicalBoneName('J_Bip_L_UpperArm'), 'leftupperarm');
	assert.equal(canonicalBoneName('J_Bip_C_Hips'), 'hips');
	assert.equal(canonicalBoneName('hand.R'), 'handr');
});

test('detects a Mixamo rig', () => {
	const names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
		'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']
		.map((n) => `mixamorig:${n}`);
	const map = detectHumanoidMap(names);
	assert.equal(map.head, 'mixamorig:Head');
	assert.equal(map.leftHand, 'mixamorig:LeftHand');
	assert.equal(map.rightLowerArm, 'mixamorig:RightForeArm');
	assert.equal(map.leftUpperLeg, 'mixamorig:LeftUpLeg');
	assert.equal(map.rightLowerLeg, 'mixamorig:RightLeg');
	assert.equal(map.chest, 'mixamorig:Spine2');
	assert.deepEqual(missingRequiredBones(map), []);
});

test('detects a Blender .L/.R rig and a VRM rig', () => {
	const blender = detectHumanoidMap(['hips', 'head', 'upperarm.L', 'forearm.L', 'hand.L', 'upperarm.R', 'forearm.R', 'hand.R']);
	assert.equal(blender.leftUpperArm, 'upperarm.L');
	assert.equal(blender.rightHand, 'hand.R');
	const vrm = detectHumanoidMap(['J_Bip_C_Hips', 'J_Bip_C_Head', 'J_Bip_L_Hand', 'J_Bip_R_Hand', 'J_Bip_L_UpperArm']);
	assert.equal(vrm.head, 'J_Bip_C_Head');
	assert.equal(vrm.leftHand, 'J_Bip_L_Hand');
	assert.equal(vrm.rightHand, 'J_Bip_R_Hand');
	assert.equal(vrm.leftUpperArm, 'J_Bip_L_UpperArm');
});

test('an unknown rig yields a sparse map and reports what is missing', () => {
	const map = detectHumanoidMap(['bone_001', 'bone_002']);
	assert.deepEqual(map, {});
	assert.deepEqual(missingRequiredBones(map), ['head', 'leftHand', 'rightHand']);
});

test('pruneHumanoidMap drops roles pointing at bones that do not exist', () => {
	assert.deepEqual(pruneHumanoidMap({ head: 'Head', leftHand: 'Gone' }, ['Head']), { head: 'Head' });
});

import { avatarCapabilities } from '../src/lib/xr/avatar/humanoid.ts';

test('avatarCapabilities reports what a bone map can do', () => {
	const full = detectHumanoidMap(['Hips', 'Head', 'LeftUpperArm', 'LeftForeArm', 'LeftHand', 'RightUpperArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot']);
	const caps = avatarCapabilities(full);
	assert.deepEqual(caps, { wearable: true, arms: { left: true, right: true }, legs: { left: true, right: false }, fingers: { left: 0, right: 0 }, crouch: true });
	const bare = avatarCapabilities({ head: 'Head', leftHand: 'L', rightHand: 'R' });
	assert.equal(bare.wearable, true);
	assert.equal(bare.crouch, false);
	assert.equal(avatarCapabilities({ head: 'Head' }).wearable, false);
});

test('finger joints are detected in Mixamo, VRM and Blender naming', () => {
	const mixamo = detectHumanoidMap(['mixamorig:LeftHandIndex1', 'mixamorig:LeftHandIndex2', 'mixamorig:LeftHandIndex3', 'mixamorig:RightHandPinky1', 'mixamorig:LeftHandThumb2']);
	assert.equal(mixamo.leftIndex2, 'mixamorig:LeftHandIndex2');
	assert.equal(mixamo.rightLittle1, 'mixamorig:RightHandPinky1');
	assert.equal(mixamo.leftThumb2, 'mixamorig:LeftHandThumb2');
	const vrm = detectHumanoidMap(['J_Bip_L_Middle1', 'J_Bip_R_Little3', 'J_Bip_R_Ring2']);
	assert.equal(vrm.leftMiddle1, 'J_Bip_L_Middle1');
	assert.equal(vrm.rightLittle3, 'J_Bip_R_Little3');
	assert.equal(vrm.rightRing2, 'J_Bip_R_Ring2');
	const blender = detectHumanoidMap(['thumb.01.L', 'f_index.02.R', 'f_pinky.01.L']);
	assert.equal(blender.leftThumb1, 'thumb.01.L');
	assert.equal(blender.rightIndex2, 'f_index.02.R');
	assert.equal(blender.leftLittle1, 'f_pinky.01.L');
});

test('capabilities count the fingers of each hand', () => {
	const map = detectHumanoidMap(['Head', 'LeftHand', 'RightHand', 'LeftHandThumb1', 'LeftHandIndex1', 'LeftHandMiddle1']);
	assert.deepEqual(avatarCapabilities(map).fingers, { left: 3, right: 0 });
});
