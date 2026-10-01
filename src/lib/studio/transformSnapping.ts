import type { GizmoManager, Scene } from '@babylonjs/core';

export const SNAP_PRECISIONS = {
	fine: { move: 0.01, rotate: 1, scale: 0.01 },
	medium: { move: 0.1, rotate: 15, scale: 0.1 },
	coarse: { move: 0.5, rotate: 45, scale: 0.5 }
} as const;
export type SnapPrecision = keyof typeof SNAP_PRECISIONS;

/** Keep all Studio transform handles in step while Shift is held. */
export function bindTransformSnapping(scene: Scene, manager: GizmoManager, target: EventTarget | undefined = typeof window === 'undefined' ? undefined : window, getPrecision: () => SnapPrecision = () => 'medium'): () => void {
	let enabled = false;
	const apply = () => {
		const steps = SNAP_PRECISIONS[getPrecision()];
		const { positionGizmo, rotationGizmo, scaleGizmo } = manager.gizmos;
		if (positionGizmo) positionGizmo.snapDistance = enabled ? steps.move : 0;
		if (rotationGizmo) rotationGizmo.snapDistance = enabled ? steps.rotate * Math.PI / 180 : 0;
		if (scaleGizmo) {
			scaleGizmo.incrementalSnap = true;
			scaleGizmo.snapDistance = enabled ? steps.scale : 0;
		}
	};
	const modifiers = (event: Event) => {
		enabled = (event as KeyboardEvent | PointerEvent).shiftKey;
		apply();
	};
	const reset = () => { enabled = false; apply(); };
	const events = ['keydown', 'keyup', 'pointerdown', 'pointermove'];
	for (const name of events) target?.addEventListener(name, modifiers, { capture: true });
	target?.addEventListener('blur', reset);
	// Gizmos are created lazily when their mode is first selected.
	const observer = scene.onBeforeRenderObservable.add(apply);
	return () => {
		for (const name of events) target?.removeEventListener(name, modifiers, { capture: true });
		target?.removeEventListener('blur', reset);
		scene.onBeforeRenderObservable.remove(observer);
	};
}
