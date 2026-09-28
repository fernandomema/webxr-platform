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

const HAND_GRAB_RADIUS = 0.15;
const LASER_MAX_LENGTH = 5;

export interface PointerControllerNetworkHooks {
	onGrab?(grabberId: string, slotId: string): void;
	onRelease?(grabberId: string, slotId?: string): void;
}

/** Stable per-hand id ('left' | 'right'), used both locally and sent to the host when networked. */
function grabberIdFor(controller: WebXRInputSource): string {
	const handedness = controller.inputSource.handedness;
	return handedness === 'none' ? controller.uniqueId : handedness;
}

interface LaserVisual {
	beam: Mesh; // height=1, stretched/positioned each frame to reach the hit point (or LASER_MAX_LENGTH)
	dot: Mesh; // small sphere shown at the hit point, hidden otherwise
	ray: Ray;
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

	return { beam, dot, ray: new Ray(Vector3.Zero(), Vector3.Forward()) };
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
	network?: PointerControllerNetworkHooks
): void {
	const pointerSelection = xr.pointerSelection;
	pointerSelection.displayLaserPointer = false;
	pointerSelection.displaySelectionMesh = false;

	const laserActive = new Map<string, boolean>();
	const visuals = new Map<string, LaserVisual>();

	xr.input.onControllerAddedObservable.add((controller: WebXRInputSource) => {
		const grabberId = grabberIdFor(controller);
		laserActive.set(grabberId, true);

		controller.onMotionControllerInitObservable.add((motionController) => {
			const visual = createLaserVisual(scene, controller.pointer);
			visuals.set(grabberId, visual);

			const trigger = motionController.getComponentOfType(WebXRControllerComponent.TRIGGER_TYPE);
			const squeeze = motionController.getComponentOfType(WebXRControllerComponent.SQUEEZE_TYPE);

			trigger?.onButtonStateChangedObservable.add((component) => {
				if (!component.changes.pressed || !component.pressed) return; // fire on press-down only

				const wasActive = laserActive.get(grabberId) ?? true;
				if (wasActive) {
					const hovered = pointerSelection.getMeshUnderPointer(controller.uniqueId);
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
					const targetSlotId = resolveGrabTarget(
						controller,
						sceneGraph,
						pointerSelection,
						laserActive.get(grabberId) ?? true
					);
					if (targetSlotId) {
						grabSystem.grab(grabberId, grabberNode, targetSlotId);
						if (grabSystem.getHeldSlot(grabberId) === targetSlotId) {
							network?.onGrab?.(grabberId, targetSlotId);
						}
					}
				} else {
					const releasedSlotId = grabSystem.getHeldSlot(grabberId) ?? undefined;
					grabSystem.release(grabberId);
					network?.onRelease?.(grabberId, releasedSlotId);
				}
			});
		});

		controller.onDisposeObservable.add(() => {
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
		for (const controller of xr.input.controllers) {
			const grabberId = grabberIdFor(controller);
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
		if (slotId) return slotId;
	}

	const gripPosition = (controller.grip ?? controller.pointer).absolutePosition;
	let closest: { slotId: string; distance: number } | null = null;
	for (const { slot, node } of sceneGraph.allSlots()) {
		if (!slot.components.some((c) => c.type === 'grabbable')) continue;
		const distance = Vector3.Distance(node.absolutePosition, gripPosition);
		if (distance <= HAND_GRAB_RADIUS && (!closest || distance < closest.distance)) {
			closest = { slotId: slot.id, distance };
		}
	}
	return closest?.slotId ?? null;
}
