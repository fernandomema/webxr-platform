import { Ray, Vector3, WebXRState, type AbstractMesh, type Scene, type UniversalCamera, type WebXRDefaultExperience } from '@babylonjs/core';
import { findComponent, isGrabbable, type Slot } from '$lib/ecs/types';
import { isBuiltinMesh } from '$lib/assets/ref';
import type { SceneGraph } from '../sceneGraph';

const GRAVITY = 9.8; // m/s²
const TERMINAL_SPEED = 25; // m/s
const STEP_UP = 0.4; // tallest ledge walked onto
const BODY_RADIUS = 0.3;
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

/** Things you cannot walk through: a collider that is not a floor and not something you can pick up. */
export const isSolidSlot = (slot: Slot): boolean =>
	slot.components.some((c) => c.type === 'collider') && !isGrabbable(slot) && !isFloorSlot(slot) && Boolean(findComponent(slot, 'meshRenderer'));

export interface PlayerBody {
	/** Limits a horizontal step (XR smooth locomotion) so it slides along walls instead of passing through them. */
	constrainMove(delta: Vector3): Vector3;
	/**
	 * Seated mode: lifts the player so their head is at `SEATED_HEAD_HEIGHT` above the floor whatever their real posture, as if they stood.
	 * The lift is measured when the mode is turned on (or when the headset first reports a height), so leaning does not fight it.
	 */
	setSeated(seated: boolean): void;
	/** Gravity, standing on the floor, and putting the player back if they fall out of the world. Call every frame. */
	update(dt: number): void;
}

/**
 * Gives the player a body. On desktop this switches on Babylon's own camera
 * collisions and gravity (meshes opt in from SceneGraph). In VR the head
 * position drives the camera, so the same rules are applied by hand: a ray
 * down finds the floor, rays along the step find walls.
 */
export function setupPlayerBody(
	scene: Scene,
	sceneGraph: SceneGraph,
	xr: WebXRDefaultExperience | null,
	desktopCamera: UniversalCamera,
	spawn: { x: number; z: number }
): PlayerBody {
	scene.collisionsEnabled = true;
	scene.gravity = new Vector3(0, -0.18, 0);
	desktopCamera.checkCollisions = true;
	desktopCamera.applyGravity = true;
	desktopCamera.ellipsoid = new Vector3(BODY_RADIUS, 0.8, BODY_RADIUS); // eye height is twice the half-height
	const desktopStart = desktopCamera.position.clone();

	/** Parts of something you can pick up (a brush handle, a cue) travel with it and must never block the player. */
	function insideGrabbable(slot: Slot): boolean {
		let parentId = slot.parentId;
		while (parentId) {
			const parent = sceneGraph.getLive(parentId)?.slot;
			if (!parent) return false;
			if (isGrabbable(parent)) return true;
			parentId = parent.parentId;
		}
		return false;
	}

	const hasDisposed = (meshes: Set<AbstractMesh>) => {
		for (const mesh of meshes) if (mesh.isDisposed()) return true;
		return false;
	};
	let floors = new Set<AbstractMesh>();
	let solids = new Set<AbstractMesh>();
	let refreshedAt = -Infinity;
	function refreshSets(): void {
		const now = performance.now();
		// A world was swapped (or a floor rebuilt): the new floor must count at once, or the player falls through it before
		// the next refresh and, by then more than a step below it, never finds it again.
		if (now - refreshedAt < CACHE_MS && !hasDisposed(floors) && !hasDisposed(solids)) return;
		refreshedAt = now;
		floors = new Set();
		solids = new Set();
		for (const entry of sceneGraph.allSlots()) {
			if (entry.system) continue;
			const mesh = entry.node as AbstractMesh;
			if (typeof mesh.getBoundingInfo !== 'function') continue;
			const modelCollider = entry.slot.components.some((component) => component.type === 'collider' && component.shape === 'mesh');
			const collisionMeshes = modelCollider ? entry.model?.instance?.root.getChildMeshes(false) ?? [] : [mesh];
			for (const candidate of collisionMeshes) {
				if (isFloorSlot(entry.slot)) floors.add(candidate);
				else if (isSolidSlot(entry.slot) && !insideGrabbable(entry.slot)) solids.add(candidate);
				// Desktop camera collisions use the same rule: floors and solids block, the rest is walked through.
				candidate.checkCollisions = floors.has(candidate) || solids.has(candidate);
			}
		}
	}

	refreshSets();
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
	let verticalSpeed = 0;

	function floorHeightBelow(x: number, y: number, z: number): number | null {
		const hit = scene.pickWithRay(new Ray(new Vector3(x, y, z), Vector3.Down(), 200), (mesh) => floors.has(mesh));
		return hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : null;
	}

	function updateXr(dt: number): void {
		const camera = xr!.baseExperience.camera;
		calibrateSeated();
		const feet = feetY();
		const ground = floorHeightBelow(camera.position.x, feet + STEP_UP, camera.position.z);
		if (ground !== null && feet <= ground + 0.02) {
			// On the floor (or a ledge low enough to step onto).
			verticalSpeed = 0;
			if (Math.abs(ground - feet) > 0.001) camera.position.y += ground - feet;
		} else {
			verticalSpeed = Math.max(verticalSpeed - GRAVITY * dt, -TERMINAL_SPEED);
			let dy = verticalSpeed * dt;
			if (ground !== null && feet + dy < ground) {
				dy = ground - feet;
				verticalSpeed = 0;
			}
			camera.position.y += dy;
		}
		if (feetY() < VOID_Y) {
			verticalSpeed = 0;
			camera.position.x = spawn.x;
			camera.position.z = spawn.z;
			camera.position.y = camera.realWorldHeight + (lift ?? 0);
		}
	}

	function updateDesktop(): void {
		if (desktopCamera.position.y < VOID_Y) desktopCamera.position.copyFrom(desktopStart);
	}

	return {
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
			if (solids.size === 0) return delta;
			const camera = xr!.baseExperience.camera;
			const feet = feetY();
			const length = delta.length();
			const direction = delta.scale(1 / length);
			let result = delta;
			// Knee and chest height, so low ledges and tall obstacles both stop the player.
			for (const height of [0.45, 1.2]) {
				const origin = new Vector3(camera.position.x, feet + height, camera.position.z);
				const hit = scene.pickWithRay(new Ray(origin, direction, BODY_RADIUS + length), (mesh) => solids.has(mesh));
				if (!hit?.hit || !hit.distance) continue;
				const normal = hit.getNormal(true);
				if (!normal) continue;
				normal.y = 0;
				if (normal.lengthSquared() < 1e-6) continue;
				normal.normalize();
				// Remove the part of the step that goes into the wall; keep the part along it.
				const into = Vector3.Dot(result, normal);
				if (into < 0) result = result.subtract(normal.scale(into));
			}
			return result;
		},
		update(dt) {
			refreshSets();
			if (inXr()) updateXr(dt);
			else {
				// A new headset session starts from a fresh origin, so the lift has to be measured again.
				if (seated) lift = null;
				updateDesktop();
			}
		}
	};
}
