<script lang="ts">
	import '@babylonjs/loaders/glTF';
	import { ArcRotateCamera, Color4, Engine, HemisphericLight, LoadAssetContainerAsync, Scene, Vector3 } from '@babylonjs/core';
	import { configureDraco } from '@kithin/engine/xr/draco';
	import { onMount } from 'svelte';

	interface Props {
		/** A binary glTF (.glb). */
		bytes: Uint8Array;
	}

	let { bytes }: Props = $props();

	let canvas: HTMLCanvasElement;
	let failed = $state(false);

	// Created once per file (the caller keys this component by asset id): an orbit view that turns by itself until it is dragged.
	onMount(() => {
		configureDraco();
		const engine = new Engine(canvas, true, { antialias: true });
		const scene = new Scene(engine);
		scene.clearColor = new Color4(0, 0, 0, 0);
		const camera = new ArcRotateCamera('view', Math.PI / 4, Math.PI / 3, 3, Vector3.Zero(), scene);
		camera.minZ = 0.01;
		camera.wheelPrecision = 40;
		camera.useAutoRotationBehavior = true;
		camera.attachControl(canvas, true);
		new HemisphericLight('light', new Vector3(0.3, 1, 0.5), scene).intensity = 1.1;

		let alive = true;
		void LoadAssetContainerAsync(bytes, scene, { pluginExtension: '.glb', name: 'preview' })
			.then((container) => {
				if (!alive) return;
				container.addAllToScene();
				const { min, max } = scene.getWorldExtends();
				const size = max.subtract(min);
				const radius = Math.max(size.x, size.y, size.z, 0.01);
				camera.setTarget(min.add(max).scale(0.5));
				camera.radius = radius * 1.8;
				camera.lowerRadiusLimit = radius * 0.4;
				camera.upperRadiusLimit = radius * 6;
				camera.wheelPrecision = 60 / radius;
			})
			.catch(() => { if (alive) failed = true; });

		engine.runRenderLoop(() => scene.render());
		const observer = new ResizeObserver(() => engine.resize());
		observer.observe(canvas);
		return () => {
			alive = false;
			observer.disconnect();
			engine.stopRenderLoop();
			scene.dispose();
			engine.dispose();
		};
	});
</script>

<canvas bind:this={canvas} aria-label="3D preview"></canvas>
{#if failed}<p class="failed muted">This model could not be previewed.</p>{/if}

<style>
	canvas { display: block; width: 100%; height: 100%; touch-action: none; outline: none; }
	.failed { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; }
</style>
