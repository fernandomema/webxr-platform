<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import {
		AbstractMesh,
		ArcRotateCamera,
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
	import { BlobAssetLibrary } from '$lib/xr/blobAssetLibrary';
	import { ModelLibrary } from '$lib/xr/modelLibrary';
	import { CloudResolver } from '$lib/assets/cloud';
	import type { SlotTree } from '$lib/ecs/types';
	import { cloneTree } from './tree/ops';
	import { eulerToQuat } from '$lib/math/euler';
	import { handPreview } from './state/handPreview.svelte';

	interface ScenePreviewProps {
		tree: SlotTree;
		selectedId?: string | null;
		onSelect?: (slotId: string) => void;
	}

	let { tree, selectedId = null, onSelect = () => {} }: ScenePreviewProps = $props();

	let canvas: HTMLCanvasElement;
	let engine: Engine | null = null;
	let scene: Scene | null = null;
	let camera: ArcRotateCamera | null = null;
	let sceneGraph: SceneGraph | null = null;
	let models: ModelLibrary | null = null;
	let mediaAssets: BlobAssetLibrary | null = null;
	const cloudResolver = new CloudResolver();
	let ready = $state(false);
	/** Bumped whenever the live scene is rebuilt, so the selection highlight is re-applied. */
	let rebuilds = $state(0);

	let highlighted: AbstractMesh | null = null;
	/** Stand-in for a controller grip, shown while adjusting an equippable object's hand pose. */
	let handNode: TransformNode | null = null;
	let previewingHand: string | null = null;
	let knownIds = new Set<string>();
	let knownSignatures = new Map<string, string>();
	let rebuildTimer: ReturnType<typeof setTimeout> | undefined;

	/** Moves the camera to look at the selected slot. */
	export function focusSelected(): void {
		const node = selectedId ? sceneGraph?.getLive(selectedId)?.node : null;
		if (node && camera) camera.setTarget(node.getAbsolutePosition().clone());
	}

	onMount(() => {
		engine = new Engine(canvas, true, { audioEngine: true });
		scene = new Scene(engine);
		scene.clearColor = new Color4(0.04, 0.05, 0.07, 1);

		camera = new ArcRotateCamera('studio-camera', -Math.PI / 2.3, Math.PI / 2.6, 6, new Vector3(0, 0.6, 0), scene);
		camera.lowerRadiusLimit = 0.2;
		camera.upperRadiusLimit = 80;
		camera.wheelDeltaPercentage = 0.02;
		camera.panningSensibility = 200;
		camera.attachControl(canvas, true);

		new HemisphericLight('studio-light', new Vector3(0.2, 1, 0.3), scene);

		const ground = MeshBuilder.CreateGround('studio-ground', { width: 40, height: 40, subdivisions: 40 }, scene);
		const groundMaterial = new StandardMaterial('studio-ground-mat', scene);
		groundMaterial.diffuseColor = new Color3(0.08, 0.09, 0.12);
		groundMaterial.specularColor = Color3.Black();
		groundMaterial.wireframe = true;
		ground.material = groundMaterial;
		ground.isPickable = false;

		const boxes = scene.getBoundingBoxRenderer();
		boxes.frontColor = new Color3(0.49, 0.42, 0.96);
		boxes.backColor = new Color3(0.49, 0.42, 0.96);

		models = new ModelLibrary(scene, { getResolvers: () => [cloudResolver] });
		mediaAssets = new BlobAssetLibrary({ getResolvers: () => [cloudResolver] });
		sceneGraph = new SceneGraph(scene, { models, mediaAssets, getViewerPosition: () => camera?.position ?? null });

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
		handNode.setEnabled(false);

		// A plain click (not a camera drag) picks whatever mesh is under the pointer.
		let pointerDownAt: { x: number; y: number; time: number } | null = null;
		const onPointerDown = (event: PointerEvent) => {
			pointerDownAt = { x: event.clientX, y: event.clientY, time: performance.now() };
		};
		const onPointerUp = (event: PointerEvent) => {
			if (!pointerDownAt || !scene || !sceneGraph) return;
			const moved = Math.hypot(event.clientX - pointerDownAt.x, event.clientY - pointerDownAt.y);
			const elapsed = performance.now() - pointerDownAt.time;
			pointerDownAt = null;
			if (moved > 6 || elapsed > 500) return;
			const slotId = sceneGraph.getSlotIdForNode(scene.pick(scene.pointerX, scene.pointerY)?.pickedMesh);
			if (slotId) onSelect(slotId);
		};
		canvas.addEventListener('pointerdown', onPointerDown);
		canvas.addEventListener('pointerup', onPointerUp);

		engine.runRenderLoop(() => {
			if (!engine || !scene) return;
			sceneGraph?.tick(engine.getDeltaTime() / 1000);
			scene.render();
		});

		const observer = new ResizeObserver(() => engine?.resize());
		observer.observe(canvas);
		ready = true;

		return () => {
			observer.disconnect();
			canvas.removeEventListener('pointerdown', onPointerDown);
			canvas.removeEventListener('pointerup', onPointerUp);
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
				camera.setTarget(handNode.absolutePosition.clone());
				camera.radius = Math.min(camera.radius, 1.2);
			}
			handNode.setEnabled(true);
			previewingHand = `${id}:${hand}`;
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
		sceneGraph?.dispose();
		models?.dispose();
		mediaAssets?.dispose();
		scene?.dispose();
		engine?.dispose();
	});
</script>

<canvas bind:this={canvas} aria-label="3D preview. Drag to orbit, scroll to zoom, right-drag to pan."></canvas>

<style>
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		outline: none;
		touch-action: none;
	}
</style>
