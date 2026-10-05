import { KeyboardEventTypes, type Camera, type Scene, type TransformNode, type WebXRDefaultExperience } from '@babylonjs/core';
import { placeInFrontOfCamera } from './panelPlacement';

const PANEL_DISTANCE = 1;
const PANEL_HEIGHT_OFFSET = -0.15; // slightly below eye level, like Resonite's dash

/**
 * Toggles visibility of a panel root node, repositioning it in front of
 * wherever the user is currently looking each time it opens (not a fixed
 * world position) — same as Neos/Resonite's dash/inspector.
 *
 * The WebXR Device API deliberately does NOT expose the headset's physical
 * system/menu button to page content on most runtimes (it's reserved for
 * the OS). We use a face button if the connected controller profile happens
 * to expose one, falling back to it gracefully being unavailable — plus a
 * keyboard shortcut for desktop (non-XR) testing.
 */
export function setupPanelToggle(
	scene: Scene,
	xr: WebXRDefaultExperience | null,
	panelRoot: TransformNode,
	getActiveCamera: () => Camera,
	options: { keyboardKey: string; buttonIdPattern: RegExp },
	onToggle?: (visible: boolean) => void
): void {
	const toggle = () => {
		const opening = !panelRoot.isEnabled();
		if (opening) placeInFrontOfCamera(panelRoot, getActiveCamera(), PANEL_DISTANCE, PANEL_HEIGHT_OFFSET);
		panelRoot.setEnabled(opening);
		onToggle?.(opening);
	};

	scene.onKeyboardObservable.add((info) => {
		if (info.type === KeyboardEventTypes.KEYDOWN && info.event.key.toLowerCase() === options.keyboardKey) {
			// Keys like Tab would otherwise also move the page's focus.
			info.event.preventDefault();
			if (!info.event.repeat) toggle();
		}
	});

	// Without WebXR (desktop) the keyboard key is all there is.
	xr?.input.onControllerAddedObservable.add((controller) => {
		controller.onMotionControllerInitObservable.add((motionController) => {
			const buttonId = motionController.getComponentIds().find((id) => options.buttonIdPattern.test(id));
			if (!buttonId) return;

			motionController.getComponent(buttonId).onButtonStateChangedObservable.add((component) => {
				if (component.changes.pressed?.current) toggle();
			});
		});
	});
}
