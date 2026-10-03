import { Matrix, Quaternion, Vector3, WebXRState, type Skeleton, type Scene, type TransformNode, type WebXRDefaultExperience, type Camera } from '@babylonjs/core';
import { findComponent, type AvatarComponent, type Vec3 } from '$lib/ecs/types';
import type { SceneGraph } from '../sceneGraph';
import type { HandPose, TransformPose } from './defaultAvatar';
import { readHandPoses } from './localHands';
import { defaultHandModel, fingerJoints as fingerPoints, withSwing, type FingerModel, type HandModel } from './grasp';
import { graspObstacles } from './graspShapes';
import { GraspSolver } from './graspSolver';
import type { GraspPose } from './graspPose';
import { FINGER_NAMES, OPEN_HAND, bendsFromCurls, conjugate, easeValues, handFrameFromKnuckles, parseBends, parseCurls, parseThumbDirections, rotateVector as rotateBy } from './fingers';
import { detectHumanoidMap, fingerJoints, missingRequiredBones, pruneHumanoidMap, type HumanoidBone } from './humanoid';
import { mirrorRenderHooks } from '../mirrorHooks';
import { newFoot, smoothVelocity, stepFoot, type Foot } from './gait';
import { arcBetween, followYaw, headYaw, restFacingYaw, solveTwoBone, stepToReach, updateStandingHeight, type Q4, type V3 } from './ik';

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

/**
 * A grasp worked out for a hand: the finger angles, how far the thumb turned across the palm to press on the object, and
 * how far the hand was moved (in its own frame) to rest its palm on the object. `model` is the hand it was solved for.
 */
type Grasp = GraspPose;

/** How far a hand may be moved to rest on what it grabbed, in metres at the avatar's own size. */
const PALM_REACH = 0.1;

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
	/** The hips' local position at rest. */
	restHipsPosition: Vector3;
	skeletons: Skeleton[];
	fingers: Record<'left' | 'right', FingerChain[]>;
	/** The knuckles each hand's frame is read from once the hand is posed, so fingers are placed in the frame they were measured in. */
	knuckles: Record<'left' | 'right', { index: TransformNode; middle: TransformNode; little: TransformNode } | null>;
	/** Where each foot is planted or swinging, so walking looks like steps instead of a body sliding over fixed feet. */
	feet: { left?: Foot; right?: Foot };
	/** Each hand's fingers as measured on this model (lengths in the root's own units), for closing them round an object. */
	handModels: { left: HandModel; right: HandModel };
	/** How far each hand is moved onto what it grabbed (in the hand's frame), eased. */
	shift: { left: V3; right: V3 };
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

/**
 * How far the local player's own body is moved back from under their eyes, in metres at the avatar's size: a little when
 * standing, more as they crouch (`crouch`, the share of standing eye height lost) and as they look down (`lookY`, the
 * vertical part of where the head points, negative looking down).
 */
export function localBodyBehind(crouch: number, lookY: number): number {
	return 0.08 + 0.3 * Math.min(0.6, Math.max(0, crouch)) + 0.25 * Math.max(0, -lookY);
}

/** The share of the local body's setback that reaching for a hand may take back. */
const MAX_REACH_PULL = 0.5;

export class AvatarSystem {
	private poses = new Map<string, AvatarPose>();
	private rigs = new Map<string, Rig>();
	private driven = new Set<string>();
	private controllersHidden = false;
	private graspSolver = new GraspSolver();
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

	/**
	 * Where the tip of the local player's index finger is, in the world, as their avatar shows it this frame: the end of
	 * the finger's last bone, along the way that bone points. Null without an avatar (or one without that finger). What
	 * the player touches things with, so it has to be where they see their fingertip.
	 */
	localIndexTip(side: 'left' | 'right'): Vector3 | null {
		const rig = this.localRig;
		const chain = rig?.fingers[side][1];
		if (!rig || !chain || chain.bones.length < 3) return null;
		const distal = chain.bones[2];
		const parent = distal.parent as TransformNode | null;
		if (!parent) return null;
		for (const bone of chain.bones) bone.computeWorldMatrix(true);
		// The bone's segment at rest, in its own space, turned as the bone is turned now, then into the world.
		const inBone = chain.restDirections[2].applyRotationQuaternion(Quaternion.Inverse(chain.rest[2]));
		const now = inBone.applyRotationQuaternion(distal.rotationQuaternion ?? Quaternion.FromEulerVector(distal.rotation));
		const direction = Vector3.TransformNormal(now, parent.getWorldMatrix());
		if (direction.lengthSquared() < 1e-12) return null;
		const length = rig.handModels[side][1].lengths[2] * (rig.root.scaling.x || 1);
		return distal.getAbsolutePosition().add(direction.normalize().scale(length));
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
		this.graspSolver.dispose();
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
		for (const entry of this.sceneGraph.slotsWith('avatar')) {
			const avatar = findComponent(entry.slot, 'avatar');
			const ownerId = avatar?.ownerId;
			if (!avatar || !ownerId) continue;
			const instance = entry.model?.instance;
			if (!instance) continue;
			const pose = ownerId === localId ? this.readLocalPose() : this.poses.get(ownerId);
			if (!pose) continue;
			let rig = this.rigs.get(entry.slot.id);
			if (!rig || rig.root !== entry.node) {
				this.graspSolver.clear(`${entry.slot.id}:left`);
				this.graspSolver.clear(`${entry.slot.id}:right`);
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
			if (!this.sceneGraph.getLive(slotId) || this.sceneGraph.getLive(slotId)?.node !== rig.root) {
				this.rigs.delete(slotId);
				this.graspSolver.clear(`${slotId}:left`);
				this.graspSolver.clear(`${slotId}:right`);
			}
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
			// A thumb flexes across the palm towards the little finger, the plane the grasp solver closes it in.
			let thumbCurl = palm.add(along.scale(0.7)).normalize();
			if (middle && indexBone && little) {
				const frame = handFrameFromKnuckles(position(wrist).asArray() as V3, position(middle).asArray() as V3, position(indexBone).asArray() as V3, position(little).asArray() as V3, side);
				if (frame) {
					palm = Vector3.FromArray(rotateBy(frame, [0, -1, 0]));
					along = Vector3.FromArray(rotateBy(frame, [0, 0, 1]));
					thumbCurl = Vector3.FromArray(rotateBy(frame, defaultHandModel(side)[0].palm));
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
				const target = finger === 'Thumb' ? thumbCurl : palm;
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
		const knuckles = (side: 'left' | 'right') => {
			const [index, middle, little] = (['Index', 'Middle', 'Little'] as const).map((finger) => node(fingerJoints(side, finger)[0]));
			return index && middle && little ? { index, middle, little } : null;
		};
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
			restHipsPosition: hips ? hips.position.clone() : Vector3.Zero(),
			skeletons: [...skeletons],
			fingers,
			knuckles: { left: knuckles('left'), right: knuckles('right') },
			feet: {},
			handModels: { left: measureHandModel('left'), right: measureHandModel('right') },
			shift: { left: [0, 0, 0], right: [0, 0, 0] },
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
		// Your own body sits a little behind your eyes, and further back as you crouch or look down, so it does not fill the view below you.
		const behind = isLocal ? localBodyBehind(drop / standingEye, rotateBy(pose.head.rotation as Q4, [0, 0, 1])[1]) * scale : 0;
		const forward = new Vector3(0, 0, 1).applyRotationQuaternion(Quaternion.RotationAxis(UP, rig.yaw));
		const back = forward.scale(-behind);
		const x = headPosition.x - lean.x + back.x, z = headPosition.z - lean.z + back.z;
		if (rig.hips) {
			root.position.set(x, floorY, z);
			root.computeWorldMatrix(true);
			// The hips sink straight down in the world. Their own up is not necessarily the world's (rigs exported from
			// Blender are rotated a quarter turn, which would slide the body forward instead), so the drop is taken into
			// their parent's space.
			const parent = rig.hips.parent as TransformNode | null;
			const down = new Vector3(0, -drop, 0);
			if (parent) {
				const inverse = parent.computeWorldMatrix(true).clone().invert();
				Vector3.TransformNormalToRef(down, inverse, down);
			}
			rig.hips.position.copyFrom(rig.restHipsPosition).addInPlace(down);
		} else {
			root.position.set(x, headPosition.y - standingEye, z);
		}
		root.computeWorldMatrix(true);
		// ...but not so far back that an arm cannot reach its hand: the body comes forward for that, though never more than
		// part of the way, so crouching with the hands out in front does not drag the chest back under the eyes (a hand then
		// falls a little short of its controller instead).
		if (behind > 0) {
			let step = 0;
			for (const side of ['left', 'right'] as const) {
				const arm = rig.arms[side];
				const hand = pose[side];
				if (!arm || !hand) continue;
				arm.upper.computeWorldMatrix(true);
				const toTarget = Vector3.FromArray(hand.position).subtract(arm.upper.getAbsolutePosition());
				const reach = (rig.lengths[side][0] + rig.lengths[side][1]) * scale * 0.98;
				step = Math.max(step, stepToReach(toTarget.asArray() as V3, forward.asArray() as V3, reach));
			}
			if (step > 0) {
				root.position.addInPlace(forward.scale(Math.min(step, behind * MAX_REACH_PULL)));
				root.computeWorldMatrix(true);
			}
		}

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
			const hand = pose[side];
			this.reachArm(rig, side, hand, null, scale, bodyYaw, facingMatrix);
			// The grasp is solved, and the fingers placed, in the frame of the hand as it is now posed.
			const frame = hand ? this.handFrame(rig, side, hand) : null;
			const grasp = hand && frame ? this.graspFor(rig, side, ownerId, hand, frame) : null;
			// A hand moved onto what it grabbed eases there instead of jumping.
			rig.shift[side] = easeValues(rig.shift[side], grasp?.shift ?? [0, 0, 0], dt, 12) as V3;
			if (hand && frame && Math.hypot(...rig.shift[side]) > 1e-4) this.reachArm(rig, side, hand, Vector3.FromArray(rotateBy(frame, rig.shift[side])), scale, bodyYaw, facingMatrix);
			this.driveFingers(rig, side, hand, dt, grasp, frame);
		}

		if (rig.hips) this.driveLegs(rig, bodyYaw, facingMatrix, dt);
	}

	/**
	 * Reaches the arm for the hand with two-bone IK and turns the hand the way it is held; without a tracked hand the arm
	 * hangs relaxed at the side. `offset` moves the hand off where it is tracked (onto something it grabbed).
	 */
	private reachArm(rig: Rig, side: 'left' | 'right', handPose: HandPose | undefined, offset: Vector3 | null, scale: number, bodyYaw: Quaternion, facing: Matrix): void {
		const arm = rig.arms[side];
		if (!arm) return;
		const sign = side === 'left' ? -1 : 1;
		arm.upper.computeWorldMatrix(true);
		const shoulder = arm.upper.getAbsolutePosition().clone();
		const target = handPose
			? Vector3.FromArray(handPose.position).addInPlace(offset ?? Vector3.Zero())
			: shoulder.add(new Vector3(sign * 0.12, -0.55, 0.05).scale(scale).applyRotationQuaternion(bodyYaw));
		const pole = new Vector3(sign * 0.5, -1, -0.5).applyRotationQuaternion(bodyYaw);
		const [upperLength, lowerLength] = rig.lengths[side];
		const solution = solveTwoBone(shoulder.asArray() as V3, target.asArray() as V3, upperLength * scale, lowerLength * scale, pole.asArray() as V3);

		this.aim(rig, arm.upper, arm.lower, Vector3.FromArray(solution.mid));
		arm.lower.computeWorldMatrix(true);
		this.aim(rig, arm.lower, arm.hand, Vector3.FromArray(solution.end));
		if (handPose) {
			arm.hand.computeWorldMatrix(true);
			this.orient(rig, arm.hand, orientationOfQuat(toQuat(handPose.rotation)), facing, REST_TO_HAND[side]);
		}
	}

	/**
	 * The posed hand's frame (fingers along +Z, back of the hand along +Y), read off its knuckles: the frame its fingers were
	 * measured in, which a model's rest hand may have a little tilted from the tracked rotation. That rotation is the fallback.
	 */
	private handFrame(rig: Rig, side: 'left' | 'right', hand: HandPose): Q4 {
		const wrist = rig.arms[side]?.hand;
		const knuckles = rig.knuckles[side];
		if (!wrist || !knuckles) return hand.rotation as Q4;
		wrist.computeWorldMatrix(true);
		const at = (bone: TransformNode): V3 => {
			const chain: TransformNode[] = [];
			for (let b: TransformNode | null = bone; b && b !== wrist; b = b.parent as TransformNode | null) chain.unshift(b);
			for (const b of chain) b.computeWorldMatrix(true);
			return bone.getAbsolutePosition().asArray() as V3;
		};
		return handFrameFromKnuckles(at(wrist), at(knuckles.middle), at(knuckles.index), at(knuckles.little), side) ?? (hand.rotation as Q4);
	}

	/**
	 * The grasp for a hand that holds an object with Auto grip (equipped, or grabbed): closed round the object's shape. The
	 * trigger does not pull the index any further, since the index already rests on the object and would sink into it.
	 * A tracked hand keeps its own fingers. A grabbed object
	 * stays where it was caught, so the hand is moved to rest on it; an equipped one sits where its author placed it.
	 */
	private graspFor(rig: Rig, side: 'left' | 'right', ownerId: string, hand: HandPose, frame: Q4): Grasp | null {
		const handId = `${rig.slotId}:${side}`;
		if (parseBends(hand.bend)) {
			this.graspSolver.clear(handId);
			return null;
		}
		const held = this.options.getHeldSlots?.(ownerId)?.[side];
		const slotId = held?.slotId;
		const entry = slotId ? this.sceneGraph.getLive(slotId) : undefined;
		// Equipped objects opt in with Auto grip; grabbed ones are wrapped unless their Grabbable says not to.
		const wanted = !entry ? false : held!.via === 'equip' ? findComponent(entry.slot, 'equippable')?.autoGrip === true : findComponent(entry.slot, 'grabbable')?.autoGrip !== false;
		if (!slotId || !entry || !wanted) {
			this.graspSolver.clear(handId);
			return null;
		}
		const handWorld = Matrix.Compose(Vector3.One(), Quaternion.FromArray(frame), Vector3.FromArray(hand.position));
		const obstacles = graspObstacles(this.sceneGraph, slotId, handWorld);
		const unit = rig.root.scaling.x || 1;
		const key = `${held!.via}|${unit.toFixed(2)}|${obstacles.map((shape) => `${shape.kind}:${[...shape.center, ...shape.rotation, ...shape.half].map((v) => Math.round(v * 200)).join(',')}`).join(';')}`;
		return this.graspSolver.sample(handId, `${slotId}|${held!.via}`, key, () => {
			const model = rig.handModels[side].map((f): FingerModel => ({
				...f,
				base: [f.base[0] * unit, f.base[1] * unit, f.base[2] * unit],
				lengths: [f.lengths[0] * unit, f.lengths[1] * unit, f.lengths[2] * unit],
				radius: f.radius * unit
			}));
			return { model, obstacles, reach: held!.via === 'grab' ? PALM_REACH * unit : null };
		});
	}

	/**
	 * Poses the fingers, easing towards the latest pose so 20 Hz packets look smooth. A tracked hand sends the angle of every
	 * joint; a controller only how far each finger is curled; a hand holding something with Auto grip takes the grasp
	 * solver's pose, each bone aimed along the segment the solver placed, so what is drawn is exactly what was checked
	 * against the object (the thumb included, however far it turned across the palm).
	 */
	private driveFingers(rig: Rig, side: 'left' | 'right', hand: HandPose | undefined, dt: number, grasp: Grasp | null, frame: Q4 | null): void {
		const k = 1 - Math.exp(-dt * 18);
		const curls = parseCurls(hand?.curl) ?? OPEN_HAND;
		const bends = (parseBends(hand?.bend) ?? anglesFromCurls(curls)).map((angle, i) => Math.min(angle, MAX_BEND[i % 3][Math.floor(i / 3)]));
		const thumbDirections = parseThumbDirections(hand?.thumb);
		rig.fingers[side].forEach((chain, finger) => {
			if (finger === 0 && thumbDirections && hand) {
				this.aimChain(chain, thumbDirections.map((d) => rotateBy(hand.rotation as Q4, d)), k);
				return;
			}
			if (grasp && frame) {
				const model = finger === 0 ? withSwing(grasp.model[0], grasp.thumbSwing) : grasp.model[finger];
				const p = fingerPoints(model, grasp.bends.slice(finger * 3, finger * 3 + 3));
				this.aimChain(chain, [0, 1, 2].map((j) => rotateBy(frame, [p[j + 1][0] - p[j][0], p[j + 1][1] - p[j][1], p[j + 1][2] - p[j][2]])), k);
				return;
			}
			chain.bones.forEach((bone, joint) => {
				const target = Quaternion.RotationAxis(chain.axes[joint], bends[finger * 3 + Math.min(joint, 2)]).multiply(chain.rest[joint]);
				bone.rotationQuaternion = Quaternion.Slerp(bone.rotationQuaternion ?? chain.rest[joint], target, k);
			});
		});
	}

	/** Points each bone of a finger along a direction in the world (base to tip), easing by `k`. */
	private aimChain(chain: FingerChain, directions: V3[], k: number): void {
		chain.bones.forEach((bone, joint) => {
			const parent = bone.parent as TransformNode | null;
			const direction = directions[Math.min(joint, 2)];
			if (!parent || !direction) return;
			parent.computeWorldMatrix(true);
			const wanted = Vector3.TransformNormal(Vector3.FromArray(direction), parent.getWorldMatrix().clone().invert());
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
