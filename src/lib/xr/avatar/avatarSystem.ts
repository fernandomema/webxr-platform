import { Matrix, Quaternion, Vector3, WebXRState, type Skeleton, type Scene, type TransformNode, type WebXRDefaultExperience, type Camera } from '@babylonjs/core';
import { findComponent, type AvatarComponent, type Vec3 } from '$lib/ecs/types';
import type { SceneGraph } from '../sceneGraph';
import type { HandPose, TransformPose } from './defaultAvatar';
import { readHandPoses } from './localHands';
import { defaultHandModel, holdingBends, solveGraspFull, type FingerModel, type HandModel } from './grasp';
import { graspObstacles } from './graspShapes';
import { FINGER_NAMES, OPEN_HAND, bendsFromCurls, conjugate, easeValues, handFrameFromKnuckles, parseBends, parseCurls, parseThumbDirections, rotateVector as rotateBy } from './fingers';
import { detectHumanoidMap, fingerJoints, missingRequiredBones, pruneHumanoidMap, type HumanoidBone } from './humanoid';
import { mirrorRenderHooks } from '../mirrorHooks';
import { newFoot, smoothVelocity, stepFoot, type Foot } from './gait';
import { arcBetween, followYaw, headYaw, restFacingYaw, solveTwoBone, updateStandingHeight, type Q4, type V3 } from './ik';

/**
 * Drives every avatar slot from its owner's pose, like a puppet: the body stands under the head and
 * turns after it, the head bone copies the head, and the arms reach for the hands with two-bone IK.
 * The pose is never stored in the scene: the local player's comes from the camera and controllers,
 * everyone else's from the presence packets that already arrive at 20 Hz.
 *
 * The maths works in each bone's parent space rather than in world quaternions, because the glTF
 * loader wraps a model in a mirrored root and mirrored world matrices do not decompose into a
 * usable rotation.
 */

export interface AvatarPose {
	head: TransformPose;
	left?: HandPose;
	right?: HandPose;
}

export interface AvatarSystemOptions {
	getLocalPlayerId(): string;
	getCamera(): Camera;
	getXr(): WebXRDefaultExperience | null;
	/** Ground height under a world x/z. Defaults to 0. */
	getFloorY?(x: number, z: number): number;
	/** What each of a player's hands has equipped, so an object with Auto grip can be wrapped by the fingers. */
	getHeldSlots?(playerId: string): { left?: HeldItem | null; right?: HeldItem | null };
}

/** A grasp worked out for a hand: the finger angles, and how far the thumb turned across the palm to press on the object. */
interface Grasp {
	key: string;
	bends: number[];
	thumbSwing: number;
}

/** What a hand has hold of: the slot, and whether it is equipped in the hand or just grabbed. */
export interface HeldItem {
	slotId: string;
	via: 'equip' | 'grab';
}

type ArmBones = { upper: TransformNode; lower: TransformNode; hand: TransformNode };
type LegBones = { upper: TransformNode; lower: TransformNode; foot: TransformNode };

/** One finger: its joints from the base out, the axis (in each joint's parent space) that curls it towards the palm, and its rest rotations. */
interface FingerChain {
	bones: TransformNode[];
	axes: Vector3[];
	rest: Quaternion[];
	/** Which way each joint's segment points at rest, in its parent's space: what aiming a joint at a tracked direction starts from. */
	restDirections: Vector3[];
}

interface Rig {
	slotId: string;
	root: TransformNode;
	head: TransformNode;
	arms: { left?: ArmBones; right?: ArmBones };
	/** Present when the model has a hips bone: crouching then lowers the hips and bends the legs instead of sinking the whole body. */
	hips?: TransformNode;
	restHipsY: number;
	skeletons: Skeleton[];
	fingers: Record<'left' | 'right', FingerChain[]>;
	/** The joint angles currently shown per hand (15: thumb to little, three joints each), eased towards the latest ones received. */
	bends: Record<'left' | 'right', number[]>;
	/** Where each foot is planted or swinging, so walking looks like steps instead of a body sliding over fixed feet. */
	feet: { left?: Foot; right?: Foot };
	/** Each hand's fingers as measured on this model (lengths in the root's own units), for closing them round an object. */
	handModels: { left: HandModel; right: HandModel };
	/** The last grasp worked out per hand, kept until the object moves in the hand. */
	grasps: { left: Grasp | null; right: Grasp | null };
	/** How far each thumb's curl plane is turned to reach what it grips, eased. */
	thumbSwing: { left: number; right: number };
	/** The body's horizontal velocity, eased, used to aim each step ahead. */
	velocity: V3;
	lastRoot: V3 | null;
	legs: { left?: LegBones; right?: LegBones };
	/** Rest foot position in the avatar root's space, per side. */
	restFoot: { left?: Vector3; right?: Vector3 };
	legLengths: { left: [number, number]; right: [number, number] };
	/** Rest orientation of each driven bone relative to the avatar root: rows are the bone's axes, rotation only. */
	restRel: Map<TransformNode, Matrix>;
	restLocal: Map<TransformNode, Quaternion>;
	restHeadOffset: Vector3;
	restEyeHeight: number;
	lengths: { left: [number, number]; right: [number, number] };
	facing: number;
	yaw: number;
	yawReady: boolean;
	standing: number;
	headHidden: boolean;
}

const UP = Vector3.Up();
const FINGER_CAPS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const;

/** The most a joint may bend (rad): base, middle, tip joint, for the thumb and for the fingers. Rows are joints, columns are fingers. */
const MAX_BEND: number[][] = [
	[1.0, 1.75, 1.75, 1.75, 1.75],
	[1.2, 2.0, 2.0, 2.0, 2.0],
	[1.3, 1.5, 1.5, 1.5, 1.5]
];

const anglesFromCurls = bendsFromCurls;


/** A matrix with its scale and translation removed, keeping any mirroring: only the orientation is left. */
function orientationOf(matrix: Matrix): Matrix {
	const v = Array.from(matrix.asArray());
	for (let row = 0; row < 3; row++) {
		const length = Math.hypot(v[row * 4], v[row * 4 + 1], v[row * 4 + 2]) || 1;
		for (let column = 0; column < 3; column++) v[row * 4 + column] /= length;
	}
	v[3] = v[7] = v[11] = 0;
	v[12] = v[13] = v[14] = 0;
	v[15] = 1;
	return Matrix.FromArray(v);
}

const toQuat = (q: TransformPose['rotation']) => Quaternion.FromArray(q);
const orientationOfQuat = (q: Quaternion): Matrix => {
	const m = new Matrix();
	q.toRotationMatrix(m);
	return m;
};

/**
 * The turn from a model's rest hand (T-pose: palm down, fingers out to the side, thumb forward) to the hand frame that
 * presence carries (fingers forward, back of the hand up, thumb towards the body). A quarter turn about the vertical.
 */
const REST_TO_HAND: Record<'left' | 'right', Matrix> = {
	left: orientationOfQuat(Quaternion.RotationAxis(UP, Math.PI / 2)),
	right: orientationOfQuat(Quaternion.RotationAxis(UP, -Math.PI / 2))
};

export class AvatarSystem {
	private poses = new Map<string, AvatarPose>();
	private rigs = new Map<string, Rig>();
	private driven = new Set<string>();
	private controllersHidden = false;
	private readonly observer;
	private readonly mirrorObservers;
	/** The local player's avatar, whose head is hidden from their own eyes but shown in a mirror. */
	private localRig: Rig | null = null;

	constructor(
		private scene: Scene,
		private sceneGraph: SceneGraph,
		private options: AvatarSystemOptions
	) {
		this.observer = scene.onBeforeRenderObservable.add(() => {
			try {
				this.tick(scene.getEngine().getDeltaTime() / 1000);
			} catch (error) {
				console.error('[avatar] tick threw', error);
			}
		});
		this.mirrorObservers = [
			mirrorRenderHooks.before.add(() => this.setLocalHeadVisible(true)),
			mirrorRenderHooks.after.add(() => this.setLocalHeadVisible(false))
		];
	}

	setRemotePose(playerId: string, pose: AvatarPose): void {
		this.poses.set(playerId, pose);
	}

	removePlayer(playerId: string): void {
		this.poses.delete(playerId);
		this.driven.delete(playerId);
	}

	/** True while this player's avatar model is loaded and being posed, so a stand-in can be hidden. */
	isDriving(playerId: string): boolean {
		return this.driven.has(playerId);
	}

	dispose(): void {
		this.scene.onBeforeRenderObservable.remove(this.observer);
		mirrorRenderHooks.before.remove(this.mirrorObservers[0]);
		mirrorRenderHooks.after.remove(this.mirrorObservers[1]);
		this.setControllersHidden(false);
		this.rigs.clear();
		this.poses.clear();
		this.driven.clear();
	}

	/**
	 * Bone matrices are worked out once per frame, before any mirror renders, so changing the head's scale is not enough:
	 * the skeleton has to be told to recompute for the reflection, and again to put things back.
	 */
	private setLocalHeadVisible(visible: boolean): void {
		const rig = this.localRig;
		if (!rig?.headHidden) return;
		rig.head.scaling.setAll(visible ? 1 : 0.001);
		rig.head.computeWorldMatrix(true);
		for (const skeleton of rig.skeletons) skeleton.prepare(true);
	}

	private readLocalPose(): AvatarPose {
		const xr = this.options.getXr();
		const camera = this.options.getCamera();
		const head: TransformPose = {
			position: camera.globalPosition.asArray() as Vec3,
			rotation: ((camera as { rotationQuaternion?: Quaternion | null }).rotationQuaternion ?? Quaternion.FromEulerAngles((camera as { rotation?: Vector3 }).rotation?.x ?? 0, (camera as { rotation?: Vector3 }).rotation?.y ?? 0, 0)).asArray() as TransformPose['rotation']
		};
		const pose: AvatarPose = { head };
		if (xr?.baseExperience.state === WebXRState.IN_XR) Object.assign(pose, readHandPoses(xr));
		return pose;
	}

	private tick(dt: number): void {
		const localId = this.options.getLocalPlayerId();
		const seen = new Set<string>();
		let localDriven = false;
		for (const entry of this.sceneGraph.allSlots()) {
			const avatar = findComponent(entry.slot, 'avatar');
			const ownerId = avatar?.ownerId;
			if (!avatar || !ownerId) continue;
			const instance = entry.model?.instance;
			if (!instance) continue;
			const pose = ownerId === localId ? this.readLocalPose() : this.poses.get(ownerId);
			if (!pose) continue;
			let rig = this.rigs.get(entry.slot.id);
			if (!rig || rig.root !== entry.node) {
				rig = this.buildRig(entry.slot.id, entry.node, avatar, instance.boneNodes) ?? undefined;
				if (!rig) continue;
				this.rigs.set(entry.slot.id, rig);
			}
			this.drive(rig, avatar, pose, dt, ownerId === localId, ownerId);
			seen.add(ownerId);
			if (ownerId === localId) localDriven = true;
		}
		this.driven = seen;
		if (!localDriven) this.localRig = null;
		for (const [slotId, rig] of this.rigs) {
			if (!this.sceneGraph.getLive(slotId) || this.sceneGraph.getLive(slotId)?.node !== rig.root) this.rigs.delete(slotId);
		}
		this.setControllersHidden(localDriven);
	}

	private buildRig(slotId: string, root: TransformNode, avatar: AvatarComponent, boneNodes: Map<string, TransformNode>): Rig | null {
		const names = [...boneNodes.keys()];
		let map = pruneHumanoidMap(avatar.bones ?? {}, names);
		if (missingRequiredBones(map).length) map = { ...detectHumanoidMap(names), ...map };
		if (missingRequiredBones(map).length) return null;
		const node = (role: HumanoidBone) => (map[role] ? boneNodes.get(map[role]!) : undefined);
		const head = node('head')!;
		const arm = (side: 'left' | 'right'): ArmBones | undefined => {
			const upper = node(`${side}UpperArm`);
			const lower = node(`${side}LowerArm`);
			const hand = node(`${side}Hand`);
			return upper && lower && hand ? { upper, lower, hand } : undefined;
		};
		const arms = { left: arm('left'), right: arm('right') };
		const leg = (side: 'left' | 'right'): LegBones | undefined => {
			const upper = node(`${side}UpperLeg`);
			const lower = node(`${side}LowerLeg`);
			const foot = node(`${side}Foot`);
			return upper && lower && foot ? { upper, lower, foot } : undefined;
		};
		const legs = { left: leg('left'), right: leg('right') };
		const hips = node('hips');

		root.computeWorldMatrix(true);
		const rootInverse = orientationOf(root.getWorldMatrix()).invert();
		const rootFull = root.getWorldMatrix().clone().invert();
		const restRel = new Map<TransformNode, Matrix>();
		const restLocal = new Map<TransformNode, Quaternion>();
		const remember = (bone: TransformNode) => {
			bone.computeWorldMatrix(true);
			restRel.set(bone, orientationOf(bone.getWorldMatrix()).multiply(rootInverse));
			restLocal.set(bone, (bone.rotationQuaternion ?? Quaternion.FromEulerVector(bone.rotation)).clone());
		};
		remember(head);
		for (const side of [arms.left, arms.right]) if (side) [side.upper, side.lower, side.hand].forEach(remember);
		for (const side of [legs.left, legs.right]) if (side) [side.upper, side.lower, side.foot].forEach(remember);

		const local = (bone: TransformNode) => Vector3.TransformCoordinates(bone.getAbsolutePosition(), rootFull);
		const length = (a: TransformNode, b: TransformNode) => Vector3.Distance(local(a), local(b));
		const lengths = {
			left: arms.left ? ([length(arms.left.upper, arms.left.lower), length(arms.left.lower, arms.left.hand)] as [number, number]) : ([0.3, 0.3] as [number, number]),
			right: arms.right ? ([length(arms.right.upper, arms.right.lower), length(arms.right.lower, arms.right.hand)] as [number, number]) : ([0.3, 0.3] as [number, number])
		};
		const legLength = (side?: LegBones): [number, number] => (side ? [length(side.upper, side.lower), length(side.lower, side.foot)] : [0.4, 0.4]);
		const leftX = arms.left ? local(arms.left.hand).x : -1;
		const rightX = arms.right ? local(arms.right.hand).x : 1;
		const restHeadOffset = local(head);

		// Skinned meshes are culled by their bind-pose bounds, which the posed body outgrows.

		/** Finds the curl axis of every joint from the hand's own shape, so it works whichever way a rig's bones happen to be turned. */
		function buildFingers(side: 'left' | 'right'): FingerChain[] {
			const wrist = arms[side]?.hand;
			if (!wrist) return [];
			const position = (bone: TransformNode) => {
				bone.computeWorldMatrix(true);
				return bone.getAbsolutePosition().clone();
			};
			// The palm faces where the back of the hand does not: read that off the knuckles, falling back to a palm-down T-pose.
			const knuckle = (finger: (typeof FINGER_CAPS)[number]) => node(fingerJoints(side, finger)[0]);
			const middle = knuckle('Middle'), indexBone = knuckle('Index'), little = knuckle('Little');
			let palm = new Vector3(0, -1, 0);
			let along = new Vector3(side === 'left' ? -1 : 1, 0, 0);
			if (middle && indexBone && little) {
				const frame = handFrameFromKnuckles(position(wrist).asArray() as V3, position(middle).asArray() as V3, position(indexBone).asArray() as V3, position(little).asArray() as V3, side);
				if (frame) {
					palm = Vector3.FromArray(rotateBy(frame, [0, -1, 0]));
					along = Vector3.FromArray(rotateBy(frame, [0, 0, 1]));
				}
			}
			const chains: FingerChain[] = [];
			FINGER_CAPS.forEach((finger) => {
				const bones: TransformNode[] = [];
				for (const role of fingerJoints(side, finger)) {
					const bone = node(role);
					if (!bone) break;
					bones.push(bone);
				}
				const isThumb = finger === 'Thumb';
				// A thumb closes across the palm, towards the fingers, rather than straight down.
				const target = isThumb ? palm.add(along.scale(0.7)).normalize() : palm;
				const points = bones.map(position);
				const axes: Vector3[] = [];
				const rest: Quaternion[] = [];
				const restDirections: Vector3[] = [];
				bones.forEach((bone, i) => {
					const direction = points[i + 1] ? points[i + 1].subtract(points[i]) : points[i].subtract(points[i - 1] ?? position(wrist));
					const parent = bone.parent as TransformNode | null;
					parent?.computeWorldMatrix(true);
					const inverseParent = parent ? parent.getWorldMatrix().clone().invert() : Matrix.Identity();
					const local = Vector3.TransformNormal(direction, inverseParent);
					const towards = Vector3.TransformNormal(target, inverseParent);
					const axis = Vector3.Cross(local, towards);
					axes.push(axis.lengthSquared() > 1e-10 ? axis.normalize() : new Vector3(0, 0, 1));
					restDirections.push(local.lengthSquared() > 1e-10 ? local.normalize() : new Vector3(1, 0, 0));
					rest.push((bone.rotationQuaternion ?? Quaternion.FromEulerVector(bone.rotation)).clone());
				});
				chains.push(bones.length ? { bones, axes, rest, restDirections } : { bones: [], axes: [], rest: [], restDirections: [] });
			});
			return chains;
		}
		/** The fingers as this model has them, in the hand's frame, so a grasp is worked out for these hands and not for a generic one. */
		function measureHandModel(side: 'left' | 'right'): HandModel {
			const generic = defaultHandModel(side);
			const wrist = arms[side]?.hand;
			const middle = node(fingerJoints(side, 'Middle')[0]), indexBone = node(fingerJoints(side, 'Index')[0]), little = node(fingerJoints(side, 'Little')[0]);
			if (!wrist || !middle || !indexBone || !little) return generic;
			const at = (bone: TransformNode) => (bone.computeWorldMatrix(true), bone.getAbsolutePosition().asArray() as V3);
			const origin = at(wrist);
			const frame = handFrameFromKnuckles(origin, at(middle), at(indexBone), at(little), side);
			if (!frame) return generic;
			const toHand = conjugate(frame);
			const unit = root.scaling.x || 1;
			const local = (p: V3): V3 => {
				const q = rotateBy(toHand, [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]]);
				return [q[0] / unit, q[1] / unit, q[2] / unit];
			};
			return generic.map((base, i): FingerModel => {
				const bones = fingerJoints(side, FINGER_CAPS[i]).map((role) => node(role));
				if (bones.some((bone) => !bone)) return base;
				const p = bones.map((bone) => local(at(bone!)));
				const length = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
				const lengths: [number, number, number] = [length(p[0], p[1]), length(p[1], p[2]), length(p[1], p[2]) * 0.85];
				if (lengths.some((l) => !(l > 1e-4))) return base;
				const direction: V3 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
				const ratio = lengths.reduce((a, b) => a + b, 0) / base.lengths.reduce((a, b) => a + b, 0);
				return { ...base, base: p[0], direction, lengths, radius: base.radius * Math.min(2, Math.max(0.5, ratio)) };
			});
		}
		const fingers = { left: buildFingers('left'), right: buildFingers('right') };
		const skeletons = new Set<Skeleton>();
		for (const mesh of root.getChildMeshes(false)) {
			const skeleton = (mesh as { skeleton?: Skeleton | null }).skeleton;
			if (!skeleton) continue;
			mesh.alwaysSelectAsActiveMesh = true;
			skeletons.add(skeleton);
		}

		return {
			slotId,
			root,
			head,
			arms,
			hips: legs.left || legs.right ? hips : undefined,
			restHipsY: hips?.position.y ?? 0,
			skeletons: [...skeletons],
			fingers,
			bends: { left: anglesFromCurls(OPEN_HAND), right: anglesFromCurls(OPEN_HAND) },
			feet: {},
			handModels: { left: measureHandModel('left'), right: measureHandModel('right') },
			grasps: { left: null, right: null },
			thumbSwing: { left: 0, right: 0 },
			velocity: [0, 0, 0],
			lastRoot: null,
			legs,
			restFoot: { left: legs.left ? local(legs.left.foot) : undefined, right: legs.right ? local(legs.right.foot) : undefined },
			legLengths: { left: legLength(legs.left), right: legLength(legs.right) },
			restRel,
			restLocal,
			restHeadOffset,
			restEyeHeight: restHeadOffset.y + 0.08,
			lengths,
			facing: restFacingYaw(leftX, rightX),
			yaw: 0,
			yawReady: false,
			standing: 1.6,
			headHidden: false
		};
	}

	private drive(rig: Rig, avatar: AvatarComponent, pose: AvatarPose, dt: number, isLocal: boolean, ownerId: string): void {
		const { root } = rig;
		const headPosition = Vector3.FromArray(pose.head.position);
		const headRotation = toQuat(pose.head.rotation);
		const floorY = this.options.getFloorY?.(headPosition.x, headPosition.z) ?? 0;

		rig.standing = updateStandingHeight(rig.standing, headPosition.y - floorY, dt);
		const eye = avatar.height > 0 ? avatar.height : rig.restEyeHeight;
		const scale = Math.min(1.6, Math.max(0.6, rig.standing / eye));

		const targetYaw = headYaw(pose.head.rotation as Q4);
		rig.yaw = rig.yawReady ? followYaw(rig.yaw, targetYaw, dt) : targetYaw;
		rig.yawReady = true;

		const bodyRotation = Quaternion.RotationAxis(UP, rig.yaw + rig.facing);
		root.rotationQuaternion = bodyRotation;
		root.scaling.setAll(scale);
		const lean = new Vector3(rig.restHeadOffset.x, 0, rig.restHeadOffset.z).scale(scale).applyRotationQuaternion(bodyRotation);
		// Feet stay on the floor and the hips sink as the head does; a model with no legs to bend just drops whole.
		const standingEye = eye * scale;
		const drop = Math.min(Math.max(0, standingEye - (headPosition.y - floorY)), standingEye * 0.6);
		if (rig.hips) {
			root.position.set(headPosition.x - lean.x, floorY, headPosition.z - lean.z);
			rig.hips.position.y = rig.restHipsY - drop / scale;
		} else {
			root.position.set(headPosition.x - lean.x, headPosition.y - standingEye, headPosition.z - lean.z);
		}
		root.computeWorldMatrix(true);

		const facingMatrix = orientationOfQuat(Quaternion.RotationAxis(UP, rig.facing));

		// Head: copy the head's orientation onto the bone.
		this.orient(rig, rig.head, orientationOfQuat(headRotation), facingMatrix, null);
		// Your own head is never in view of your own eyes.
		if (isLocal !== rig.headHidden) {
			rig.head.scaling.setAll(isLocal ? 0.001 : 1);
			rig.headHidden = isLocal;
		}
		if (isLocal) this.localRig = rig;

		const bodyYaw = Quaternion.RotationAxis(UP, rig.yaw);
		for (const side of ['left', 'right'] as const) {
			const arm = rig.arms[side];
			if (!arm) continue;
			const sign = side === 'left' ? -1 : 1;
			arm.upper.computeWorldMatrix(true);
			const shoulder = arm.upper.getAbsolutePosition().clone();
			const handPose = pose[side];
			// Without a tracked hand the arm hangs relaxed at the side.
			const target = handPose
				? Vector3.FromArray(handPose.position)
				: shoulder.add(new Vector3(sign * 0.12, -0.55, 0.05).scale(scale).applyRotationQuaternion(bodyYaw));
			const pole = new Vector3(sign * 0.5, -1, -0.5).applyRotationQuaternion(bodyYaw);
			const [upperLength, lowerLength] = rig.lengths[side];
			const solution = solveTwoBone(shoulder.asArray() as V3, target.asArray() as V3, upperLength * scale, lowerLength * scale, pole.asArray() as V3);

			this.aim(rig, arm.upper, arm.lower, Vector3.FromArray(solution.mid));
			arm.lower.computeWorldMatrix(true);
			this.aim(rig, arm.lower, arm.hand, Vector3.FromArray(solution.end));
			if (handPose) {
				arm.hand.computeWorldMatrix(true);
				this.orient(rig, arm.hand, orientationOfQuat(toQuat(handPose.rotation)), facingMatrix, REST_TO_HAND[side]);
			}
		}
		for (const side of ['left', 'right'] as const) this.driveFingers(rig, side, pose[side], dt, this.graspBends(rig, side, ownerId, pose[side]));

		if (rig.hips) this.driveLegs(rig, bodyYaw, facingMatrix, dt);
	}

	/**
	 * The finger angles for a hand that holds an object with Auto grip (equipped, or grabbed): closed round the object's shape, and on a controller
	 * the trigger still pulls the index finger further. A tracked hand keeps its own fingers.
	 */
	private graspBends(rig: Rig, side: 'left' | 'right', ownerId: string, hand: HandPose | undefined): { bends: number[]; thumbSwing: number } | null {
		if (!hand || parseBends(hand.bend)) return null;
		const held = this.options.getHeldSlots?.(ownerId)?.[side];
		const slotId = held?.slotId;
		const entry = slotId ? this.sceneGraph.getLive(slotId) : undefined;
		// Equipped objects opt in with Auto grip; grabbed ones are wrapped unless their Grabbable says not to.
		const wanted = !entry ? false : held!.via === 'equip' ? findComponent(entry.slot, 'equippable')?.autoGrip === true : findComponent(entry.slot, 'grabbable')?.autoGrip !== false;
		if (!slotId || !entry || !wanted) {
			rig.grasps[side] = null;
			return null;
		}
		const handWorld = Matrix.Compose(Vector3.One(), Quaternion.FromArray(hand.rotation), Vector3.FromArray(hand.position));
		const obstacles = graspObstacles(this.sceneGraph, slotId, handWorld);
		const unit = rig.root.scaling.x || 1;
		const key = `${unit.toFixed(2)}|${obstacles.map((shape) => `${shape.kind}:${[...shape.center, ...shape.rotation, ...shape.half].map((v) => Math.round(v * 200)).join(',')}`).join(';')}`;
		let cached = rig.grasps[side];
		if (!cached || cached.key !== key) {
			const scaled = rig.handModels[side].map((f): FingerModel => ({
				...f,
				base: [f.base[0] * unit, f.base[1] * unit, f.base[2] * unit],
				lengths: [f.lengths[0] * unit, f.lengths[1] * unit, f.lengths[2] * unit],
				radius: f.radius * unit
			}));
			cached = { key, ...solveGraspFull(scaled, obstacles, holdingBends()) };
			rig.grasps[side] = cached;
		}
		const curl = parseCurls(hand.curl);
		if (!curl || curl[1] <= 0.55) return cached;
		const pulled = bendsFromCurls(curl).slice(3, 6);
		return { thumbSwing: cached.thumbSwing, bends: cached.bends.map((angle, i) => (i >= 3 && i < 6 ? Math.max(angle, pulled[i - 3]) : angle)) };
	}

	/** Curls each finger towards the palm by the amount its owner's hand is curled, easing between packets. */
	private driveFingers(rig: Rig, side: 'left' | 'right', hand: HandPose | undefined, dt: number, grasp: { bends: number[]; thumbSwing: number } | null): void {
		// A tracked hand sends the angle of every joint, which is shown as it is; a controller only knows how far each finger is curled.
		const curls = parseCurls(hand?.curl) ?? OPEN_HAND;
		const target = (parseBends(hand?.bend) ?? grasp?.bends ?? anglesFromCurls(curls)).map((angle, i) => Math.min(angle, MAX_BEND[i % 3][Math.floor(i / 3)]));
		rig.bends[side] = easeValues(rig.bends[side], target, dt);
		rig.thumbSwing[side] = easeValues([rig.thumbSwing[side]], [grasp?.thumbSwing ?? 0], dt)[0];
		const thumbDirections = parseThumbDirections(hand?.thumb);
		rig.fingers[side].forEach((chain, finger) => {
			if (finger === 0 && thumbDirections && hand) {
				this.aimThumb(rig.fingers[side][0], thumbDirections, hand.rotation as Q4, dt);
				return;
			}
			// A thumb closing on an object turns across the palm as well as bending: its curl plane is swung about its own direction.
			const swing = finger === 0 ? rig.thumbSwing[side] : 0;
			chain.bones.forEach((bone, joint) => {
				const axis = swing === 0 ? chain.axes[joint] : chain.axes[joint].clone().applyRotationQuaternion(Quaternion.RotationAxis(chain.restDirections[joint], swing));
				bone.rotationQuaternion = Quaternion.RotationAxis(axis, rig.bends[side][finger * 3 + Math.min(joint, 2)]).multiply(chain.rest[joint]);
			});
		});
	}

	/**
	 * A tracked thumb is pointed rather than bent: each of its bones is aimed along the direction the real segment points.
	 * The directions arrive in the hand's frame, so the hand's own rotation turns them back into the world.
	 */
	private aimThumb(chain: FingerChain, directions: V3[], handRotation: Q4, dt: number): void {
		const k = 1 - Math.exp(-dt * 18);
		chain.bones.forEach((bone, joint) => {
			const parent = bone.parent as TransformNode | null;
			const direction = directions[Math.min(joint, 2)];
			if (!parent || !direction) return;
			parent.computeWorldMatrix(true);
			const world = Vector3.FromArray(rotateBy(handRotation, direction));
			const wanted = Vector3.TransformNormal(world, parent.getWorldMatrix().clone().invert());
			if (wanted.lengthSquared() < 1e-10) return;
			const arc = Quaternion.FromArray(arcBetween(chain.restDirections[joint].asArray() as V3, wanted.asArray() as V3));
			const target = arc.multiply(chain.rest[joint]);
			bone.rotationQuaternion = Quaternion.Slerp(bone.rotationQuaternion ?? chain.rest[joint], target, k);
		});
	}

	/** Plants each foot on the floor and steps it when the body has walked away from it, bending the knees forward to reach from the lowered hips. */
	private driveLegs(rig: Rig, bodyYaw: Quaternion, facing: Matrix, dt: number): void {
		rig.root.computeWorldMatrix(true);
		const here = rig.root.position.asArray() as V3;
		rig.velocity = smoothVelocity(rig.velocity, rig.lastRoot ?? here, here, dt);
		rig.lastRoot = here;
		const rootWorld = rig.root.getWorldMatrix();
		const forward = new Vector3(0, 0.1, 1).applyRotationQuaternion(bodyYaw);
		for (const side of ['left', 'right'] as const) {
			const leg = rig.legs[side];
			const restFoot = rig.restFoot[side];
			if (!leg || !restFoot) continue;
			leg.upper.computeWorldMatrix(true);
			const hip = leg.upper.getAbsolutePosition().clone();
			const ideal = Vector3.TransformCoordinates(restFoot, rootWorld).asArray() as V3;
			const other = rig.feet[side === 'left' ? 'right' : 'left'];
			const foot = stepFoot(rig.feet[side] ?? newFoot(ideal), ideal, rig.velocity, other?.stepping ?? false, dt);
			rig.feet[side] = foot;
			const target = Vector3.FromArray(foot.position);
			const scale = rig.root.scaling.x;
			const [upperLength, lowerLength] = rig.legLengths[side];
			const solution = solveTwoBone(hip.asArray() as V3, target.asArray() as V3, upperLength * scale, lowerLength * scale, forward.asArray() as V3);
			this.aim(rig, leg.upper, leg.lower, Vector3.FromArray(solution.mid));
			leg.lower.computeWorldMatrix(true);
			this.aim(rig, leg.lower, leg.foot, Vector3.FromArray(solution.end));
			leg.foot.computeWorldMatrix(true);
			this.orient(rig, leg.foot, orientationOfQuat(bodyYaw), facing, null);
		}
	}

	/**
	 * Points `bone` so that its `child` sits along the line to `worldTarget`. Done in the parent's space
	 * from the bone's rest rotation, so the twist along the bone stays as authored.
	 */
	private aim(rig: Rig, bone: TransformNode, child: TransformNode, worldTarget: Vector3): void {
		const parent = bone.parent as TransformNode | null;
		if (!parent) return;
		parent.computeWorldMatrix(true);
		bone.computeWorldMatrix(true);
		const inverseParent = parent.getWorldMatrix().clone().invert();
		const desired = Vector3.TransformNormal(worldTarget.subtract(bone.getAbsolutePosition()), inverseParent);
		const rest = rig.restLocal.get(bone);
		if (!rest || desired.lengthSquared() < 1e-10) return;
		const offset = child.position.multiply(bone.scaling);
		const restDirection = offset.clone().applyRotationQuaternion(rest);
		const arc = Quaternion.FromArray(arcBetween(restDirection.asArray() as V3, desired.asArray() as V3));
		bone.rotationQuaternion = arc.multiply(rest);
	}

	/**
	 * Sets a bone's orientation so that, in the world, it is its rest orientation turned to face forward,
	 * optionally re-framed by `frame`, then rotated by `worldRotation`. Solved as a matrix in the parent's space.
	 */
	private orient(rig: Rig, bone: TransformNode, worldRotation: Matrix, facing: Matrix, frame: Matrix | null): void {
		const parent = bone.parent as TransformNode | null;
		const rest = rig.restRel.get(bone);
		if (!parent || !rest) return;
		parent.computeWorldMatrix(true);
		let desired = rest.multiply(facing);
		if (frame) desired = desired.multiply(frame);
		desired = desired.multiply(worldRotation);
		const local = desired.multiply(orientationOf(parent.getWorldMatrix()).invert());
		const quaternion = Quaternion.FromRotationMatrix(orientationOf(local));
		bone.rotationQuaternion = quaternion.normalize();
	}

	/** The local player's controllers are replaced by the avatar's hands while it is being posed. */
	private setControllersHidden(hidden: boolean): void {
		const xr = this.options.getXr();
		if (!xr) return;
		if (!hidden && !this.controllersHidden) return;
		for (const controller of xr.input.controllers) controller.motionController?.rootMesh?.setEnabled(!hidden);
		this.controllersHidden = hidden;
	}
}
