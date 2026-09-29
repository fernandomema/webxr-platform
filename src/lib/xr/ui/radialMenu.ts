import {
	MeshBuilder,
	StandardMaterial,
	Color3,
	Vector3,
	Quaternion,
	WebXRControllerComponent,
	type Scene,
	type TransformNode,
	type WebXRDefaultExperience,
	type WebXRInputSource
} from '@babylonjs/core';
import { AdvancedDynamicTexture, Button } from '@babylonjs/gui';
import { extractSubtree } from '$lib/ecs/serialize';
import { getInventoryAdapter } from '$lib/inventory/registry';
import { gameState, getInventoryContext } from '../gameState';
import type { GrabSystem } from '../interaction/grabSystem';
import type { SceneGraph } from '../sceneGraph';
import { lockHand, unlockHand, type Hand } from '../interaction/handLock';

const TEXTURE_SIZE = 400;
const RADIUS = 130;
const ITEM_SIZE = 110;
const HOVER_DEADZONE = 0.35;
const FOLLOW_OFFSET = new Vector3(0, 0.05, 0);

export interface RadialMenuNetworkHooks {
	onDelete?(slotId: string): void;
}

interface RadialItem {
	label: string;
	isEnabled(): boolean;
	onSelect(): void | Promise<void>;
}

/**
 * Per-hand context menu: Y opens the left hand's, B the right hand's, each
 * fully independent (own items, own selection, own held object). While
 * open, that hand's thumbstick is repurposed for hover (angle) + click to
 * confirm (stick press) instead of movement/turning (see handLock.ts) —
 * joystick-driven, not something you point a laser at.
 *
 * The menu only has items relevant to whatever THIS hand is currently
 * holding (by hand or by its laser, either counts) — if it's holding
 * nothing there is nothing to do, so the menu doesn't open at all rather
 * than show disabled/empty content. "Guardar" is itself disabled (but still
 * shown) when nothing is holding is untrue but no inventory folder ("pwd")
 * is open yet in the Dash.
 */
export function setupRadialMenuForHand(
	scene: Scene,
	xr: WebXRDefaultExperience,
	sceneGraph: SceneGraph,
	grabSystem: GrabSystem,
	hand: Hand,
	buttonPattern: RegExp,
	network?: RadialMenuNetworkHooks
): void {
	const plane = MeshBuilder.CreatePlane(`radial-menu-${hand}`, { size: 0.22 }, scene);
	const material = new StandardMaterial(`radial-menu-mat-${hand}`, scene);
	material.disableLighting = true;
	material.emissiveColor = Color3.White();
	plane.material = material;
	plane.isPickable = false; // hover/select is via joystick, not pointing
	plane.setEnabled(false);

	const texture = AdvancedDynamicTexture.CreateForMesh(plane, TEXTURE_SIZE, TEXTURE_SIZE, true);

	function heldSlotId(): string | null {
		return grabSystem.getHeldSlot(hand);
	}

	function buildItems(slotId: string): RadialItem[] {
		return [
			...sceneGraph.getRadialExtras(slotId),
			{
				label: 'Guardar',
				isEnabled: () => gameState.currentInventoryAdapterId !== null,
				onSelect: async () => {
					if (!gameState.currentInventoryAdapterId) return;
					const adapter = getInventoryAdapter(gameState.currentInventoryAdapterId);
					if (!adapter) return;
					const subtree = extractSubtree(sceneGraph.serialize(), slotId);
					if (subtree.length === 0) return;
					await adapter.saveItem(getInventoryContext(), gameState.currentInventoryFolderId, subtree[0].name, subtree);
				}
			},
			{
				label: 'Eliminar',
				isEnabled: () => true,
				onSelect: () => {
					grabSystem.release(hand);
					if (network?.onDelete) network.onDelete(slotId);
					else sceneGraph.removeSlot(slotId);
				}
			}
		];
	}

	let items: RadialItem[] = [];
	const buttons: Button[] = [];
	let hoveredIndex = 0;

	function buildButtons(): void {
		texture.getChildren()[0]?.dispose();
		buttons.length = 0;
		items.forEach((item, i) => {
			const angle = (2 * Math.PI * i) / items.length - Math.PI / 2;
			const btn = Button.CreateSimpleButton(`radial-${hand}-${i}`, item.label);
			btn.width = `${ITEM_SIZE}px`;
			btn.height = `${ITEM_SIZE}px`;
			btn.cornerRadius = ITEM_SIZE / 2;
			btn.color = 'white';
			btn.left = `${Math.cos(angle) * RADIUS}px`;
			btn.top = `${Math.sin(angle) * RADIUS}px`;
			texture.addControl(btn);
			buttons.push(btn);
		});
	}

	function updateHighlight(): void {
		buttons.forEach((btn, i) => {
			const enabled = items[i].isEnabled();
			btn.alpha = enabled ? 1 : 0.4;
			btn.background = !enabled ? '#374151' : i === hoveredIndex ? '#2563eb' : '#1f2937';
		});
	}

	let anchor: TransformNode | null = null;
	let stickX = 0;
	let stickY = 0;

	function close(): void {
		plane.setEnabled(false);
		unlockHand(hand);
	}

	function open(controllerNode: TransformNode): void {
		const slotId = heldSlotId();
		if (!slotId) return; // nothing held — nothing this menu can do, so don't open at all

		anchor = controllerNode;
		items = buildItems(slotId);
		hoveredIndex = 0;
		buildButtons();
		updateHighlight();
		plane.setEnabled(true);
		lockHand(hand);
	}

	xr.input.onControllerAddedObservable.add((controller: WebXRInputSource) => {
		if (controller.inputSource.handedness !== hand) return;

		controller.onMotionControllerInitObservable.add((motionController) => {
			const stick =
				motionController.getComponentOfType(WebXRControllerComponent.THUMBSTICK_TYPE) ??
				motionController.getComponentOfType(WebXRControllerComponent.TOUCHPAD_TYPE);
			const openButtonId = motionController.getComponentIds().find((id) => buttonPattern.test(id));

			if (openButtonId) {
				motionController.getComponent(openButtonId).onButtonStateChangedObservable.add((component) => {
					if (!component.changes.pressed?.current) return;
					if (plane.isEnabled()) close();
					else open(controller.grip ?? controller.pointer);
				});
			}

			stick?.onAxisValueChangedObservable.add((axes) => {
				stickX = axes.x;
				stickY = axes.y;
			});

			// stick click confirms the hovered item
			stick?.onButtonStateChangedObservable.add((component) => {
				if (!plane.isEnabled() || !component.changes.pressed?.current) return;
				const item = items[hoveredIndex];
				if (item?.isEnabled()) void item.onSelect();
				close();
			});
		});

		controller.onDisposeObservable.add(() => close());
	});

	scene.onBeforeRenderObservable.add(() => {
		if (!plane.isEnabled() || !anchor) return;

		plane.position.copyFrom(anchor.absolutePosition.add(FOLLOW_OFFSET));
		// Yaw-only billboard: stays upright and always readable, rather than a
		// full lookAt that would tilt it based on how far above/below the
		// camera the hand currently is.
		const camera = xr.baseExperience.camera;
		const dx = camera.globalPosition.x - plane.position.x;
		const dz = camera.globalPosition.z - plane.position.z;
		// +Math.PI: the plane's GUI-textured face is on its -Z side (see the
		// Dash/Inspector panels' placement fix), so facing +Z at the camera
		// would show it mirrored.
		plane.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.atan2(dx, dz) + Math.PI, 0);

		if (Math.hypot(stickX, stickY) >= HOVER_DEADZONE) {
			const angle = Math.atan2(stickY, stickX);
			const step = (2 * Math.PI) / items.length;
			hoveredIndex = ((Math.round((angle + Math.PI / 2) / step) % items.length) + items.length) % items.length;
		}
		updateHighlight();
	});
}
