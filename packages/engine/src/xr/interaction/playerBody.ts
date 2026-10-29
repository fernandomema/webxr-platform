import { Quaternion, Vector3, WebXRState, type Scene, type UniversalCamera, type WebXRDefaultExperience } from '@babylonjs/core';
import { findComponent, type CharacterControllerComponent, type PlayerMovementComponent, type Slot } from '../../ecs/types.ts';
import { isBuiltinMesh } from '../../assets/ref.ts';
import type { SceneGraph } from '../sceneGraph.ts';
import type { TeleportTarget } from '../playerPoses.ts';
import { SceneColliders } from '../sceneColliders.ts';
import { CharacterRig, characterConfigOf } from './characterRig.ts';

const DESKTOP_EYE_HEIGHT = 1.6;
const VOID_Y = -20; // below this the player is put back at the spawn point
const CACHE_MS = 500;
/** Head height that seated mode pretends the player has. */
export const SEATED_HEAD_HEIGHT = 1.7;

/** How far to raise a head that is really `realHeadHeight` above the floor so it sits at standing height. Never lowers. */
export function seatedLift(realHeadHeight: number): number {
	return Math.max(0, SEATED_HEAD_HEIGHT - realHeadHeight);
}

/** Round or flat surfaces you stand on (and can teleport to). */
export const isFloorSlot = (slot: Slot): boolean =>
	slot.components.some((c) => c.type === 'meshRenderer' && (isBuiltinMesh(c.meshRef, 'ground') || isBuiltinMesh(c.meshRef, 'disc')));

export interface PlayerBody {
	/** Limits a horizontal step (XR smooth locomotion) so it slides along walls instead of passing through them. */
	constrainMove(delta: Vector3): Vector3;
	/**
	 * Seated mode: lifts the player so their head is at `SEATED_HEAD_HEIGHT` above the floor whatever their real posture, as if they stood.
	 * The lift is measured when the mode is turned on (or when the headset first reports a height), so leaning does not fight it.
	 */
	setSeated(seated: boolean): void;
	/**
	 * A jump, if standing on something. In a headset only where the world turns it on (`vrJump`). In the air it jumps again where the world
	 * allows it (`airJumps`, `wallJump`).
	 */
	jump(): void;
	/** How fast this world lets the player walk and run, in m/s; undefined where it does not say (the engine's own speeds apply). */
	speeds(): { walk?: number; run?: number };
	/** Pushes the body (m/s added to its speed; the horizontal part fades). */
	addImpulse(velocity: [number, number, number]): void;
	/** Sets the body's speed outright (what a push cancelled, a launch). Same limits as `addImpulse`. */
	setVelocity(velocity: [number, number, number]): void;
	/** The height of the first floor or solid below a point (for a body's feet, for an avatar's), or null when there is none. */
	floorAt(x: number, y: number, z: number): number | null;
	/** The solids of the scene as a collision world, kept up to date (for `ctx.physics`). */
	readonly colliders: SceneColliders;
	/** Puts the player back at the world's start point (its `spawnPoint` slot, else the default), facing the way it points, with nothing left of a fall. For entering a world. */
	respawn(): void;
	/** Puts the feet at `target.position` and turns to `target.yaw` when given, with nothing left of a fall. For a script that moves the player (see `ctx.world.teleportPlayer`). */
	teleport(target: TeleportTarget): void;
	/** Gravity, standing on the floor, and putting the player back if they fall out of the world. Call every frame. */
	update(dt: number): void;
}

/**
 * Gives the player a body: a `CharacterRig` that stands on, walks over and bumps into the scene's colliders, on a desktop and in a
 * headset alike. The world's `characterController` (or the older `playerMovement`) says how it moves; without either it is a person walking.
 */
export function setupPlayerBody(
	scene: Scene,
	sceneGraph: SceneGraph,
	xr: WebXRDefaultExperience | null,
	desktopCamera: UniversalCamera,
	spawn: { x: number; z: number },
	colliders: SceneColliders = new SceneColliders(sceneGraph)
): PlayerBody {
	scene.collisionsEnabled = true;
	scene.gravity = new Vector3(0, -0.18, 0);
	// The body collides with the scene by itself: the camera's own collisions and gravity would fight it.
	desktopCamera.checkCollisions = false;
	desktopCamera.applyGravity = false;
	const desktopStart = desktopCamera.position.clone();

	/** The world's `spawnPoint` slot, as a floor position and the direction (yaw, radians) it faces; `null` when the world has none. */
	function worldSpawn(): { x: number; y: number; z: number; yaw: number } | null {
		for (const entry of sceneGraph.allSlots()) {
			if (entry.system || !entry.slot.components.some((component) => component.type === 'spawnPoint')) continue;
			entry.node.computeWorldMatrix(true);
			const position = entry.node.absolutePosition;
			const forward = entry.node.getDirection(Vector3.Forward());
			return { x: position.x, y: position.y, z: position.z, yaw: Math.atan2(forward.x, forward.z) };
		}
		return null;
	}

	// How this world lets the body move: its `characterController`, or the older `playerMovement`, or a person walking.
	let vrJump = false;
	let rig: CharacterRig | null = null;
	let walkSpeed: number | undefined;
	let runSpeed: number | undefined;
	let refreshedAt = -Infinity;
	function refreshSets(): void {
		const now = performance.now();
		if (now - refreshedAt < CACHE_MS) return;
		refreshedAt = now;
		let movement: PlayerMovementComponent | undefined;
		let controller: CharacterControllerComponent | undefined;
		for (const entry of sceneGraph.allSlots()) {
			// What a fragment built is scenery that counts: a floor or a wall like any other (only the engine's own panels do not).
			if (entry.system && !entry.fragment) continue;
			movement ??= findComponent(entry.slot, 'playerMovement');
			controller ??= findComponent(entry.slot, 'characterController');
		}
		const finite = (value: number | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
		// A world with a character controller is moved by it; `playerMovement` still says the speeds and the jump where there is no controller.
		const speedsFrom = controller ?? movement;
		walkSpeed = finite(speedsFrom?.walkSpeed);
		runSpeed = finite(speedsFrom?.runSpeed);
		vrJump = (controller ?? movement)?.vrJump === true;
		const config = characterConfigOf(controller ?? (movement && { type: 'characterController', jumpSpeed: movement.jumpSpeed, gravity: movement.gravity, terminalSpeed: movement.terminalSpeed, wallJump: movement.wallJump }));
		if (rig) rig.configure(config);
		else {
			rig = new CharacterRig({ inXr: () => inXr(), camera: () => (inXr() ? xr!.baseExperience.camera : desktopCamera), feetBelowCamera: () => (inXr() ? xr!.baseExperience.camera.realWorldHeight + (lift ?? 0) : DESKTOP_EYE_HEIGHT) }, colliders, config);
		}
	}

	refreshSets();
	// A wall or a door that appears, goes or is switched off must count at once, not up to half a second later.
	sceneGraph.onChanged((ids) => {
		if (ids === null || ids.some((id) => sceneGraph.getSubtree(id).some((entry) => entry.slot.components.some((component) => component.type === 'collider')))) refreshedAt = -Infinity;
	});
	const inXr = () => Boolean(xr && xr.baseExperience.state === WebXRState.IN_XR);
	// How far the whole rig is raised for seated mode. `null` while turned on but not measured yet (no head height reported).
	let seated = false;
	let lift: number | null = 0;
	/** The floor the body stands on, ignoring the seated lift, so gravity and steps behave the same as when standing. */
	const feetY = () => {
		const camera = xr!.baseExperience.camera;
		return camera.position.y - camera.realWorldHeight - (lift ?? 0);
	};
	/** Measures the lift once a real head height is known, and raises the rig by it. */
	function calibrateSeated(): void {
		if (!seated || lift !== null) return;
		const camera = xr!.baseExperience.camera;
		if (!(camera.realWorldHeight > 0.3)) return;
		lift = seatedLift(camera.realWorldHeight);
		camera.position.y += lift;
	}
	function respawn(): void {
		rig?.reset();
		const point = worldSpawn();
		if (inXr()) {
			const camera = xr!.baseExperience.camera;
			camera.position.x = point?.x ?? spawn.x;
			camera.position.z = point?.z ?? spawn.z;
			// Down to the floor from where the head would be; the next frame settles it onto whatever floor is there.
			camera.position.y = (point?.y ?? 0) + camera.realWorldHeight + (lift ?? 0);
			if (point) {
				// Turned the way the point faces, from wherever the head looks now (as a snap turn does).
				const forward = camera.getForwardRay().direction;
				const sign = scene.useRightHandedSystem ? -1 : 1;
				Quaternion.FromEulerAngles(0, (point.yaw - Math.atan2(forward.x, forward.z)) * sign, 0).multiplyToRef(camera.rotationQuaternion, camera.rotationQuaternion);
			}
			return;
		}
		if (point) desktopCamera.position.set(point.x, point.y + DESKTOP_EYE_HEIGHT, point.z);
		else desktopCamera.position.copyFrom(desktopStart);
		desktopCamera.rotation.set(0, point?.yaw ?? 0, 0);
	}

	function teleport({ position, yaw }: TeleportTarget): void {
		rig?.reset();
		refreshedAt = -Infinity; // the place arrived at may have just been switched on
		if (inXr()) {
			const camera = xr!.baseExperience.camera;
			camera.position.x = position[0];
			camera.position.z = position[2];
			camera.position.y = position[1] + camera.realWorldHeight + (lift ?? 0);
			if (yaw !== undefined) {
				const forward = camera.getForwardRay().direction;
				const sign = scene.useRightHandedSystem ? -1 : 1;
				Quaternion.FromEulerAngles(0, (yaw - Math.atan2(forward.x, forward.z)) * sign, 0).multiplyToRef(camera.rotationQuaternion, camera.rotationQuaternion);
			}
			return;
		}
		desktopCamera.position.set(position[0], position[1] + DESKTOP_EYE_HEIGHT, position[2]);
		if (yaw !== undefined) desktopCamera.rotation.y = yaw;
	}

	return {
		respawn,
		teleport,
		speeds() {
			refreshSets();
			return { walk: walkSpeed, run: runSpeed };
		},
		addImpulse(velocity) {
			refreshSets();
			rig?.addImpulse(velocity);
		},
		setVelocity(velocity) {
			refreshSets();
			rig?.setVelocity(velocity);
		},
		floorAt(x, y, z) {
			refreshSets();
			return rig ? rig.floorBelow(x, y, z) : null;
		},
		colliders,
		jump() {
			const headset = inXr();
			if (headset && !vrJump) return;
			refreshSets();
			rig?.jump();
		},
		setSeated(enabled) {
			if (enabled === seated) return;
			seated = enabled;
			if (!xr || !inXr()) {
				lift = enabled ? null : 0; // measured later, when a headset is on
				return;
			}
			if (enabled) {
				lift = null;
				calibrateSeated();
			} else {
				xr.baseExperience.camera.position.y -= lift ?? 0;
				lift = 0;
			}
		},
		constrainMove(delta) {
			if (!inXr() || delta.lengthSquared() === 0) return delta;
			refreshSets();
			// The body takes the step and the camera follows it in `update`.
			rig?.push(delta);
			return new Vector3(0, 0, 0);
		},
		update(dt) {
			refreshSets();
			if (!rig) return;
			// Seated mode is measured once a headset reports its height; a new session starts from a fresh origin, so it is measured again.
			if (inXr()) calibrateSeated();
			else if (seated) lift = null;
			// A fall out of the world: back to the start.
			if (rig.body.position[1] < VOID_Y) respawn();
			rig.update(dt);
		}
	};
}
