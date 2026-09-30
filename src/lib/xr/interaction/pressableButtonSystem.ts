import { Vector3, type Scene, type TransformNode } from '@babylonjs/core';
import { findComponent } from '$lib/ecs/types';
import type { SceneGraph } from '../sceneGraph';

/**
 * Generic physically-pressable button: any Slot with a `pressableButton`
 * component visually depresses along its local `axis` as a hand or
 * controller tip pushes into it — no grab gesture, no controller button —
 * and springs back the instant the tip retracts. Fires the codeBlock's
 * `onPress()` once depression crosses `threshold`. Reusable for any
 * physical-button use case (a reset button, an elevator panel, a switch),
 * not tied to any one demo.
 */
export class PressableButtonSystem {
	private wasPressed = new Set<string>();

	constructor(
		scene: Scene,
		private sceneGraph: SceneGraph,
		/** Every hand/controller "tip" currently in the scene — reused as-is from whatever pointerController.ts already treats as the interaction point (grip/pointer node), so hand-tracking and motion controllers both just work. */
		private getPresserNodes: () => TransformNode[]
	) {
		scene.onBeforeRenderObservable.add(() => this.update());
	}

	private update(): void {
		const pressers = this.getPresserNodes();

		for (const entry of this.sceneGraph.slotsWith('pressableButton')) {
			const button = findComponent(entry.slot, 'pressableButton');
			if (!button) continue;

			const node = entry.node;
			const parent = node.parent as TransformNode | null;
			const restLocal = Vector3.FromArray(entry.slot.position);
			const axisLocal = Vector3.FromArray(button.axis).normalize();

			let restWorld = restLocal;
			let axisWorld = axisLocal;
			if (parent) {
				parent.computeWorldMatrix(true);
				const parentMatrix = parent.getWorldMatrix();
				restWorld = Vector3.TransformCoordinates(restLocal, parentMatrix);
				axisWorld = Vector3.TransformNormal(axisLocal, parentMatrix).normalize();
			}

			let depression = 0;
			for (const presser of pressers) {
				presser.computeWorldMatrix(true);
				const toTip = presser.absolutePosition.subtract(restWorld);
				const axialDist = Vector3.Dot(toTip, axisWorld);
				if (axialDist < -0.01 || axialDist > button.travel + 0.02) continue;
				const lateralDist = toTip.subtract(axisWorld.scale(axialDist)).length();
				if (lateralDist > button.radius) continue;
				depression = Math.max(depression, Math.min(Math.max(axialDist, 0), button.travel));
			}

			node.position = restLocal.add(axisLocal.scale(depression));

			const threshold = button.threshold ?? 1;
			const isPressed = button.travel > 0 && depression / button.travel >= threshold;
			if (isPressed && !this.wasPressed.has(entry.slot.id)) {
				this.wasPressed.add(entry.slot.id);
				try {
					entry.runtime?.onPress?.();
				} catch (err) {
					console.error(`[pressableButtonSystem] onPress threw for ${entry.slot.id}`, err);
				}
			} else if (!isPressed) {
				this.wasPressed.delete(entry.slot.id);
			}
		}
	}
}
