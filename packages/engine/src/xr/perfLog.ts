import { EngineInstrumentation, SceneInstrumentation, type Observable, type Scene } from '@babylonjs/core';
import { activeExperiments } from './experiments.ts';
import { xrSettings } from './settings.ts';

/**
 * Measures how the scene runs and sends it, every few seconds, to the dev server (`/api/debug/perf`), which keeps it in `logs/perf.log`. Each sample
 * covers one stretch in which nothing changed: the world, the way it is viewed (screen or headset) and the experiments that are on (see experiments.ts)
 * are written next to the numbers, and the stretch ends and a new one starts when any of them changes. Playing with the experiments therefore fills the
 * log with comparable samples by itself. The performance settings (script rate, foveation, multiview, refresh rate) count as part of the configuration too.
 *
 * Besides the frame times it records where the time goes: each script and step of the scene graph's tick (`SceneGraph.scriptProfile`), each callback
 * run before and after every frame (`profileRenderObservers`, named `@before|@after file:line` after where it was added), Babylon's own split of the frame
 * (choosing what to draw, render targets such as mirrors, drawing), the GPU's time where the browser can measure it, long tasks, and what the scene holds.
 * Dev builds only.
 */
export interface PerfContext {
	world: string | null;
	mode: 'desktop' | 'xr';
}

export interface PerfSample {
	type: 'sample';
	session: string;
	at: string;
	world: string | null;
	mode: PerfContext['mode'];
	experiments: string[];
	/** The performance settings in force (see `performanceSettings`). */
	settings: Record<string, string | number | boolean | null>;
	seconds: number;
	frames: number;
	fps: number;
	frameMsMean: number;
	frameMsP95: number;
	frameMsMax: number;
	/** Frames that took over 50 ms. */
	hitches: number;
	/** Time the scene graph's tick (scripts and the like) took per frame, in ms. */
	tickMsMean: number;
	cpuFrameMs: number;
	/** The costliest scripts (by slot id), steps of the scene graph's tick (`#name`), frame callbacks (`@before|@after file:line`) and sections of engine code (`area:name`, see profiler.ts), with their mean ms per frame. */
	topScripts: Array<{ id: string; ms: number }>;
	/** Babylon's split of a frame, in mean ms: working out which meshes are in view, drawing render targets (mirrors, probes), drawing it all, and between frames. */
	activeMeshesMs: number;
	renderTargetsMs: number;
	renderMs: number;
	interFrameMs: number;
	/** The GPU's time per frame, where the browser can measure it (0 when not). */
	gpuFrameMs: number;
	/** Tasks of the page that blocked it over 50 ms, and their total time. */
	longTasks: number;
	longTaskMs: number;
	/** What the scene holds at the end of the sample. */
	meshes: number;
	materials: number;
	textures: number;
	lights: number;
	/** JavaScript memory in use (Chromium only; 0 elsewhere). */
	heapMB: number;
	drawCalls: number;
	activeMeshes: number;
	kTriangles: number;
	agent: string;
}

export interface PerfLog {
	/** Time spent in the scene graph's tick this frame. */
	recordTick(ms: number): void;
	dispose(): void;
}

const WINDOW_MS = 10_000;
/** The first moments after a change are not counted: shaders compile, models arrive. */
const SETTLE_MS = 2_000;
const MIN_SAMPLE_MS = 4_000;
const PAUSED_MS = 1_000;
const ENDPOINT = '/api/debug/perf';

/** The settings that change how fast a world runs: a change of any of them starts a new sample, like an experiment. */
export function performanceSettings(): PerfSample['settings'] {
	return { scriptRate: xrSettings.scriptRate, foveation: xrSettings.foveation, multiview: xrSettings.multiview, frameRate: xrSettings.frameRate };
}

/** `file:line` of the first caller in a stack trace that is not this file, Babylon or another dependency. */
export function callerLocation(stack: string | undefined): string | null {
	for (const line of (stack ?? '').split('\n').slice(1)) {
		if (/perfLog|@babylonjs|node_modules|\.vite\/deps/.test(line)) continue;
		const match = /([^/\s()]+?)(?:\?[^:\s()]*)?:(\d+):\d+\)?\s*$/.exec(line);
		if (match) return `${match[1]}:${match[2]}`;
	}
	return null;
}

/**
 * Times every callback added from now on to the scene's before- and after-render observables, adding its ms to `costs` under `@before|@after file:line`
 * (where it was added). Call it right after making the scene, before the systems add theirs. Dev builds only.
 */
export function profileRenderObservers(scene: Scene, costs: Map<string, number>): void {
	if (!import.meta.env?.DEV) return;
	type Callback = (...args: unknown[]) => unknown;
	const patch = (observable: Observable<unknown>, label: string) => {
		const add = observable.add.bind(observable) as (callback: unknown, ...rest: unknown[]) => ReturnType<typeof observable.add>;
		const removeCallback = observable.removeCallback.bind(observable) as (callback: unknown, scope?: unknown) => boolean;
		const wrapped = new WeakMap<Callback, Callback>();
		observable.add = ((callback: unknown, ...rest: unknown[]) => {
			if (typeof callback !== 'function') return add(callback, ...rest);
			const original = callback as Callback;
			const name = `@${label} ${callerLocation(new Error().stack) ?? (original.name || 'anonymous')}`;
			const timed = function (this: unknown, ...args: unknown[]) {
				const started = performance.now();
				try {
					return original.apply(this, args);
				} finally {
					costs.set(name, (costs.get(name) ?? 0) + performance.now() - started);
				}
			};
			wrapped.set(original, timed);
			return add(timed, ...rest);
		}) as typeof observable.add;
		observable.removeCallback = ((callback: Callback, scope?: unknown) => removeCallback(wrapped.get(callback) ?? callback, scope)) as typeof observable.removeCallback;
	};
	patch(scene.onBeforeRenderObservable as unknown as Observable<unknown>, 'before');
	patch(scene.onAfterRenderObservable as unknown as Observable<unknown>, 'after');
}

export function topCosts(costs: Map<string, number> | undefined, frames: number, count = 16): Array<{ id: string; ms: number }> {
	if (!costs || !frames) return [];
	return [...costs].map(([id, total]) => ({ id, ms: Math.round((total / frames) * 1000) / 1000 })).sort((a, b) => b.ms - a.ms).slice(0, count);
}

export function percentile(sorted: number[], fraction: number): number {
	if (!sorted.length) return 0;
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

/** `costs` holds the ms each script took since the log last emptied it (see `SceneGraph.scriptProfile`). */
export function startPerfLog(scene: Scene, context: () => PerfContext, costs?: Map<string, number>): PerfLog | null {
	if (!import.meta.env?.DEV || typeof fetch !== 'function') return null;
	const session = Math.random().toString(36).slice(2, 10);
	const agent = (typeof navigator === 'undefined' ? '' : navigator.userAgent).slice(0, 140);
	const instrumentation = new SceneInstrumentation(scene);
	instrumentation.captureFrameTime = true;
	instrumentation.captureActiveMeshesEvaluationTime = true;
	instrumentation.captureRenderTargetsRenderTime = true;
	instrumentation.captureRenderTime = true;
	instrumentation.captureInterFrameTime = true;
	let gpu: EngineInstrumentation | null = null;
	try {
		gpu = new EngineInstrumentation(scene.getEngine());
		gpu.captureGPUFrameTime = true;
	} catch {
		gpu = null;
	}
	let longTasks = 0;
	let longTaskMs = 0;
	let longTaskObserver: PerformanceObserver | null = null;
	try {
		longTaskObserver = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) { longTasks += 1; longTaskMs += entry.duration; }
		});
		longTaskObserver.observe({ entryTypes: ['longtask'] });
	} catch {
		longTaskObserver = null;
	}
	const split = { activeMeshes: 0, renderTargets: 0, render: 0, interFrame: 0, gpu: 0, gpuFrames: 0 };

	let key = '';
	let startedAt = 0;
	let frameMs: number[] = [];
	let tickMs = 0;
	let ticks = 0;
	let hitches = 0;
	let drawCalls = 0;
	let meshes = 0;
	let triangles = 0;
	let counted = 0;
	let working = true;

	const send = (entry: object) => {
		fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry), keepalive: true })
			.then((response) => { if (response.status === 404) working = false; })
			.catch(() => {});
	};

	const reset = (now: number, next: string) => {
		key = next;
		startedAt = now;
		frameMs = [];
		tickMs = ticks = hitches = counted = 0;
		drawCalls = meshes = triangles = 0;
		longTasks = longTaskMs = 0;
		split.activeMeshes = split.renderTargets = split.render = split.interFrame = split.gpu = split.gpuFrames = 0;
		costs?.clear();
	};

	const flush = (now: number) => {
		const seconds = Math.max(0, now - startedAt - SETTLE_MS) / 1000;
		if (frameMs.length < 30 || now - startedAt < MIN_SAMPLE_MS) return;
		const sorted = [...frameMs].sort((a, b) => a - b);
		const mean = frameMs.reduce((sum, value) => sum + value, 0) / frameMs.length;
		const { world, mode, settings } = JSON.parse(key) as PerfContext & { experiments: string[]; settings: PerfSample['settings'] };
		const per = (total: number) => (counted ? Math.round((total / counted) * 100) / 100 : 0);
		const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
		const sample: PerfSample = {
			type: 'sample',
			session,
			at: new Date().toISOString(),
			world,
			mode,
			experiments: activeExperiments(),
			settings,
			seconds: Math.round(seconds * 10) / 10,
			frames: frameMs.length,
			fps: Math.round((1000 / mean) * 10) / 10,
			frameMsMean: Math.round(mean * 100) / 100,
			frameMsP95: Math.round(percentile(sorted, 0.95) * 100) / 100,
			frameMsMax: Math.round(sorted[sorted.length - 1] * 100) / 100,
			hitches,
			tickMsMean: ticks ? Math.round((tickMs / ticks) * 1000) / 1000 : 0,
			cpuFrameMs: Math.round(instrumentation.frameTimeCounter.average * 100) / 100,
			topScripts: topCosts(costs, frameMs.length),
			drawCalls: counted ? Math.round(drawCalls / counted) : 0,
			activeMeshes: counted ? Math.round(meshes / counted) : 0,
			kTriangles: counted ? Math.round((triangles / counted / 3 / 1000) * 10) / 10 : 0,
			activeMeshesMs: per(split.activeMeshes),
			renderTargetsMs: per(split.renderTargets),
			renderMs: per(split.render),
			interFrameMs: per(split.interFrame),
			gpuFrameMs: split.gpuFrames ? Math.round((split.gpu / split.gpuFrames) * 100) / 100 : 0,
			longTasks,
			longTaskMs: Math.round(longTaskMs),
			meshes: scene.meshes.length,
			materials: scene.materials.length,
			textures: scene.textures.length,
			lights: scene.lights.length,
			heapMB: memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : 0,
			agent
		};
		if (working) send(sample);
	};

	const observer = scene.onBeforeRenderObservable.add(() => {
		if (!working) return;
		const now = performance.now();
		const dt = scene.getEngine().getDeltaTime();
		const next = JSON.stringify({ ...context(), experiments: activeExperiments(), settings: performanceSettings() });
		if (next !== key) {
			if (key) flush(now);
			reset(now, next);
			return;
		}
		// A hidden tab or a breakpoint is not a slow frame.
		if (dt <= 0 || dt > PAUSED_MS) { reset(now, key); return; }
		if (now - startedAt < SETTLE_MS) return;
		frameMs.push(dt);
		if (dt > 50) hitches += 1;
		drawCalls += instrumentation.drawCallsCounter.lastSecAverage;
		meshes += scene.getActiveMeshes().length;
		triangles += scene.getActiveIndices();
		split.activeMeshes += instrumentation.activeMeshesEvaluationTimeCounter.current;
		split.renderTargets += instrumentation.renderTargetsRenderTimeCounter.current;
		split.render += instrumentation.renderTimeCounter.current;
		split.interFrame += instrumentation.interFrameTimeCounter.current;
		// Babylon gives the GPU's time in nanoseconds, and 0 until (or unless) the browser measures it.
		const gpuNs = gpu?.gpuFrameTimeCounter.current ?? 0;
		if (gpuNs > 0) { split.gpu += gpuNs / 1e6; split.gpuFrames += 1; }
		counted += 1;
		if (now - startedAt >= WINDOW_MS + SETTLE_MS) {
			flush(now);
			reset(now, key);
		}
	});

	const hidden = () => {
		if (document.visibilityState === 'hidden' && key) { flush(performance.now()); reset(performance.now(), key); }
	};
	if (typeof document !== 'undefined') document.addEventListener('visibilitychange', hidden);

	return {
		recordTick(ms) {
			tickMs += ms;
			ticks += 1;
		},
		dispose() {
			scene.onBeforeRenderObservable.remove(observer);
			if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', hidden);
			instrumentation.dispose();
			gpu?.dispose();
			longTaskObserver?.disconnect();
		}
	};
}

/** Tells the log that an experiment was switched, so the samples around it can be read as before and after. */
export function logExperimentToggle(id: string, on: boolean): void {
	if (!import.meta.env?.DEV || typeof fetch !== 'function') return;
	fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'toggle', at: new Date().toISOString(), id, on }), keepalive: true }).catch(() => {});
}
