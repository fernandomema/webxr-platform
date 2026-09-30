import {
	Vector3,
	Ray,
	MeshBuilder,
	StandardMaterial,
	Color3,
	WebXRControllerComponent,
	type Scene,
	type WebXRDefaultExperience,
	type WebXRInputSource,
	type Mesh
} from '@babylonjs/core';
import type { SceneGraph } from '../sceneGraph';
import type { GrabSystem } from './grabSystem';
import type { EquipmentSystem } from './equipmentSystem';
import type { EquipHand } from './equipmentRegistry';
import { claimStickY, isHandLocked, releaseStickY } from './handLock';
import { PUSH_RANGE, STICK_DEADZONE, pushedDistance } from './pushPull';
import { isEquippable } from '$lib/ecs/types';

const HAND_GRAB_RADIUS = 0.15;
const LASER_MAX_LENGTH = 5;

/**
 * Takes a controller out of (or back into) Babylon's teleportation while its stick pushes a held object: in teleport
 * mode, pushing the stick forward would otherwise also aim a teleport. Same private attach/detach as the pointer's.
 */
function setControllerTeleportEnabled(xr: WebXRDefaultExperience, controller: WebXRInputSource, enabled: boolean): void {
	const feature = xr.teleportation as unknown as { attached?: boolean; _attachController?: (controller: WebXRInputSource) => void; _detachController?: (uniqueId: string) => void } | undefined;
	if (!feature?.attached) return;
	try {
		if (enabled) feature._attachController?.(controller);
		else feature._detachController?.(controller.uniqueId);
	} catch (err) {
		console.warn('[pointerController] could not toggle teleportation for a controller', err);
	}
}

export interface PointerControllerNetworkHooks {
	onGrab?(grabberId: string, slotId: string): void;
	onRelease?(grabberId: string, slotId?: string): void;
	onWorldPortal?(slotId: string): void;
	/** The trigger of a hand holding an equipped object with `onTrigger` actions. Solo/host run it locally; a guest asks the host. */
	onUse?(slotId: string, hand: EquipHand, phase: 'press' | 'release' | 'value', value: number): void;
	/** A controller went away while holding an equipped object. */
	onUnequip?(hand: EquipHand, slotId: string): void;
	/** An object pulled all the way in along the laser equipped itself in the hand. */
	onEquip?(hand: EquipHand, slotId: string): void;
}

export interface PointerControllerState {
	/** Current visible laser hit for a hand, including objects that cannot be grabbed. */
	getLaserTarget(hand: EquipHand): string | null;
}

const TRIGGER_VALUE_INTERVAL_MS = 50;

/** Stable per-hand id ('left' | 'right'), used both locally and sent to the host when networked. */
function grabberIdFor(controller: WebXRInputSource): string {
	const handedness = controller.inputSource.handedness;
	return handedness === 'none' ? controller.uniqueId : handedness;
}

interface LaserVisual {
	beam: Mesh; // height=1, stretched/positioned each frame to reach the hit point (or LASER_MAX_LENGTH)
	dot: Mesh; // small sphere shown at the hit point, hidden otherwise
	beamMaterial: StandardMaterial;
	dotMaterial: StandardMaterial;
	ray: Ray;
}

/**
 * Babylon's pointer-selection feature delivers the trigger to any GUI under
 * the ray on its own, so the only way to keep a gun's trigger from also
 * clicking a panel is to take that controller out of the feature while an
 * equipped object listens to it. These are Babylon's own attach/detach
 * methods for exactly this; they are not in the public typings.
 */
function setControllerPointerEnabled(pointerSelection: WebXRDefaultExperience['pointerSelection'], controller: WebXRInputSource, enabled: boolean): void {
	const feature = pointerSelection as unknown as {
		_attachController?: (controller: WebXRInputSource) => void;
		_detachController?: (uniqueId: string) => void;
	};
	try {
		if (enabled) feature._attachController?.(controller);
		else feature._detachController?.(controller.uniqueId);
	} catch (err) {
		console.warn('[pointerController] could not toggle pointer selection for a controller', err);
	}
}

function createLaserVisual(scene: Scene, parent: WebXRInputSource['pointer']): LaserVisual {
	const beam = MeshBuilder.CreateCylinder('laser', { height: 1, diameterTop: 0.002, diameterBottom: 0.006 }, scene);
	const beamMat = new StandardMaterial('laser-mat', scene);
	beamMat.emissiveColor = Color3.FromHexString('#60a5fa');
	beamMat.disableLighting = true;
	beam.material = beamMat;
	beam.parent = parent;
	// CreateCylinder extends along local Y; the controller's forward ray is local +Z
	// (see WebXRInputSource._tmpVector) — rotate Y onto Z so it points forward.
	beam.rotation.x = Math.PI / 2;
	beam.isPickable = false;
	beam.setEnabled(false);

	const dot = MeshBuilder.CreateSphere('laser-dot', { diameter: 0.02 }, scene);
	const dotMat = new StandardMaterial('laser-dot-mat', scene);
	dotMat.emissiveColor = Color3.FromHexString('#93c5fd');
	dotMat.disableLighting = true;
	dot.material = dotMat;
	dot.isPickable = false;
	dot.setEnabled(false);

	return { beam, dot, beamMaterial: beamMat, dotMaterial: dotMat, ray: new Ray(Vector3.Zero(), Vector3.Forward()) };
}

/**
 * Wires the index trigger and grip/squeeze of every XR controller. Each hand
 * has its OWN independent laser toggle — both can be on, both off, or just
 * one, freely (see plan). Babylon's built-in WebXRControllerPointerSelection
 * laser visuals are permanently hidden (that API only supports a single
 * shared toggle); we render our own laser + hit-point dot per controller
 * instead, stopping at whatever it hits (a panel, a grabbable object, ...)
 * rather than passing through — while still reusing the built-in feature's
 * raycasting + GUI-on-mesh click delivery (`displayLaserPointer` only
 * controls visuals, not picking).
 *
 * - trigger tap: if this hand's laser is currently ON and hovering an
 *   interactive mesh, let the click through (no toggle). If ON and not
 *   hovering anything interactive, toggle it OFF. If currently OFF, toggle
 *   it ON (never treated as a click while off).
 * - grip/squeeze: grabs whatever this hand's laser is targeting (only if
 *   that hand's laser is on), else whatever the hand is physically touching.
 */
export function setupPointerAndGrabControllers(
	scene: Scene,
	xr: WebXRDefaultExperience,
	sceneGraph: SceneGraph,
	grabSystem: GrabSystem,
	equipment: EquipmentSystem,
	localPlayerId: () => string,
	network?: PointerControllerNetworkHooks
): PointerControllerState {
	const pointerSelection = xr.pointerSelection;
	pointerSelection.displayLaserPointer = false;
	pointerSelection.displaySelectionMesh = false;

	const laserActive = new Map<string, boolean>();
	const visuals = new Map<string, LaserVisual>();
	const controllers = new Map<string, WebXRInputSource>();
	const pointerDetached = new Set<string>();
	/** The laser's on/off state before a usable object suppressed it, restored when the suppression ends. */
	const laserBeforeSuppress = new Map<string, boolean>();
	const lastValueAt = new Map<string, number>();
	/** How each hand's current grab began: only an object held by the HAND (not the laser) gets the trigger. */
	const grabMode = new Map<string, 'hand' | 'laser'>();
	/** Each controller's stick forward/back, and the hands whose stick is pushing a laser-held object. */
	const stickY = new Map<string, number>();
	const pushing = new Set<EquipHand>();
	const pushRay = new Ray(Vector3.Zero(), Vector3.Forward());

	/**
	 * While a hand holds an object with its laser (and it alone), its stick brings the object closer (back) or pushes it
	 * away (forward) along the laser, faster the further away it is. Pulled all the way in, an equippable object goes into
	 * the hand, equipped, as if caught.
	 */
	function pushOrPull(controller: WebXRInputSource, grabberId: string, dt: number): void {
		const hand = handOf(grabberId);
		if (!hand) return;
		const slotId = grabSystem.getHeldSlot(grabberId);
		const holding = Boolean(slotId && grabMode.get(grabberId) === 'laser' && grabSystem.getGrabbersForSlot(slotId).length === 1);
		if (!holding) {
			if (pushing.delete(hand)) {
				releaseStickY(hand);
				setControllerTeleportEnabled(xr, controller, true);
			}
			return;
		}
		if (!pushing.has(hand)) {
			pushing.add(hand);
			claimStickY(hand);
			setControllerTeleportEnabled(xr, controller, false);
		}
		const y = stickY.get(grabberId) ?? 0;
		// The radial menu uses the stick while it is open.
		if (isHandLocked(hand) || Math.abs(y) < STICK_DEADZONE) return;
		const node = slotId ? sceneGraph.getLive(slotId)?.node : undefined;
		if (!node) return;
		controller.getWorldPointerRayToRef(pushRay);
		node.computeWorldMatrix(true);
		const position = node.getAbsolutePosition().clone();
		const along = Vector3.Dot(position.subtract(pushRay.origin), pushRay.direction);
		const next = pushedDistance(along, y, dt);
		node.setAbsolutePosition(position.add(pushRay.direction.scale(next - along)));
		const live = slotId ? sceneGraph.getLive(slotId) : undefined;
		if (y > 0 && next <= PUSH_RANGE.min && slotId && live && isEquippable(live.slot)) {
			if (!equipment.equip(localPlayerId(), hand, controller.grip ?? controller.pointer, slotId)) return;
			grabMode.delete(grabberId);
			network?.onEquip?.(hand, slotId);
		}
	}

	const handOf = (grabberId: string): EquipHand | null => (grabberId === 'left' || grabberId === 'right' ? grabberId : null);

	function dispatchUse(hand: EquipHand, slotId: string, phase: 'press' | 'release' | 'value', value: number): void {
		if (network?.onUse) network.onUse(slotId, hand, phase, value);
		else equipment.dispatchTrigger(localPlayerId(), hand, phase, value, slotId);
	}

	/**
	 * The object this hand's trigger drives: what is equipped in it, else what
	 * it is holding with the hand itself. An object held with the laser keeps
	 * the normal laser trigger behaviour.
	 */
	function usableSlot(grabberId: string): string | null {
		const hand = handOf(grabberId);
		if (!hand) return null;
		const equipped = equipment.getEquippedSlot(localPlayerId(), hand);
		if (equipped) return equipped;
		return grabMode.get(grabberId) === 'hand' ? grabSystem.getHeldSlot(grabberId) : null;
	}

	/**
	 * Highest priority for the trigger: the usable object in this hand. It
	 * only takes the trigger when it (or a child) declares an `onTrigger`
	 * action; otherwise the normal laser/UI behaviour below applies.
	 */
	function forwardToUsable(grabberId: string, component: { pressed: boolean; value: number; changes: { pressed?: unknown; value?: unknown } }): boolean {
		const hand = handOf(grabberId);
		const slotId = usableSlot(grabberId);
		if (!hand || !slotId || !equipment.hasTriggerAction(localPlayerId(), hand, slotId)) return false;
		if (component.changes.pressed) dispatchUse(hand, slotId, component.pressed ? 'press' : 'release', component.pressed ? 1 : 0);
		else if (component.changes.value) {
			const now = performance.now();
			if (now - (lastValueAt.get(grabberId) ?? 0) >= TRIGGER_VALUE_INTERVAL_MS) {
				lastValueAt.set(grabberId, now);
				dispatchUse(hand, slotId, 'value', component.value);
			}
		}
		return true;
	}

	/** While a usable object listens to a hand's trigger, that hand's laser and UI clicking are off. */
	function refreshEquipInput(hand: EquipHand): void {
		const controller = controllers.get(hand);
		if (!controller) return;
		const slotId = usableSlot(hand);
		const suppress = Boolean(slotId && equipment.hasTriggerAction(localPlayerId(), hand, slotId));
		if (suppress && !pointerDetached.has(hand)) {
			setControllerPointerEnabled(pointerSelection, controller, false);
			pointerDetached.add(hand);
			laserBeforeSuppress.set(hand, laserActive.get(hand) ?? true);
			laserActive.set(hand, false);
		} else if (!suppress && pointerDetached.has(hand)) {
			setControllerPointerEnabled(pointerSelection, controller, true);
			pointerDetached.delete(hand);
			laserActive.set(hand, laserBeforeSuppress.get(hand) ?? true);
			laserBeforeSuppress.delete(hand);
		}
	}
	equipment.onChanged.add((change) => {
		if (change.playerId === localPlayerId()) refreshEquipInput(change.hand);
	});

	xr.input.onControllerAddedObservable.add((controller: WebXRInputSource) => {
		const grabberId = grabberIdFor(controller);
		laserActive.set(grabberId, true);
		controllers.set(grabberId, controller);

		controller.onMotionControllerInitObservable.add((motionController) => {
			const visual = createLaserVisual(scene, controller.pointer);
			visuals.set(grabberId, visual);
			motionController.getComponentOfType(WebXRControllerComponent.THUMBSTICK_TYPE)?.onAxisValueChangedObservable.add((axes) => {
				stickY.set(grabberId, axes.y);
			});

			const trigger = motionController.getComponentOfType(WebXRControllerComponent.TRIGGER_TYPE);
			const squeeze = motionController.getComponentOfType(WebXRControllerComponent.SQUEEZE_TYPE);

			trigger?.onButtonStateChangedObservable.add((component) => {
				if (forwardToUsable(grabberId, component)) return;
				if (!component.changes.pressed || !component.pressed) return; // fire on press-down only

				const wasActive = laserActive.get(grabberId) ?? true;
				if (wasActive) {
					const hovered = pointerSelection.getMeshUnderPointer(controller.uniqueId);
					const hoveredSlotId = sceneGraph.getSlotIdForNode(hovered);
					if (hoveredSlotId && sceneGraph.getLive(hoveredSlotId)?.slot.components.some((item) => item.type === 'worldPortal')) {
						network?.onWorldPortal?.(hoveredSlotId);
						return;
					}
					const isInteractive = Boolean(hovered?.metadata?.interactive);
					if (isInteractive) return; // let the built-in feature's click reach the GUI panel
					laserActive.set(grabberId, false);
				} else {
					laserActive.set(grabberId, true);
				}
			});

			squeeze?.onButtonStateChangedObservable.add((component) => {
				if (!component.changes.pressed) return;
				const grabberNode = controller.grip ?? controller.pointer;

				if (component.pressed) {
					const laserOn = laserActive.get(grabberId) ?? true;
					const viaLaser = laserOn && Boolean(sceneGraph.getSlotIdForNode(pointerSelection.getMeshUnderPointer(controller.uniqueId)));
					const targetSlotId = resolveGrabTarget(
						controller,
						sceneGraph,
						pointerSelection,
						laserOn
					);
					if (targetSlotId) {
						grabSystem.grab(grabberId, grabberNode, targetSlotId);
						if (grabSystem.getHeldSlot(grabberId) === targetSlotId) {
							grabMode.set(grabberId, viaLaser ? 'laser' : 'hand');
							const hand = handOf(grabberId);
							if (hand) refreshEquipInput(hand);
							network?.onGrab?.(grabberId, targetSlotId);
						}
					}
				} else {
					const releasedSlotId = grabSystem.getHeldSlot(grabberId) ?? undefined;
					grabSystem.release(grabberId);
					grabMode.delete(grabberId);
					const hand = handOf(grabberId);
					if (hand) refreshEquipInput(hand);
					network?.onRelease?.(grabberId, releasedSlotId);
				}
			});
		});

		controller.onDisposeObservable.add(() => {
			// Take an equipped object off BEFORE the grip node is disposed, or it would be disposed with it.
			const hand = handOf(grabberId);
			const equippedSlot = hand ? equipment.getEquippedSlot(localPlayerId(), hand) : null;
			if (hand && equippedSlot) {
				equipment.unequip(localPlayerId(), hand);
				network?.onUnequip?.(hand, equippedSlot);
			}
			controllers.delete(grabberId);
			pointerDetached.delete(grabberId);
			stickY.delete(grabberId);
			if (hand && pushing.delete(hand)) releaseStickY(hand);
			laserBeforeSuppress.delete(grabberId);
			grabMode.delete(grabberId);
			const releasedSlotId = grabSystem.getHeldSlot(grabberId) ?? undefined;
			grabSystem.release(grabberId);
			network?.onRelease?.(grabberId, releasedSlotId);
			const visual = visuals.get(grabberId);
			visual?.beam.dispose();
			visual?.dot.dispose();
			visuals.delete(grabberId);
			laserActive.delete(grabberId);
		});
	});

	scene.onBeforeRenderObservable.add(() => {
		const dt = scene.getEngine().getDeltaTime() / 1000;
		for (const controller of xr.input.controllers) {
			const grabberId = grabberIdFor(controller);
			pushOrPull(controller, grabberId, dt);
			const visual = visuals.get(grabberId);
			if (!visual) continue;

			const active = laserActive.get(grabberId) ?? true;
			if (!active) {
				visual.beam.setEnabled(false);
				visual.dot.setEnabled(false);
				continue;
			}

			controller.getWorldPointerRayToRef(visual.ray);
			visual.ray.length = LASER_MAX_LENGTH;
			// A custom predicate REPLACES pickWithRay's default "enabled + visible +
			// pickable" eligibility check rather than adding to it — without the
			// explicit isEnabled()/isVisible checks here, the laser kept hitting a
			// hidden (setEnabled(false)) panel as if it were still there.
			const hit = scene.pickWithRay(visual.ray, (mesh) => mesh.isPickable && mesh.isEnabled() && mesh.isVisible);

			const hitSlotId = sceneGraph.getSlotIdForNode(hit?.pickedMesh);
			const canGrab = Boolean(hitSlotId && sceneGraph.resolveGrabTarget(hitSlotId));
			visual.beamMaterial.emissiveColor = Color3.FromHexString(canGrab ? '#f97316' : '#60a5fa');
			visual.dotMaterial.emissiveColor = Color3.FromHexString(canGrab ? '#fdba74' : '#93c5fd');

			const length = hit?.pickedPoint ? Vector3.Distance(visual.ray.origin, hit.pickedPoint) : LASER_MAX_LENGTH;
			visual.beam.setEnabled(true);
			visual.beam.scaling.y = length;
			visual.beam.position.z = length / 2;

			if (hit?.pickedPoint) {
				visual.dot.setEnabled(true);
				visual.dot.position.copyFrom(hit.pickedPoint);
			} else {
				visual.dot.setEnabled(false);
			}
		}
	});

	return {
		getLaserTarget(hand) {
			const controller = controllers.get(hand);
			if (!controller || !visuals.has(hand) || !laserActive.get(hand)) return null;
			const ray = new Ray(Vector3.Zero(), Vector3.Forward(), LASER_MAX_LENGTH);
			controller.getWorldPointerRayToRef(ray);
			ray.length = LASER_MAX_LENGTH;
			const hit = scene.pickWithRay(ray, (mesh) => mesh.isPickable && mesh.isEnabled() && mesh.isVisible);
			const slotId = sceneGraph.getSlotIdForNode(hit?.pickedMesh);
			return slotId && sceneGraph.slotIds({ withoutAvatars: true }).includes(slotId) ? slotId : null;
		}
	};
}

function resolveGrabTarget(
	controller: WebXRInputSource,
	sceneGraph: SceneGraph,
	pointerSelection: WebXRDefaultExperience['pointerSelection'],
	laserActiveForHand: boolean
): string | null {
	if (laserActiveForHand) {
		const mesh = pointerSelection.getMeshUnderPointer(controller.uniqueId);
		const slotId = sceneGraph.getSlotIdForNode(mesh);
		if (slotId) return sceneGraph.resolveGrabTarget(slotId);
	}

	const gripPosition = (controller.grip ?? controller.pointer).absolutePosition;
	let closest: { slotId: string; distance: number } | null = null;
	for (const { slot, node } of sceneGraph.allSlots()) {
		const effectiveTargetId = sceneGraph.resolveGrabTarget(slot.id);
		if (!effectiveTargetId) continue;
		const distance = Vector3.Distance(node.absolutePosition, gripPosition);
		if (distance <= HAND_GRAB_RADIUS && (!closest || distance < closest.distance)) {
			closest = { slotId: effectiveTargetId, distance };
		}
	}
	return closest?.slotId ?? null;
}
