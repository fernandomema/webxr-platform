<script module lang="ts">
	import type { Pixels } from './panoramaProjection';

	// Decoded pictures are 2 MB each, so only the few in use are kept; the rest are decoded again from the (cached) blob when needed.
	const CACHE_SIZE = 6;
	const decoded = new Map<string, Promise<Pixels | null>>();

	function loadPixels(src: string): Promise<Pixels | null> {
		const known = decoded.get(src);
		if (known) {
			decoded.delete(src);
			decoded.set(src, known);
			return known;
		}
		const job = new Promise<Pixels | null>((resolve) => {
			const image = new Image();
			image.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = image.naturalWidth;
				canvas.height = image.naturalHeight;
				const context = canvas.getContext('2d', { willReadFrequently: true });
				if (!context) return resolve(null);
				context.drawImage(image, 0, 0);
				resolve({ width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data });
			};
			image.onerror = () => resolve(null);
			image.src = src;
		});
		decoded.set(src, job);
		if (decoded.size > CACHE_SIZE) decoded.delete(decoded.keys().next().value as string);
		return job;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { renderView } from './panoramaProjection';
	import { drawPanorama } from './panoramaGl';

	/**
	 * A world's 360° preview as a flat window into it, not the whole panorama squeezed into a rectangle. At rest it looks straight
	 * ahead; while the pointer is over the card (or its link) the view follows the pointer to look around.
	 */
	let { src, class: className = '' }: { src: string; class?: string } = $props();

	/** Used when a size cannot be measured, and as the largest size ever drawn (a big card on a dense screen). */
	const FALLBACK = { width: 384, height: 216 };
	const MAX_WIDTH = 1280;
	const HFOV = (100 * Math.PI) / 180;
	const YAW_RANGE = (140 * Math.PI) / 180;
	const PITCH_RANGE = (16 * Math.PI) / 180;

	let canvas: HTMLCanvasElement;
	let yaw = 0, pitch = 0, targetYaw = 0, targetPitch = 0;
	let hovering = false;
	let frame = 0;
	let alive = true;

	let width = FALLBACK.width, height = FALLBACK.height;

	/** On the GPU when WebGL2 is there; otherwise on the CPU, at a modest size so moving the view stays smooth. */
	async function paint(): Promise<boolean> {
		if (!alive || !canvas) return false;
		if (await drawPanorama(canvas, src, yaw, pitch, HFOV)) return true;
		const pixels = await loadPixels(src);
		if (!pixels || !alive) return false;
		const context = canvas.getContext('2d');
		if (!context) return false;
		const image = context.createImageData(canvas.width, canvas.height);
		renderView(pixels, image.data, canvas.width, canvas.height, yaw, pitch, HFOV);
		context.putImageData(image, 0, 0);
		return true;
	}

	function resize(): void {
		const scale = window.devicePixelRatio || 1;
		const box = canvas.getBoundingClientRect();
		const w = Math.min(MAX_WIDTH, Math.round(box.width * scale)) || FALLBACK.width;
		const h = Math.round(w * (box.height && box.width ? box.height / box.width : FALLBACK.height / FALLBACK.width));
		// The CPU path cannot afford a retina-sized frame while the view moves.
		const cpu = Math.min(w, FALLBACK.width);
		if (w === width) return;
		width = w; height = h;
		canvas.width = unavailableGpu() ? cpu : w;
		canvas.height = unavailableGpu() ? Math.round(cpu * h / w) : h;
		void paint();
	}

	function unavailableGpu(): boolean {
		return !document.createElement('canvas').getContext('webgl2');
	}

	function loop(): void {
		frame = 0;
		yaw += (targetYaw - yaw) * 0.14;
		pitch += (targetPitch - pitch) * 0.14;
		void paint().then((drawn) => {
			if (!drawn || !alive) return;
			const settled = Math.abs(targetYaw - yaw) < 0.002 && Math.abs(targetPitch - pitch) < 0.002;
			if (hovering || !settled) frame = requestAnimationFrame(loop);
		});
	}

	function wake(): void {
		if (!frame) frame = requestAnimationFrame(loop);
	}

	onMount(() => {
		const host = canvas.closest('a') ?? canvas;
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const onMove = (event: PointerEvent) => {
			const box = canvas.getBoundingClientRect();
			const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
			const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
			targetYaw = (x - 0.5) * 2 * YAW_RANGE;
			targetPitch = (0.5 - y) * 2 * PITCH_RANGE;
			hovering = true;
			wake();
		};
		const onLeave = () => {
			hovering = false;
			targetYaw = 0;
			targetPitch = 0;
			wake();
		};
		if (!reduced) {
			host.addEventListener('pointermove', onMove as EventListener);
			host.addEventListener('pointerleave', onLeave);
		}
		const observer = new ResizeObserver(resize);
		observer.observe(canvas);
		resize();
		void paint();
		return () => {
			alive = false;
			observer.disconnect();
			if (frame) cancelAnimationFrame(frame);
			host.removeEventListener('pointermove', onMove as EventListener);
			host.removeEventListener('pointerleave', onLeave);
		};
	});

	$effect(() => {
		void src;
		if (canvas) void paint();
	});
</script>

<canvas bind:this={canvas} width={FALLBACK.width} height={FALLBACK.height} class={className} aria-hidden="true"></canvas>
