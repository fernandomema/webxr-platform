import { Vector3, WebXRControllerComponent, type Scene, type TransformNode, type WebXRDefaultExperience, type WebXRInputSource } from '@babylonjs/core';
import { extractSubtree } from '$lib/ecs/serialize';
import { isEquippable } from '$lib/ecs/types';
import { getInventoryAdapter } from '$lib/inventory/registry';
import { gameState, getInventoryContext } from '../gameState';
import type { GrabSystem } from '../interaction/grabSystem';
import type { EquipmentSystem } from '../interaction/equipmentSystem';
import type { SceneGraph } from '../sceneGraph';
import { lockHand, unlockHand, type Hand } from '../interaction/handLock';
import { createRadialView, type RadialItem } from './radialView';
import { forInventory } from '../avatar/build';
import { saveWithPreview } from '../inventorySave';

export interface RadialMenuNetworkHooks {
	onDelete?(slotId: string): void;
	onEquip?(hand: Hand, slotId: string): void;
	onUnequip?(hand: Hand, slotId: string): void;
	getInspectTarget?(hand: Hand): string | null;
	onInspect?(slotId: string): void;
}

export interface RadialContext {
	sceneGraph: SceneGraph;
	grabSystem: GrabSystem;
	equipment: EquipmentSystem;
	localPlayerId: () => string;
	network?: RadialMenuNetworkHooks;
}

/**
 * The options of a hand's radial menu. `slotId` is the object the menu is about (held or equipped in the hand, or, on
 * desktop, the one aimed at); `inspectTarget` is what the laser is on, offered for inspection.
 */
export function buildRadialItems(
	{ sceneGraph, grabSystem, equipment, localPlayerId, network }: RadialContext,
	hand: Hand,
	handNode: TransformNode,
	target: { slotId: string | null; inspectTarget: string | null }
): RadialItem[] {
	const player = localPlayerId();
	const { slotId, inspectTarget } = target;
	const equippedSlotId = equipment.getEquippedSlot(player, hand);
	const items: RadialItem[] = [];
	if (slotId) {
		const live = sceneGraph.getLive(slotId);
		const isEquipped = equippedSlotId === slotId;
		const equipItems: RadialItem[] = isEquipped
			? [{
				label: 'Unequip',
				isEnabled: () => true,
				onSelect: () => {
					if (equipment.unequip(player, hand)) network?.onUnequip?.(hand, slotId);
				}
			}]
			: live && isEquippable(live.slot)
				? [{
					label: 'Equip',
					isEnabled: () => equipment.getEquippedSlot(player, hand) === null,
					onSelect: () => {
						if (equipment.equip(player, hand, handNode, slotId)) network?.onEquip?.(hand, slotId);
					}
				}]
				: [];
		items.push(
			...sceneGraph.getRadialExtrasForSubtree(slotId),
			...equipItems,
			{
				label: 'Save',
				isEnabled: () => Boolean(gameState.currentInventoryAdapterId && getInventoryAdapter(gameState.currentInventoryAdapterId)?.saveItem),
				onSelect: async () => {
					const adapter = gameState.currentInventoryAdapterId ? getInventoryAdapter(gameState.currentInventoryAdapterId) : undefined;
					if (!adapter?.saveItem) return;
					const subtree = extractSubtree(sceneGraph.serialize(), slotId);
					if (!subtree.length) return;
					const { tree, kind } = forInventory(subtree);
					await saveWithPreview(adapter, getInventoryContext(), gameState.currentInventoryFolderId, tree[0].name, tree, kind);
				}
			},
			{
				label: 'Delete',
				isEnabled: () => true,
				onSelect: () => {
					if (equipment.unequip(player, hand)) network?.onUnequip?.(hand, slotId);
					grabSystem.release(hand);
					if (network?.onDelete) network.onDelete(slotId);
					else sceneGraph.removeSlot(slotId);
				}
			}
		);
	}
	if (inspectTarget) items.push({
		label: 'Inspect',
		isEnabled: () => network?.getInspectTarget?.(hand) === inspectTarget,
		onSelect: () => {
			if (network?.getInspectTarget?.(hand) === inspectTarget) network.onInspect?.(inspectTarget);
		}
	});
	return items;
}

/** Joystick input adapter for the shared radial view: the stick points at an option; the stick click or the menu button applies it. */
export function setupRadialMenuForHand(
	scene: Scene,
	xr: WebXRDefaultExperience,
	sceneGraph: SceneGraph,
	grabSystem: GrabSystem,
	equipment: EquipmentSystem,
	localPlayerId: () => string,
	hand: Hand,
	buttonPattern: RegExp,
	network?: RadialMenuNetworkHooks
): void {
	const view = createRadialView(scene, `hand-${hand}`, () => xr.baseExperience.camera, {
		pointerSelectable: false,
		size: 0.22,
		offset: new Vector3(0, 0.05, 0)
	});
	let stickX = 0;
	let stickY = 0;
	let selectedIndex = 0;
	/** Whether the stick is pushed far enough to point at an option. */
	let pointing = false;
	/** The object the open menu is about; the menu closes if it leaves the hand. */
	let menuSlotId: string | null = null;
	let inspectTargetId: string | null = null;
	/**
	 * The menu has closed but the stick is still pushed (it was used to pick an option): the hand goes back to moving and
	 * turning only once the stick is let go, or that same push would turn or move the player.
	 */
	let releasing = false;

	function close() {
		pointing = false;
		view.close();
		menuSlotId = null;
		inspectTargetId = null;
		releasing = true;
	}
	const inHand = (slotId: string) => equipment.getEquippedSlot(localPlayerId(), hand) === slotId || grabSystem.getHeldSlot(hand) === slotId;
	/** Applies the option pointed at, closing the hand's menu if that closed it. */
	function pick() {
		void view.select(selectedIndex);
		if (!view.isOpen) close();
	}
	function open(controller: WebXRInputSource) {
		const player = localPlayerId();
		const equippedSlotId = equipment.getEquippedSlot(player, hand);
		// An equipped object keeps its hand's menu available without holding the grip.
		const slotId = equippedSlotId ?? grabSystem.getHeldSlot(hand);
		const inspectTarget = network?.onInspect ? network.getInspectTarget?.(hand) ?? null : null;
		if (!slotId && !inspectTarget) return;
		const items = buildRadialItems({ sceneGraph, grabSystem, equipment, localPlayerId, network }, hand, controller.grip ?? controller.pointer, { slotId, inspectTarget });
		selectedIndex = 0;
		view.open(controller.grip ?? controller.pointer, items);
		menuSlotId = slotId;
		inspectTargetId = inspectTarget;
		releasing = false;
		lockHand(hand);
	}

	xr.input.onControllerAddedObservable.add((controller) => {
		if (controller.inputSource.handedness !== hand) return;
		controller.onMotionControllerInitObservable.add((motionController) => {
			const stick = motionController.getComponentOfType(WebXRControllerComponent.THUMBSTICK_TYPE) ??
				motionController.getComponentOfType(WebXRControllerComponent.TOUCHPAD_TYPE);
			const openButtonId = motionController.getComponentIds().find((id) => buttonPattern.test(id));
			if (openButtonId) motionController.getComponent(openButtonId).onButtonStateChangedObservable.add((component) => {
				if (!component.changes.pressed?.current) return;
				// Open, with an option pointed at, the button applies it like a click of the stick; otherwise it closes the menu.
				if (!view.isOpen) open(controller);
				else if (pointing) pick();
				else close();
			});
			stick?.onAxisValueChangedObservable.add((axes) => { stickX = axes.x; stickY = axes.y; });
			// Clicking the stick opens the menu, like the menu button; while it is open, it picks the option pointed at.
			stick?.onButtonStateChangedObservable.add((component) => {
				if (!component.changes.pressed?.current) return;
				if (!view.isOpen) {
					open(controller);
					return;
				}
				pick();
			});
		});
		controller.onDisposeObservable.add(() => {
			stickX = stickY = 0;
			close();
		});
	});

	scene.onBeforeRenderObservable.add(() => {
		if (releasing && Math.hypot(stickX, stickY) < 0.2) {
			releasing = false;
			unlockHand(hand);
		}
		// Dropped, unequipped or deleted: its options no longer apply.
		if (view.isOpen && menuSlotId && !inHand(menuSlotId)) close();
		if (view.isOpen && inspectTargetId && network?.getInspectTarget?.(hand) !== inspectTargetId) close();
		pointing = view.isOpen && Math.hypot(stickX, stickY) >= 0.35;
		if (!pointing) return;
		const angle = Math.atan2(stickY, stickX);
		const step = (2 * Math.PI) / view.itemCount;
		selectedIndex = ((Math.round((angle + Math.PI / 2) / step) % view.itemCount) + view.itemCount) % view.itemCount;
		view.setHovered(selectedIndex);
	});
	scene.onDisposeObservable.add(() => view.dispose());
}
