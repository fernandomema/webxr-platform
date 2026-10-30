import { SceneInstrumentation, type Scene } from '@babylonjs/core';
import type { ScriptSessionInfo, ScriptSystem, ScriptSystemStats } from '../scriptDash.ts';

/**
 * What the game tells the scripts of the player's menu about itself. The timers that measure a frame are only switched on once a
 * script asks for them, so a menu without a frame-rate readout costs nothing.
 */
export function createScriptSystem(scene: Scene, session: () => ScriptSessionInfo): ScriptSystem & { dispose(): void } {
	let instrumentation: SceneInstrumentation | null = null;
	return {
		stats(): ScriptSystemStats {
			if (!instrumentation) {
				instrumentation = new SceneInstrumentation(scene);
				instrumentation.captureFrameTime = true;
			}
			return {
				fps: Math.round(scene.getEngine().getFps()),
				frameMs: Math.round(instrumentation.frameTimeCounter.lastSecAverage * 10) / 10,
				drawCalls: Math.round(instrumentation.drawCallsCounter.lastSecAverage),
				meshes: scene.getActiveMeshes().length,
				kilotriangles: Math.round(scene.getActiveIndices() / 300) / 10
			};
		},
		session,
		dispose() {
			instrumentation?.dispose();
			instrumentation = null;
		}
	};
}
