import type { AbstractMesh, Scene } from '@babylonjs/core';

/**
 * Everything a world builds is drawn for the first time in the first frame it can be seen: its vertex data and textures go to the GPU and
 * its shaders are put together, and on a headset that is a freeze of some hundreds of milliseconds. Meshes made while this is tracking
 * start hidden; `revealGradually` then shows them a few at a time (fewer when frames are slow, only those whose shaders are ready), so the work
 * is spread over many frames. Meant to run under a loading screen.
 */
export interface NewMeshes {
	meshes: AbstractMesh[];
	/** Stops tracking; what was made stays hidden until `revealAll` or `revealGradually`. */
	stop(): void;
	/** Shows everything that was held back, at once. */
	revealAll(): void;
}

export function holdNewMeshes(scene: Scene): NewMeshes {
	const meshes: AbstractMesh[] = [];
	const observer = scene.onNewMeshAddedObservable.add((mesh) => {
		mesh.isVisible = false;
		meshes.push(mesh);
	});
	return {
		meshes,
		stop: () => void scene.onNewMeshAddedObservable.remove(observer),
		revealAll: () => {
			scene.onNewMeshAddedObservable.remove(observer);
			for (const mesh of meshes) if (!mesh.isDisposed()) mesh.isVisible = true;
		}
	};
}

export interface RevealOptions {
	nextFrame: () => Promise<void>;
	/** Frame time (ms) over which fewer meshes are shown per frame. */
	slowFrameMs?: number;
	/** Past this, everything left is shown, ready or not. */
	timeoutMs?: number;
	/** Milliseconds a frame may spend asking whether meshes are ready. */
	budgetMs?: number;
	onProgress?: (revealed: number) => void;
}

export async function revealGradually(scene: Scene, held: NewMeshes, options: RevealOptions): Promise<void> {
	const { nextFrame, slowFrameMs = 28, timeoutMs = 8000, budgetMs = 3, onProgress } = options;
	const engine = scene.getEngine();
	const total = held.meshes.length;
	let pending = held.meshes.filter((mesh) => !mesh.isDisposed());
	const deadline = performance.now() + timeoutMs;
	let batch = 16;
	try {
		while (pending.length > 0 && performance.now() < deadline) {
			batch = engine.getDeltaTime() > slowFrameMs ? Math.max(4, batch >> 1) : Math.min(160, batch + 8);
			const started = performance.now();
			const still: AbstractMesh[] = [];
			let shown = 0;
			for (let i = 0; i < pending.length; i++) {
				const mesh = pending[i];
				if (mesh.isDisposed()) continue;
				if (shown >= batch || performance.now() - started > budgetMs) {
					still.push(mesh);
					continue;
				}
				if (mesh.isReady(true)) {
					mesh.isVisible = true;
					shown++;
				} else {
					still.push(mesh);
				}
			}
			pending = still;
			onProgress?.(total === 0 ? 1 : 1 - pending.length / total);
			if (pending.length > 0) await nextFrame();
		}
	} finally {
		held.revealAll();
	}
}
