<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		ArcRotateCamera,
		Color3,
		Color4,
		Engine,
		HemisphericLight,
		MeshBuilder,
		Scene,
		StandardMaterial,
		Vector3
	} from '@babylonjs/core';
	import { SceneGraph } from '$lib/xr/sceneGraph';
	import type { SlotTree } from '$lib/ecs/types';

	interface ScenePreviewProps {
		tree: SlotTree;
		selectedId?: string | null;
		onSelect?: (slotId: string) => void;
	}

	let { tree, onSelect = () => {} }: ScenePreviewProps = $props();

	let canvas: HTMLCanvasElement;
	let engine: Engine | null = null;
	let scene: Scene | null = null;
	let sceneGraph: SceneGraph | null = null;
	let ready = $state(false);

	onMount(() => {
		engine = new Engine(canvas, true);
		scene = new Scene(engine);
		scene.clearColor = new Color4(0.04, 0.05, 0.07, 1);

		// A real Babylon ArcRotateCamera — drag to rotate, scroll to zoom,
		// right-drag to pan, all built in via attachControl, rather than
		// hand-rolling camera math for a preview canvas.
		const camera = new ArcRotateCamera('studio-camera', -Math.PI / 2.3, Math.PI / 2.6, 3.2, new Vector3(0, 0.4, 0), scene);
		camera.lowerRadiusLimit = 0.2;
		camera.upperRadiusLimit = 50;
		camera.wheelDeltaPercentage = 0.02;
		camera.panningSensibility = 200;
		camera.attachControl(canvas, true);

		new HemisphericLight('studio-light', new Vector3(0.2, 1, 0.3), scene);

		const ground = MeshBuilder.CreateGround('studio-ground', { width: 12, height: 12, subdivisions: 12 }, scene);
		const groundMaterial = new StandardMaterial('studio-ground-mat', scene);
		groundMaterial.diffuseColor = new Color3(0.1, 0.11, 0.15);
		groundMaterial.specularColor = Color3.Black();
		ground.material = groundMaterial;
		ground.isPickable = false;

		sceneGraph = new SceneGraph(scene);

		// A plain click (not a camera-drag) picks whatever mesh is under the
		// pointer and reports its slot id. Tracked by hand (down position +
		// elapsed time) rather than relying on Babylon's own POINTERTAP,
		// which in testing didn't fire reliably for this canvas.
		let pointerDownAt: { x: number; y: number; time: number } | null = null;
		canvas.addEventListener('pointerdown', (event) => {
			pointerDownAt = { x: event.clientX, y: event.clientY, time: performance.now() };
		});
		canvas.addEventListener('pointerup', (event) => {
			if (!pointerDownAt || !scene || !sceneGraph) return;
			const dx = event.clientX - pointerDownAt.x;
			const dy = event.clientY - pointerDownAt.y;
			const elapsed = performance.now() - pointerDownAt.time;
			pointerDownAt = null;
			// A real drag-to-orbit moves several pixels or takes a while — only
			// treat a short, near-stationary press/release as a selection tap.
			if (Math.hypot(dx, dy) > 6 || elapsed > 500) return;
			const pickResult = scene.pick(scene.pointerX, scene.pointerY);
			const pickedMesh = pickResult?.pickedMesh;
			if (!pickedMesh) return;
			const slotId = sceneGraph.getSlotIdForNode(pickedMesh);
			if (slotId) onSelect(slotId);
		});

		engine.runRenderLoop(() => {
			if (!engine || !scene) return;
			const dt = engine.getDeltaTime() / 1000;
			sceneGraph?.tick(dt);
			scene.render();
		});

		const onResize = () => engine?.resize();
		window.addEventListener('resize', onResize);
		ready = true;

		return () => window.removeEventListener('resize', onResize);
	});

	// Rebuilds the preview's live objects from scratch whenever the edited
	// asset's tree changes — simplest correct way to keep it in sync with
	// Studio's edits, and cheap enough for the asset sizes Studio deals with.
	$effect(() => {
		if (!ready || !sceneGraph) return;
		const currentTree = tree;
		sceneGraph.dispose();
		sceneGraph.load(currentTree);
	});

	onDestroy(() => {
		sceneGraph?.dispose();
		scene?.dispose();
		engine?.dispose();
	});
</script>

<canvas bind:this={canvas} aria-label="3D asset preview"></canvas>

<style>
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		outline: none;
		touch-action: none;
	}
</style>
