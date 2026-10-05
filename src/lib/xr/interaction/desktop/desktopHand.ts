import { Axis, KeyboardEventTypes, PickingInfo, Space, TransformNode, Vector3, type AbstractMesh, type Scene, type UniversalCamera } from '@babylonjs/core';
import { isEquippable, isGrabbable } from '$lib/ecs/types';
import type { SceneGraph } from '../../sceneGraph';
import type { GrabSystem } from '../grabSystem';
import type { EquipmentSystem } from '../equipmentSystem';
import type { EquipHand } from '../equipmentRegistry';
import type { PointerControllerNetworkHooks } from '../pointerController';
import { PUSH_RANGE } from '../pushPull';
import { buildRadialItems, type RadialMenuNetworkHooks } from '../../ui/radialMenu';
import type { RadialItem } from '../../ui/radialView';
import type { FpsController } from './fpsController';
import { desktopHud, type AimKind } from './desktopHud.svelte';
import { WHEEL_TURN_DEGREES, pieIndexAt, pieOffset, wheelNotches, wheelPushedDistance, wheelScaledBy } from './desktopMath';

/** The mouse plays the right hand: its id in the grab, equipment and avatar systems. */
const HAND: EquipHand = 'right';
/** How far the crosshair reaches, like the controller's laser but longer: a mouse has no arm to walk with. */
const REACH = 12;
/** The id of the pointer that clicks panels from the crosshair (the real mouse's is not used while it is captured). */
const POINTER_ID = 300;
/** Where the hand rests, in the camera's space: low and to the right, where an equipped object shows. */
const HAND_REST = new Vector3(0.26, -0.22, 0.45);
/** A right click shorter than this (and without moving) leaves the menu open to pick from; held longer, releasing picks. */
const TAP_MS = 220;
const PIE_PIXELS_PER_RADIUS = 90;
const PIE_DEADZONE = 0.4;
/** Wheel `deltaMode` 1 is in lines, not pixels. */
const LINE_PIXELS = 33;

export interface DesktopHandOptions {
	scene: Scene;
	camera: UniversalCamera;
	sceneGraph: SceneGraph;
	grabSystem: GrabSystem;
	equipment: EquipmentSystem;
	localPlayerId: () => string;
	fps: FpsController;
	/** The hand works while this is true (no headset session, no panel over the screen). */
	isActive: () => boolean;
	/** The same reactions to a grab, a use or a world portal that a controller's have (they tell the host or the guests). */
	network: PointerControllerNetworkHooks;
	/** What the radial menu's options do to the world; `getInspectTarget` is the hand's own and ignored. */
	radial: Omit<RadialMenuNetworkHooks, 'getInspectTarget'>;
	/** Options offered when there is nothing to act on: the menu, the inspector. */
	globalItems: () => RadialItem[];
}

export interface DesktopHand {
	handNode: TransformNode;
	dispose(): void;
}

interface Aim {
	pick: PickingInfo | null;
	kind: AimKind;
	slotId: string | null;
	grabTarget: string | null;
}

const NO_AIM: Aim = { pick: null, kind: 'none', slotId: null, grabTarget: null };

/**
 * A stand-in for the VR hand, driven by the mouse while it is captured. The crosshair is the controller's laser:
 *
 * - Left button: click what is aimed at (a panel, a button) or press the trigger of what the hand has equipped (or is
 *   carrying); otherwise grab it and drag it, letting go when the button is released.
 * - E: grab what is aimed at and keep carrying it (or drop it). Pressed while dragging, it keeps what is dragged.
 * - Wheel: push or pull what is carried along the view (all the way in equips it); Ctrl+wheel scales, Shift+wheel turns it.
 * - Right button (held, then move the mouse to a slice and let go; or tap and click a slice): the radial menu of what is
 *   carried or aimed at.
 * - Q: drop, or take off what is equipped.
 */
export function setupDesktopHand(options: DesktopHandOptions): DesktopHand {
	const { scene, camera, sceneGraph, grabSystem, equipment, fps, network } = options;
	const player = options.localPlayerId;

	const handNode = new TransformNode('desktop-hand', scene);
	handNode.parent = camera;
	handNode.position.copyFrom(HAND_REST);

	let holdMode: 'none' | 'momentary' | 'latched' = 'none';
	let uiPress: PickingInfo | null = null;
	let uiHover = false;
	/** The slot whose trigger is down. */
	let useActive: string | null = null;
	let aim: Aim = NO_AIM;
	let validIds: Set<string> | null = null;
	const stopWatching = sceneGraph.onChanged(() => { validIds = null; });
	const slotNameOf = (slotId: string | null): string => (slotId ? sceneGraph.getLive(slotId)?.slot.name || 'Object' : '');
	/** The objects of the world (not the avatars, not the panels the game itself keeps). */
	const isWorldSlot = (slotId: string): boolean => {
		validIds ??= new Set(sceneGraph.slotIds({ withoutAvatars: true }));
		return validIds.has(slotId);
	};

	const held = () => grabSystem.getHeldSlot(HAND);
	const equipped = () => equipment.getEquippedSlot(player(), HAND);
	const carried = () => equipped() ?? held();

	// --- aiming -----------------------------------------------------------------------------------------------------

	const pickable = (mesh: AbstractMesh): boolean => {
		if (!mesh.isPickable || !mesh.isEnabled() || !mesh.isVisible) return false;
		if (mesh.metadata?.interactive) return true;
		const slotId = sceneGraph.getSlotIdForNode(mesh);
		return !slotId || isWorldSlot(slotId);
	};

	function computeAim(): Aim {
		const pick = scene.pickWithRay(camera.getForwardRay(REACH), pickable);
		if (!pick?.hit || !pick.pickedMesh) return { ...NO_AIM, pick: pick ?? null };
		const slotId = sceneGraph.getSlotIdForNode(pick.pickedMesh);
		const grabTarget = slotId ? sceneGraph.resolveGrabTarget(slotId) : null;
		const interactive = Boolean(pick.pickedMesh.metadata?.interactive);
		const kind: AimKind = interactive ? 'ui' : grabTarget ? 'grab' : slotId && isWorldSlot(slotId) ? 'object' : 'none';
		return { pick, kind, slotId: slotId && (interactive || isWorldSlot(slotId)) ? slotId : null, grabTarget: interactive ? null : grabTarget };
	}

	const pointerInit = (button = 0, buttons = 0): PointerEventInit => ({ pointerId: POINTER_ID, pointerType: 'xr' as string, button, buttons });

	// --- using, grabbing, carrying ----------------------------------------------------------------------------------

	function dispatchUse(slotId: string, phase: 'press' | 'release', value: number): void {
		if (network.onUse) network.onUse(slotId, HAND, phase, value);
		else equipment.dispatchTrigger(player(), HAND, phase, value, slotId);
	}

	/** The object the left button's click should fire, if what is carried listens to it. */
	function triggerTarget(): string | null {
		// A drag keeps the button busy: only an equipped or a kept (carried) object can be fired.
		if (holdMode === 'momentary') return null;
		const slotId = carried();
		return slotId && equipment.hasTriggerAction(player(), HAND, slotId) ? slotId : null;
	}

	function grabAimed(mode: 'momentary' | 'latched'): boolean {
		const target = aim.grabTarget;
		if (!target) return false;
		grabSystem.grab(HAND, handNode, target);
		if (grabSystem.getHeldSlot(HAND) !== target) return false;
		holdMode = mode;
		network.onGrab?.(HAND, target);
		return true;
	}

	function drop(): void {
		const slotId = held();
		if (!slotId) return;
		grabSystem.release(HAND);
		holdMode = 'none';
		network.onRelease?.(HAND, slotId);
	}

	function unequipCarried(): void {
		const slotId = equipped();
		if (slotId && equipment.unequip(player(), HAND)) network.onUnequip?.(HAND, slotId);
	}

	function worldPortalAt(slotId: string | null): string | null {
		return slotId && sceneGraph.getLive(slotId)?.slot.components.some((component) => component.type === 'worldPortal') ? slotId : null;
	}

	function onPrimaryDown(): void {
		if (radial) {
			if (radial.sticky) commitRadial();
			return;
		}
		const fire = triggerTarget();
		if (fire) {
			useActive = fire;
			dispatchUse(fire, 'press', 1);
			return;
		}
		if (held()) {
			if (holdMode === 'latched') drop();
			return;
		}
		const portal = worldPortalAt(aim.slotId);
		if (portal && network.onWorldPortal) {
			network.onWorldPortal(portal);
			return;
		}
		if (aim.kind === 'ui' && aim.pick) {
			uiPress = aim.pick;
			scene.simulatePointerDown(aim.pick, pointerInit(0, 1));
			return;
		}
		if (aim.kind === 'grab') grabAimed('momentary');
	}

	function onPrimaryUp(): void {
		if (useActive) {
			dispatchUse(useActive, 'release', 0);
			useActive = null;
			return;
		}
		if (uiPress) {
			scene.simulatePointerUp(aim.pick ?? uiPress, pointerInit(0, 0));
			uiPress = null;
			return;
		}
		if (holdMode === 'momentary') drop();
	}

	function onGrabKey(): void {
		if (radial) return;
		if (held()) drop();
		else if (!equipped() && aim.kind === 'grab') grabAimed('latched');
	}

	function onDropKey(): void {
		if (equipped()) unequipCarried();
		else drop();
	}

	// --- the wheel: bring closer, push away, scale, turn --------------------------------------------------------------

	/** Tells the other players where the held object is. A guest's mouse has no hand for them to track, so what it holds is told in full. */
	function reportHold(slotId: string): void {
		const node = sceneGraph.getLive(slotId)?.node;
		if (!node) return;
		network.onHold?.(HAND, slotId, node.getAbsolutePosition().asArray() as [number, number, number], node.absoluteRotationQuaternion.asArray() as [number, number, number, number]);
	}

	function onWheel(event: WheelEvent): void {
		const slotId = held();
		const raw = event.deltaY || event.deltaX; // Shift turns a vertical wheel into a horizontal one in some browsers
		if (!slotId || !raw) return;
		const notches = wheelNotches(event.deltaMode === 1 ? raw * LINE_PIXELS : raw);
		const live = sceneGraph.getLive(slotId);
		if (!live) return;
		const node = live.node;
		node.computeWorldMatrix(true);
		if (event.ctrlKey) {
			if (!isGrabbable(live.slot)?.scalable) return;
			const largest = Math.max(Math.abs(node.scaling.x), Math.abs(node.scaling.y), Math.abs(node.scaling.z));
			if (largest > 0) node.scaling.scaleInPlace(wheelScaledBy(largest, notches));
		} else if (event.shiftKey) {
			node.rotate(Axis.Y, ((WHEEL_TURN_DEGREES * Math.PI) / 180) * notches, Space.WORLD);
		} else {
			const forward = camera.getForwardRay().direction;
			const position = node.getAbsolutePosition().clone();
			const along = Vector3.Dot(position.subtract(camera.globalPosition), forward);
			const next = wheelPushedDistance(along, notches);
			node.setAbsolutePosition(position.add(forward.scale(next - along)));
			reportHold(slotId);
			// Pulled all the way in, an object that can be equipped goes into the hand, as if caught.
			if (notches < 0 && next <= PUSH_RANGE.min && isEquippable(live.slot) && grabSystem.getGrabbersForSlot(slotId).length === 1) {
				if (equipment.equip(player(), HAND, handNode, slotId)) {
					holdMode = 'none';
					network.onEquip?.(HAND, slotId);
				}
			}
		}
	}

	// --- the radial menu --------------------------------------------------------------------------------------------

	interface OpenRadial {
		items: RadialItem[];
		pointer: { x: number; y: number };
		hovered: number;
		sticky: boolean;
		openedAt: number;
		moved: boolean;
		/** The object the menu is about, if it is carried: the menu closes when it leaves the hand. */
		carriedSlotId: string | null;
	}
	let radial: OpenRadial | null = null;
	let inspectTarget: string | null = null;

	function openRadial(): void {
		if (radial) return;
		const carriedSlotId = carried();
		const slotId = carriedSlotId ?? aim.grabTarget;
		inspectTarget = carriedSlotId ?? aim.slotId;
		if (inspectTarget && !isWorldSlot(inspectTarget)) inspectTarget = null;
		let items = buildRadialItems(
			{ sceneGraph, grabSystem, equipment, localPlayerId: player, network: { ...options.radial, getInspectTarget: () => inspectTarget } },
			HAND,
			handNode,
			{ slotId, inspectTarget: options.radial.onInspect ? inspectTarget : null }
		);
		if (!slotId && !inspectTarget) items = options.globalItems();
		if (items.length === 0) return;
		radial = { items, pointer: { x: 0, y: 0 }, hovered: -1, sticky: false, openedAt: performance.now(), moved: false, carriedSlotId };
		fps.lookSuspended = true;
		syncRadial();
	}

	function syncRadial(): void {
		desktopHud.radial = radial
			? { items: radial.items.map((item) => ({ label: item.label, enabled: item.isEnabled() })), hovered: radial.hovered, pointer: { ...radial.pointer }, sticky: radial.sticky }
			: null;
	}

	function closeRadial(): void {
		radial = null;
		fps.lookSuspended = false;
		desktopHud.radial = null;
	}

	function commitRadial(): void {
		const current = radial;
		if (!current) return;
		const item = current.hovered >= 0 ? current.items[current.hovered] : undefined;
		closeRadial();
		if (!item?.isEnabled()) return;
		try {
			void Promise.resolve(item.onSelect()).catch((error) => console.warn('[desktop] a radial option failed', error));
		} catch (error) {
			console.warn('[desktop] a radial option failed', error);
		}
	}

	function onSecondaryDown(): void {
		if (radial?.sticky) closeRadial();
		else openRadial();
	}

	function onSecondaryUp(): void {
		if (!radial || radial.sticky) return;
		if (performance.now() - radial.openedAt < TAP_MS && !radial.moved) {
			radial.sticky = true;
			syncRadial();
		} else commitRadial();
	}

	function onMouseMove(event: MouseEvent): void {
		if (!radial || !fps.locked) return;
		radial.pointer = pieOffset(radial.pointer, event.movementX, event.movementY, PIE_PIXELS_PER_RADIUS);
		radial.hovered = pieIndexAt(radial.pointer.x, radial.pointer.y, radial.items.length, PIE_DEADZONE);
		if (radial.hovered >= 0) radial.moved = true;
		syncRadial();
	}

	// --- input plumbing ---------------------------------------------------------------------------------------------

	/** While the mouse is captured, the browser's pointer events are the hand's: Babylon (whose picking would use a stale cursor) must not see them. */
	function onPointerEvent(event: PointerEvent): void {
		if (!fps.locked) return;
		event.stopImmediatePropagation();
		if (!options.isActive() || (event.type !== 'pointerdown' && event.type !== 'pointerup')) return;
		if (event.type === 'pointerdown') {
			if (event.button === 0) onPrimaryDown();
			else if (event.button === 2) onSecondaryDown();
		} else if (event.button === 0) onPrimaryUp();
		else if (event.button === 2) onSecondaryUp();
	}

	function onWheelEvent(event: WheelEvent): void {
		if (!fps.locked) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		if (options.isActive() && !radial) onWheel(event);
	}

	const keyObserver = scene.onKeyboardObservable.add((info) => {
		if (info.type !== KeyboardEventTypes.KEYDOWN || info.event.repeat || !fps.locked || !options.isActive()) return;
		if (info.event.code === 'KeyE') onGrabKey();
		else if (info.event.code === 'KeyQ') onDropKey();
	});

	/** The mouse was taken away (Esc, a panel, another window): whatever the buttons were doing stops. */
	function releaseEverything(): void {
		closeRadial();
		if (useActive) {
			dispatchUse(useActive, 'release', 0);
			useActive = null;
		}
		if (uiPress) {
			scene.simulatePointerUp(uiPress, pointerInit(0, 0));
			uiPress = null;
		}
		if (holdMode === 'momentary') drop();
	}
	const lockObserver = fps.onLockChange.add((locked) => {
		if (!locked) releaseEverything();
	});

	const pointerEvents = ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'auxclick'] as const;
	for (const type of pointerEvents) window.addEventListener(type, onPointerEvent as EventListener, true);
	window.addEventListener('wheel', onWheelEvent, { capture: true, passive: false });
	window.addEventListener('mousemove', onMouseMove, true);

	// --- every frame ------------------------------------------------------------------------------------------------

	let lastHud = '';
	function setAim(kind: AimKind, label: string, holding: typeof desktopHud.holding): void {
		const signature = `${kind}|${label}|${holding ? `${holding.label}|${holding.equipped}|${holding.usable}` : ''}`;
		if (signature === lastHud) return;
		lastHud = signature;
		desktopHud.aim = { kind, label };
		desktopHud.holding = holding;
	}

	const frameObserver = scene.onBeforeRenderObservable.add(() => {
		if (!options.isActive() || !fps.locked) {
			aim = NO_AIM;
			if (uiHover) {
				uiHover = false;
				scene.simulatePointerMove(new PickingInfo(), pointerInit());
			}
			setAim('none', '', null);
			return;
		}
		const carriedSlotId = carried();
		aim = carriedSlotId && held() ? NO_AIM : computeAim();

		// Hover and drag over a panel, as a controller's laser does.
		if (aim.kind === 'ui' || uiPress || uiHover) {
			scene.simulatePointerMove(aim.pick ?? new PickingInfo(), pointerInit(0, uiPress ? 1 : 0));
			uiHover = aim.kind === 'ui';
		}

		if (radial) {
			if (radial.carriedSlotId && carried() !== radial.carriedSlotId) closeRadial();
			else syncRadial();
		}

		const heldSlotId = held();
		if (heldSlotId) reportHold(heldSlotId);

		const holding = carriedSlotId
			? { label: slotNameOf(carriedSlotId), equipped: equipped() === carriedSlotId, usable: equipment.hasTriggerAction(player(), HAND, carriedSlotId) }
			: null;
		const portal = worldPortalAt(aim.slotId);
		setAim(portal ? 'ui' : aim.kind, slotNameOf(aim.slotId), holding);
	});

	return {
		handNode,
		dispose() {
			releaseEverything();
			stopWatching();
			scene.onBeforeRenderObservable.remove(frameObserver);
			scene.onKeyboardObservable.remove(keyObserver);
			fps.onLockChange.remove(lockObserver);
			for (const type of pointerEvents) window.removeEventListener(type, onPointerEvent as EventListener, true);
			window.removeEventListener('wheel', onWheelEvent, true);
			window.removeEventListener('mousemove', onMouseMove, true);
			handNode.dispose();
		}
	};
}
