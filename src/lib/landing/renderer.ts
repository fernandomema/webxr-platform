import * as THREE from 'three';

export type SceneTask = {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	visible: boolean;
	update: (time: number, pointer: { x: number; y: number }) => void;
	pointer: { x: number; y: number };
};

let renderer: THREE.WebGLRenderer | undefined;
const tasks = new Set<SceneTask>();
let frame = 0;
let maxWidth = 1280;
let maxHeight = 900;

function getRenderer() {
	if (renderer) return renderer;
	try {
		const canvas = document.createElement('canvas');
		canvas.width = maxWidth;
		canvas.height = maxHeight;
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.15;
		renderer.setSize(maxWidth, maxHeight, false);
	} catch {
		return undefined;
	}
	return renderer;
}

function tick(now: number) {
	const gl = getRenderer();
	if (gl) {
		for (const task of tasks) {
			if (!task.visible) continue;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const rect = task.canvas.getBoundingClientRect();
			const width = Math.max(1, Math.round(rect.width * dpr));
			const height = Math.max(1, Math.round(rect.height * dpr));
			if (task.canvas.width !== width || task.canvas.height !== height) {
				task.canvas.width = width;
				task.canvas.height = height;
			}
			if (width > maxWidth || height > maxHeight) {
				maxWidth = Math.max(maxWidth, width);
				maxHeight = Math.max(maxHeight, height);
				gl.setSize(maxWidth, maxHeight, false);
			}
			const aspect = width / height;
			if (Math.abs(task.camera.aspect - aspect) > 0.001) {
				task.camera.aspect = aspect;
				task.camera.updateProjectionMatrix();
			}
			gl.setViewport(0, maxHeight - height, width, height);
			gl.setScissor(0, maxHeight - height, width, height);
			gl.setScissorTest(true);
			task.update(now / 1000, task.pointer);
			gl.setClearColor(0x000000, 0);
			gl.clear();
			gl.render(task.scene, task.camera);
			task.ctx.clearRect(0, 0, width, height);
			// The viewport is specified in WebGL's bottom-left coordinate space,
			// but drawImage reads the backing canvas from its top edge.
			task.ctx.drawImage(gl.domElement, 0, 0, width, height, 0, 0, width, height);
		}
	}
	if (tasks.size) frame = requestAnimationFrame(tick);
	else frame = 0;
}

export function registerScene(task: SceneTask) {
	tasks.add(task);
	if (!frame) frame = requestAnimationFrame(tick);
	return () => {
		tasks.delete(task);
		if (!tasks.size && frame) {
			cancelAnimationFrame(frame);
			frame = 0;
		}
	};
}
