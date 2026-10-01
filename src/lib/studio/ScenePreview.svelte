<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import {
		AbstractMesh,
		Axis,
		FreeCamera,
		Color3,
		Color4,
		Engine,
		HemisphericLight,
		MeshBuilder,
		Quaternion,
		Scene,
		StandardMaterial,
		TransformNode,
		Vector3
	} from '@babylonjs/core';
	import { SceneGraph } from '$lib/xr/sceneGraph';
	import { bakeReflectionProbe, type ProbeFaces } from '$lib/xr/bakeReflectionProbe';
	import { BlobAssetLibrary } from '$lib/xr/blobAssetLibrary';
	import { ModelLibrary } from '$lib/xr/modelLibrary';
	import { CloudResolver } from '$lib/assets/cloud';
	import type { SlotTree } from '$lib/ecs/types';
	import { cloneTree } from './tree/ops';
	import { eulerToQuat } from '$lib/math/euler';
	import { handPreview } from './state/handPreview.svelte';
	import { DEFAULT_PREVIEW_FOV_DEG, lookRotation } from '../xr/thumbnail/cameraPose';
	import { EDITOR_ONLY, PreviewCameraHelper, type GizmoMode } from './previewCameraHelper';
	import { DropZoneHelper, type ZoneGizmoMode } from './dropZoneHelper';
	import { INSET_MARGIN, insetPixels } from './previewCameraGeometry';
	import { createStudioHand, type StudioHand } from './studioHand';
	import { defaultHandModel, holdingBends, solveGraspFull } from '../xr/avatar/grasp';
	import { graspObstacles } from '../xr/avatar/graspShapes';

	interface ScenePreviewProps {
		tree: SlotTree;
		selectedId?: string | null;
		onSelect?: (slotId: string) => void;
		/** `world` if the project is a world: its Preview cameras take a 360° picture, drawn here as a wide view. */
		cameraKind?: 'object' | 'world';
		/** A Preview camera was moved or turned with the handles; these are its new local position and rotation. */
		onMoveSlot?: (slotId: string, position: [number, number, number], rotation: [number, number, number, number]) => void;
		/** A Drop zone was moved, turned or resized with the handles; these are its new local position, rotation and scale. */
		onTransformSlot?: (slotId: string, position: [number, number, number], rotation: [number, number, number, number], scale: [number, number, number]) => void;
	}

	let { tree, selectedId = null, onSelect = () => {}, cameraKind = 'object', onMoveSlot = () => {}, onTransformSlot = () => {} }: ScenePreviewProps = $props();

	let canvas: HTMLCanvasElement;
	let engine: Engine | null = null;
	let scene: Scene | null = null;
	let camera: FreeCamera | null = null;
	let sceneGraph: SceneGraph | null = null;
	let models: ModelLibrary | null = null;
	let mediaAssets: BlobAssetLibrary | null = null;
	const cloudResolver = new CloudResolver();
	let ready = $state(false);
	/** Bumped whenever the live scene is rebuilt, so the selection highlight is re-applied. */
	let rebuilds = $state(0);

	let highlighted: AbstractMesh | null = null;
	let cameraHelper: PreviewCameraHelper | null = null;
	let zoneHelper: DropZoneHelper | null = null;
	let zoneMode = $state<ZoneGizmoMode>('move');
	/** A Drop zone is selected: its handles are showing. */
	let zoneSelected = $state(false);
	let gizmoMode = $state<GizmoMode>('move');
	/** A Preview camera is selected: its handles and its live view are showing. */
	let cameraSelected = $state(false);
	let viewSize = $state({ width: 0, height: 0 });
	/** Stand-in for a controller grip, shown while adjusting an equippable object's hand pose. */
	let handNode: TransformNode | null = null;
	/** The simulated hands worn on that grip: only the one being previewed shows. */
	let hands: Record<'left' | 'right', StudioHand> | null = null;
	let previewingHand: string | null = null;
	let knownIds = new Set<string>();
	let knownSignatures = new Map<string, string>();
	let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
	const movementKeys = new Set<string>();

	/** Where the editor camera is in the world and which way it looks, as a slot pose (a slot looks along its +Z). */
	export function getViewPose(): { position: [number, number, number]; rotation: [number, number, number, number] } | null {
		if (!camera) return null;
		const forward = camera.getDirection(Axis.Z).normalize();
		return { position: camera.position.asArray() as [number, number, number], rotation: lookRotation(forward.asArray() as [number, number, number]) };
	}

	/** Captures a slot's surroundings and imports the six faces as image assets. */
	export async function bakeProbe(slotId: string): Promise<ProbeFaces> {
		if (!scene || !sceneGraph) throw new Error('Scene preview is not ready.');
		if (sceneGraph.allSlots().some((entry) => entry.assetState && entry.assetState !== 'ready')) throw new Error('Wait for the models to finish loading before capturing.');
		const live = sceneGraph.getLive(slotId);
		if (!live) throw new Error('The selected object is not in the preview.');
		return bakeReflectionProbe(scene, live.node.getAbsolutePosition(), live.slot.name || 'Reflection probe');
	}

	/** Moves the camera to look at the selected slot. */
	export function focusSelected(): void {
		const node = selectedId ? sceneGraph?.getLive(selectedId)?.node : null;
		if (node && camera) camera.setTarget(node.getAbsolutePosition().clone());
	}

	onMount(() => {
		engine = new Engine(canvas, true, { audioEngine: true });
		scene = new Scene(engine);
		scene.clearColor = new Color4(0.04, 0.05, 0.07, 1);

		camera = new FreeCamera('studio-camera', new Vector3(2.3, 2.7, -5.5), scene);
		camera.setTarget(new Vector3(0, 0.6, 0));
		camera.inputs.removeByType('FreeCameraKeyboardMoveInput');
		camera.attachControl(canvas, true);
		const mouseInput = camera.inputs.attached.mouse;
		if (mouseInput) mouseInput.buttons = [2];
		const onKeyDown = (event: KeyboardEvent) => {
			const key = event.key.toLowerCase();
			if (!['w', 'a', 's', 'd', 'shift'].includes(key)) return;
			movementKeys.add(key);
			if (key !== 'shift') event.preventDefault();
		};
		const onKeyUp = (event: KeyboardEvent) => movementKeys.delete(event.key.toLowerCase());
		const onWindowBlur = () => movementKeys.clear();
		canvas.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('blur', onWindowBlur);

		new HemisphericLight('studio-light', new Vector3(0.2, 1, 0.3), scene);

		const ground = MeshBuilder.CreateGround('studio-ground', { width: 40, height: 40, subdivisions: 40 }, scene);
		const groundMaterial = new StandardMaterial('studio-ground-mat', scene);
		groundMaterial.diffuseColor = new Color3(0.08, 0.09, 0.12);
		groundMaterial.specularColor = Color3.Black();
		groundMaterial.wireframe = true;
		ground.material = groundMaterial;
		ground.isPickable = false;
		ground.layerMask = EDITOR_ONLY; // the grid is for the editor; the live camera view shows only the scene

		const boxes = scene.getBoundingBoxRenderer();
		boxes.frontColor = new Color3(0.49, 0.42, 0.96);
		boxes.backColor = new Color3(0.49, 0.42, 0.96);

		models = new ModelLibrary(scene, { getResolvers: () => [cloudResolver] });
		mediaAssets = new BlobAssetLibrary({ getResolvers: () => [cloudResolver] });
		sceneGraph = new SceneGraph(scene, { models, mediaAssets, getViewerPosition: () => camera?.position ?? null });
		cameraHelper = new PreviewCameraHelper(scene, canvas, camera, {
			getNode: (slotId) => sceneGraph?.getLive(slotId)?.node,
			onMoved: (slotId, position, rotation) => onMoveSlot(slotId, position, rotation)
		});

		zoneHelper = new DropZoneHelper(scene, canvas, camera, {
			getNode: (slotId) => sceneGraph?.getLive(slotId)?.node,
			onChanged: (slotId, position, rotation, scale) => onTransformSlot(slotId, position, rotation, scale)
		});

		handNode = new TransformNode('studio-hand', scene);
		handNode.position = new Vector3(0, 1.2, 0);
		const handleMaterial = new StandardMaterial('studio-hand-mat', scene);
		handleMaterial.diffuseColor = new Color3(0.35, 0.37, 0.45);
		const handle = MeshBuilder.CreateCylinder('studio-hand-handle', { height: 0.14, diameter: 0.035 }, scene);
		handle.rotation.x = Math.PI / 2;
		handle.parent = handNode;
		handle.material = handleMaterial;
		handle.isPickable = false;
		const ring = MeshBuilder.CreateTorus('studio-hand-ring', { diameter: 0.09, thickness: 0.012 }, scene);
		ring.position.z = 0.08;
		ring.rotation.x = Math.PI / 2;
		ring.parent = handNode;
		ring.material = handleMaterial;
		ring.isPickable = false;
		hands = { left: createStudioHand(scene, 'left', handNode), right: createStudioHand(scene, 'right', handNode) };
		for (const hand of Object.values(hands)) {
			hand.setBends(holdingBends());
			hand.setVisible(false);
		}
		handNode.setEnabled(false);

		// A plain click (not a camera drag) picks whatever mesh is under the pointer.
		let pointerDownAt: { x: number; y: number; time: number } | null = null;
		const onPointerDown = (event: PointerEvent) => {
			canvas.focus({ preventScroll: true });
			pointerDownAt = { x: event.clientX, y: event.clientY, time: performance.now() };
			if (event.button === 0) {
				panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
				canvas.setPointerCapture(event.pointerId);
			}
		};
		let panPointer: { id: number; x: number; y: number } | null = null;
		const onPanPointerMove = (event: PointerEvent) => {
			if (!panPointer || panPointer.id !== event.pointerId || !camera) return;
			const dx = event.clientX - panPointer.x;
			const dy = event.clientY - panPointer.y;
			panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
			// Dragging a handle is not dragging the view.
			if (cameraHelper?.isDragging() || zoneHelper?.isDragging()) return;
			const right = camera.getDirection(Axis.X);
			const up = camera.getDirection(Axis.Y);
			camera.position.addInPlace(right.scale(-dx * 0.004)).addInPlace(up.scale(dy * 0.004));
		};
		const onPanPointerUp = (event: PointerEvent) => {
			if (panPointer?.id === event.pointerId) panPointer = null;
		};
		const onPointerUp = (event: PointerEvent) => {
			if (!pointerDownAt) return;
			const moved = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y);
			const elapsed = performance.now() - pointerDownAt.time;
			pointerDownAt = null;
			if (event.button !== 0 || !scene || !sceneGraph) return;
			if (moved > 6 || elapsed > 500 || cameraHelper?.recentlyDragged() || zoneHelper?.recentlyDragged()) return;
			const slotId = sceneGraph.getSlotIdForNode(scene.pick(scene.pointerX, scene.pointerY)?.pickedMesh);
			if (slotId) onSelect(slotId);
		};
		canvas.addEventListener('pointerdown', onPointerDown);
		canvas.addEventListener('pointermove', onPanPointerMove);
		canvas.addEventListener('pointerup', onPanPointerUp);
		canvas.addEventListener('pointerup', onPointerUp);

		engine.runRenderLoop(() => {
			if (!engine || !scene) return;
			const delta = Math.min(engine.getDeltaTime() / 1000, 0.05);
			if (camera && movementKeys.size) {
				const forward = camera.getDirection(Axis.Z).normalize();
				const right = camera.getDirection(Axis.X).normalize();
				const direction = Vector3.Zero();
				if (movementKeys.has('w')) direction.addInPlace(forward);
				if (movementKeys.has('s')) direction.subtractInPlace(forward);
				if (movementKeys.has('d')) direction.addInPlace(right);
				if (movementKeys.has('a')) direction.subtractInPlace(right);
				if (direction.lengthSquared() > 0) {
					direction.normalize().scaleInPlace((movementKeys.has('shift') ? 12 : 4) * delta);
					camera.position.addInPlace(direction);
				}
			}
			sceneGraph?.tick(delta);
			scene.render();
		});

		const observer = new ResizeObserver(() => {
			engine?.resize();
			viewSize = { width: canvas.clientWidth, height: canvas.clientHeight };
		});
		observer.observe(canvas);
		ready = true;

		return () => {
			observer.disconnect();
			canvas.removeEventListener('pointerdown', onPointerDown);
			canvas.removeEventListener('pointermove', onPanPointerMove);
			canvas.removeEventListener('pointerup', onPanPointerUp);
			canvas.removeEventListener('pointerup', onPointerUp);
			canvas.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onWindowBlur);
			movementKeys.clear();
		};
	});

	function signatures(slots: SlotTree): Map<string, string> {
		// Hand poses are applied live, so editing them must not rebuild the scene.
		return new Map(slots.map((slot) => [slot.id, JSON.stringify(slot.components.filter((component) => component.type !== 'equippable'))]));
	}

	function rebuild(slots: SlotTree) {
		if (!sceneGraph) return;
		sceneGraph.dispose();
		// The live graph mutates the slots it owns (code blocks, grabs), so it gets a copy.
		sceneGraph.load(cloneTree(slots));
		rebuilds++;
	}

	// Transform, rename and reparent edits are applied in place with reconcile();
	// only a real component or membership change rebuilds the live scene (which
	// restarts code blocks), and that is debounced so typing doesn't thrash it.
	$effect(() => {
		if (!ready || !sceneGraph) return;
		const slots = tree;
		untrack(() => {
			const nextSignatures = signatures(slots);
			const structural =
				nextSignatures.size !== knownIds.size ||
				[...nextSignatures].some(([id, signature]) => knownSignatures.get(id) !== signature);
			knownIds = new Set(nextSignatures.keys());
			knownSignatures = nextSignatures;
			clearTimeout(rebuildTimer);
			if (structural) rebuildTimer = setTimeout(() => rebuild(slots), 120);
			else sceneGraph?.reconcile(cloneTree(slots));
		});
	});

	$effect(() => {
		void rebuilds;
		const id = selectedId;
		if (!ready || !sceneGraph) return;
		if (highlighted) highlighted.showBoundingBox = false;
		highlighted = null;
		const node = id ? sceneGraph.getLive(id)?.node : null;
		// A model's root is an empty mesh; its invisible box proxy is what outlines the selection.
		const target = (node?.metadata?.selectionMesh as AbstractMesh | undefined) ?? node;
		if (target instanceof AbstractMesh) {
			target.showBoundingBox = true;
			highlighted = target;
		}
	});

	// Preview cameras: their frustums, the handles and live view of the selected one.
	$effect(() => {
		void rebuilds;
		const slots = tree;
		const id = selectedId;
		const mode = gizmoMode;
		const kind = cameraKind;
		if (!ready || !cameraHelper) return;
		const cameras = slots.flatMap((slot) => {
			const component = slot.components.find((candidate) => candidate.type === 'previewCamera');
			return component && component.type === 'previewCamera' ? [{ id: slot.id, fov: kind === 'world' ? 90 : (component.fov ?? DEFAULT_PREVIEW_FOV_DEG) }] : [];
		});
		cameraHelper.setMode(mode);
		cameraHelper.update(cameras, id);
		cameraSelected = cameras.some((camera) => camera.id === id);
	});

	// Drop zones: their boxes, and the handles of the selected one.
	$effect(() => {
		void rebuilds;
		const slots = tree;
		const id = selectedId;
		const mode = zoneMode;
		if (!ready || !zoneHelper) return;
		const zones = slots.filter((slot) => slot.components.some((component) => component.type === 'dropZone')).map((slot) => slot.id);
		zoneHelper.setMode(mode);
		zoneHelper.update(zones, id);
		zoneSelected = id !== null && zones.includes(id);
	});

	// Shows the selected equippable object in a stand-in controller, using the pose being edited.
	$effect(() => {
		void rebuilds;
		const hand = handPreview.hand;
		const id = selectedId;
		const slots = tree;
		if (!ready || !sceneGraph || !handNode) return;
		const live = id ? sceneGraph.getLive(id) : undefined;
		const equippable = slots.find((slot) => slot.id === id)?.components.find((component) => component.type === 'equippable');
		if (hand && live && equippable) {
			const pose = equippable[hand];
			live.node.setParent(handNode);
			live.node.position = Vector3.FromArray(pose.position);
			live.node.rotationQuaternion = Quaternion.FromArray(eulerToQuat(pose.rotation));
			if (previewingHand !== `${id}:${hand}` && camera) {
				camera.position.copyFrom(handNode.absolutePosition.subtract(camera.getDirection(Axis.Z).scale(1.2)));
				camera.setTarget(handNode.absolutePosition.clone());
			}
			handNode.setEnabled(true);
			previewingHand = `${id}:${hand}`;
			// The simulated hand: closed round the object when Auto grip is on, and just holding otherwise.
			if (hands) {
				hands.left.setVisible(hand === 'left');
				hands.right.setVisible(hand === 'right');
				const active = hands[hand];
				handNode.computeWorldMatrix(true);
				active.frame.computeWorldMatrix(true);
				const obstacles = equippable.autoGrip ? graspObstacles(sceneGraph, id!, active.frame.getWorldMatrix()) : [];
				const grasp = solveGraspFull(defaultHandModel(hand), obstacles, holdingBends());
				active.setBends(grasp.bends, grasp.thumbSwing);
			}
		} else {
			handNode.setEnabled(false);
			if (previewingHand) {
				previewingHand = null;
				sceneGraph.reconcile(cloneTree(slots));
			}
		}
	});

	onDestroy(() => {
		clearTimeout(rebuildTimer);
		cameraHelper?.dispose();
		zoneHelper?.dispose();
		for (const hand of Object.values(hands ?? {})) hand.dispose();
		sceneGraph?.dispose();
		models?.dispose();
		mediaAssets?.dispose();
		scene?.dispose();
		engine?.dispose();
	});
</script>

<div class="viewport">
	<canvas bind:this={canvas} tabindex="0" aria-label="3D preview. Use WASD to move, Shift to move faster, left-drag to pan, right-drag to look, scroll to move forward or backward."></canvas>
	{#if zoneSelected}
		<div class="camera-tools" role="toolbar" aria-label="Drop zone handles">
			<button class="btn sm" aria-pressed={zoneMode === 'move'} onclick={() => (zoneMode = 'move')}>Move</button>
			<button class="btn sm" aria-pressed={zoneMode === 'rotate'} onclick={() => (zoneMode = 'rotate')}>Rotate</button>
			<button class="btn sm" aria-pressed={zoneMode === 'scale'} onclick={() => (zoneMode = 'scale')}>Scale</button>
		</div>
	{/if}
	{#if cameraSelected}
		<div class="camera-tools" role="toolbar" aria-label="Preview camera handles">
			<button class="btn sm" aria-pressed={gizmoMode === 'move'} onclick={() => (gizmoMode = 'move')}>Move</button>
			<button class="btn sm" aria-pressed={gizmoMode === 'rotate'} onclick={() => (gizmoMode = 'rotate')}>Rotate</button>
		</div>
		{@const side = insetPixels(viewSize.width || 600, viewSize.height || 400)}
		<div class="live-frame" style="width:{side}px;height:{side}px;right:{INSET_MARGIN}px;bottom:{INSET_MARGIN}px" aria-hidden="true">
			<span>Camera view</span>
		</div>
	{/if}
</div>

<style>
	.viewport { position: relative; width: 100%; height: 100%; }
	.camera-tools { position: absolute; top: 10px; left: 10px; display: flex; gap: 4px; padding: 4px; border-radius: 10px; background: color-mix(in srgb, var(--panel, #12141b) 88%, transparent); border: 1px solid var(--border, #2a2f3d); }
	.camera-tools :global(.btn[aria-pressed='true']) { border-color: var(--accent, #7c6cf6); background: var(--accent-soft, rgb(124 108 246 / 0.18)); }
	.live-frame { position: absolute; pointer-events: none; box-sizing: border-box; border: 2px solid #38bdf8; border-radius: 4px; }
	.live-frame span { position: absolute; top: 4px; left: 6px; font-size: 11px; color: #bae6fd; text-shadow: 0 1px 2px #000; }
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		outline: none;
		touch-action: none;
	}
</style>
