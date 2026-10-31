import { Vector3, type AbstractMesh, type Scene } from '@babylonjs/core';
import type { FoveationLevel, ScriptRate } from './settings.ts';
import { xrSettings } from './settings.ts';

/**
 * Performance experiments: ideas to make a world cheaper to draw or run, each one switchable from the Settings tab so that
 * they can be compared by playing. Every window of measurements the performance log records says which were on (see
 * perfLog.ts), so what each one is worth shows up by itself. None of them is on by default.
 *
 * Each experiment says in which builds it shows (`environments`). 'dev' is the developer build; 'prod' additionally shows
 * it to players, for the ones that are useful but not proven — a release build never applies an experiment the player
 * cannot see and switch off.
 */
export interface ExperimentContext {
	scene: Scene;
	/** The scene graph, for its far scripts (`SceneGraph.farScripts`). */
	scripts: { farScripts: { distance: number; divisor: number } | null };
	/** Live quality knobs the adaptive governor may move (engine-provided; absent where there is nothing to govern). */
	quality?: QualityKnobs;
}

/** Where an experiment may show up. */
export type ExperimentEnvironment = 'dev' | 'prod';

export interface Experiment {
	id: string;
	label: string;
	description: string;
	/** Where the experiment is offered: 'dev' builds always see everything; 'prod' additionally ships it to players. Default dev only. */
	environments?: readonly ExperimentEnvironment[];
	/** Puts the experiment on or off. Called again with the same state when the scene is rebuilt, so it must be safe to repeat. */
	apply(on: boolean, context: ExperimentContext): void;
}

/** Live quality settings the adaptive governor can trade against each other. */
export interface QualityKnobs {
	inXr(): boolean;
	fps(): number;
	/** The frame rate the device is currently aiming at (the headset's refresh rate in XR, the engine's target on screen). */
	targetFps(): number;
	foveation(): FoveationLevel;
	setFoveation(level: FoveationLevel): void;
	scriptRate(): ScriptRate;
	setScriptRate(rate: ScriptRate): void;
}

const isDevBuild = (): boolean => !!import.meta.env?.DEV;

/** Whether an experiment is offered in this kind of build. Everything exists in dev; only 'prod'-listed ones ship to players. */
export function experimentVisible(experiment: Experiment, dev = isDevBuild()): boolean {
	return dev || (experiment.environments ?? ['dev']).includes('prod');
}

/** The experiments offered in this kind of build, in definition order. */
export function visibleExperiments(dev = isDevBuild()): Experiment[] {
	return EXPERIMENTS.filter((experiment) => experimentVisible(experiment, dev));
}

const hardwareScaling = (level: number): Experiment['apply'] => (on, { scene }) => scene.getEngine().setHardwareScalingLevel(on ? level : 1);

const bloomBefore = new WeakMap<object, boolean>();
const lightsBefore = new WeakMap<object, number>();
let stopLightWatch: (() => void) | undefined;

const FOVEATION_LADDER: readonly FoveationLevel[] = ['off', 'medium', 'high'];
const SCRIPT_RATE_LADDER: readonly ScriptRate[] = [1, 2, 3, 4];

export interface QualityPosition {
	foveation: FoveationLevel;
	scriptRate: ScriptRate;
}

/**
 * One step of the adaptive quality governor. `floor` is the player's own setting (the best quality on offer); a low
 * `fpsRatio` moves one notch away from it (more foveation, then slower scripts), a comfortable one moves a notch back.
 * Returns the new position, or null when there is nothing left to trade in that direction.
 */
export function governStep(current: QualityPosition, floor: QualityPosition, fpsRatio: number): QualityPosition | null {
	const clampStep = <T>(ladder: readonly T[], from: T, to: T): number | null => {
		const at = ladder.indexOf(from);
		const toward = ladder.indexOf(to);
		if (at === -1 || toward === -1 || at === toward) return null;
		return at + Math.sign(toward - at);
	};
	if (fpsRatio < 0.85) {
		const foveation = clampStep(FOVEATION_LADDER, current.foveation, 'high');
		if (foveation !== null) return { ...current, foveation: FOVEATION_LADDER[foveation] };
		const scriptRate = clampStep(SCRIPT_RATE_LADDER, current.scriptRate, 4);
		if (scriptRate !== null) return { ...current, scriptRate: SCRIPT_RATE_LADDER[scriptRate] };
		return null;
	}
	if (fpsRatio >= 0.97) {
		const scriptRate = clampStep(SCRIPT_RATE_LADDER, current.scriptRate, floor.scriptRate);
		if (scriptRate !== null) return { ...current, scriptRate: SCRIPT_RATE_LADDER[scriptRate] };
		const foveation = clampStep(FOVEATION_LADDER, current.foveation, floor.foveation);
		if (foveation !== null) return { ...current, foveation: FOVEATION_LADDER[foveation] };
		return null;
	}
	return null;
}

let stopGovernor: (() => void) | undefined;

const GOVERNOR_WINDOW_FRAMES = 90;
const GOVERNOR_COOLDOWN_WINDOWS = 2;

/** Watches the frame rate and trades edge detail, then script speed, against smoothness, within the player's own settings. */
function applyAdaptiveQuality(on: boolean, { scene, quality }: ExperimentContext): void {
	stopGovernor?.();
	stopGovernor = undefined;
	if (!on || !quality) return;
	const floor: QualityPosition = { foveation: quality.foveation(), scriptRate: quality.scriptRate() };
	let current = { ...floor };
	let frames = 0;
	let cooldown = GOVERNOR_COOLDOWN_WINDOWS;
	const observer = scene.onBeforeRenderObservable.add(() => {
		if (++frames < GOVERNOR_WINDOW_FRAMES) return;
		frames = 0;
		if (cooldown > 0) {
			cooldown--;
			return;
		}
		const target = quality.targetFps();
		if (!target) return;
		const next = governStep(current, floor, quality.fps() / target);
		if (!next) return;
		current = next;
		quality.setFoveation(next.foveation);
		quality.setScriptRate(next.scriptRate);
		cooldown = GOVERNOR_COOLDOWN_WINDOWS;
	});
	stopGovernor = () => {
		scene.onBeforeRenderObservable.remove(observer);
		quality.setFoveation(floor.foveation);
		quality.setScriptRate(floor.scriptRate);
	};
}

let stopFreezeWatch: (() => void) | undefined;
const frozenStatics = new Set<AbstractMesh>();
/** The local transform (position, rotation, optional quaternion, scaling) each frozen mesh had when it froze. */
const frozenSnapshots = new WeakMap<AbstractMesh, Float32Array>();

const localSnapshot = (mesh: AbstractMesh): Float32Array => {
	const { position: p, rotation: r, scaling: s } = mesh;
	const q = mesh.rotationQuaternion;
	return new Float32Array([p.x, p.y, p.z, r.x, r.y, r.z, q?.x ?? 0, q?.y ?? 0, q?.z ?? 0, q?.w ?? 1, s.x, s.y, s.z]);
};

/** True when any part of the mesh's local transform differs from the snapshot (an in-place write counts: a script moved it). */
const localChanged = (mesh: AbstractMesh, snapshot: Float32Array): boolean => {
	const { position: p, rotation: r, scaling: s } = mesh;
	const q = mesh.rotationQuaternion;
	if (p.x !== snapshot[0] || p.y !== snapshot[1] || p.z !== snapshot[2]) return true;
	if (r.x !== snapshot[3] || r.y !== snapshot[4] || r.z !== snapshot[5]) return true;
	if (q ? q.x !== snapshot[6] || q.y !== snapshot[7] || q.z !== snapshot[8] || q.w !== snapshot[9] : snapshot[6] !== 0 || snapshot[7] !== 0 || snapshot[8] !== 0 || snapshot[9] !== 1) return true;
	if (s.x !== snapshot[10] || s.y !== snapshot[11] || s.z !== snapshot[12]) return true;
	return false;
};

const matrixEquals = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
	for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
	return true;
};

/**
 * Freezes meshes whose world matrix has not changed over one probe interval; interactive things are left alone. A frozen
 * mesh is let go again the very frame something writes its local transform (a script, a grab, physics), so resting things
 * stay cheap but nothing can get stuck.
 */
function applyFreezeStatics(on: boolean, { scene }: ExperimentContext): void {
	stopFreezeWatch?.();
	stopFreezeWatch = undefined;
	for (const mesh of frozenStatics) {
		if (!mesh.isDisposed()) mesh.unfreezeWorldMatrix();
	}
	frozenStatics.clear();
	if (!on) return;
	const probe = new Map<AbstractMesh, Float32Array>();
	let frames = 0;
	const eligible = (mesh: AbstractMesh): boolean =>
		mesh.getClassName() === 'Mesh' && !mesh.isAnInstance && !mesh.skeleton && !mesh.infiniteDistance && !mesh.isWorldMatrixFrozen && !mesh.metadata?.interactive && mesh.isEnabled();
	const observer = scene.onBeforeRenderObservable.add(() => {
		for (const mesh of frozenStatics) {
			const snapshot = frozenSnapshots.get(mesh);
			if (!snapshot || !localChanged(mesh, snapshot)) continue;
			mesh.unfreezeWorldMatrix();
			frozenStatics.delete(mesh);
		}
		if ((++frames & 63) !== 0) return;
		for (const mesh of scene.meshes) {
			if (frozenStatics.has(mesh)) continue;
			if (!eligible(mesh)) {
				probe.delete(mesh);
				continue;
			}
			const now = mesh.getWorldMatrix().m;
			const before = probe.get(mesh);
			if (!before) {
				probe.set(mesh, new Float32Array(now));
				continue;
			}
			if (matrixEquals(before, now)) {
				mesh.freezeWorldMatrix();
				frozenStatics.add(mesh);
				frozenSnapshots.set(mesh, localSnapshot(mesh));
				probe.delete(mesh);
			} else {
				probe.set(mesh, new Float32Array(now));
			}
		}
		for (const mesh of [...probe.keys()]) if (!scene.meshes.includes(mesh)) probe.delete(mesh);
	});
	stopFreezeWatch = () => scene.onBeforeRenderObservable.remove(observer);
}

let stopLodWatch: (() => void) | undefined;
const lodHidden = new Set<AbstractMesh>();

const LOD_DISTANCE = 30;

/** Stops drawing world meshes beyond a fixed distance, to measure what far geometry costs. */
function applyAutoLod(on: boolean, { scene }: ExperimentContext): void {
	stopLodWatch?.();
	stopLodWatch = undefined;
	for (const mesh of lodHidden) {
		if (!mesh.isDisposed()) mesh.isVisible = true;
	}
	lodHidden.clear();
	if (!on) return;
	let frame = 0;
	const observer = scene.onBeforeRenderObservable.add(() => {
		if ((++frame % 15) !== 0) return;
		const camera = scene.activeCamera;
		if (!camera) return;
		const from = camera.globalPosition;
		for (const mesh of scene.meshes) {
			const eligible = mesh.getClassName() === 'Mesh' && !mesh.isAnInstance && !mesh.skeleton && !mesh.infiniteDistance && mesh.getTotalVertices() > 0;
			if (!eligible) {
				if (lodHidden.delete(mesh)) mesh.isVisible = true;
				continue;
			}
			const far = Vector3.Distance(mesh.getAbsolutePosition(), from) > LOD_DISTANCE;
			if (far && !lodHidden.has(mesh)) {
				lodHidden.add(mesh);
				mesh.isVisible = false;
			} else if (!far && lodHidden.delete(mesh)) {
				mesh.isVisible = true;
			}
		}
	});
	stopLodWatch = () => scene.onBeforeRenderObservable.remove(observer);
}

export const EXPERIMENTS: readonly Experiment[] = [
	{
		id: 'lowerResolution',
		label: 'Lower resolution',
		description: 'Draws the screen at 80% of its size (desktop). Fewer pixels to shade: shows what the fill rate costs.',
		apply: hardwareScaling(1.25)
	},
	{
		id: 'noGlow',
		label: 'No glow',
		description: 'Turns off the bloom of a desktop screen (a full-screen post process).',
		apply(on, { scene }) {
			for (const pipeline of scene.postProcessRenderPipelineManager.supportedPipelines as unknown as Array<{ bloomEnabled?: boolean }>) {
				if (typeof pipeline.bloomEnabled !== 'boolean') continue;
				if (on) {
					if (!bloomBefore.has(pipeline)) bloomBefore.set(pipeline, pipeline.bloomEnabled);
					pipeline.bloomEnabled = false;
				} else if (bloomBefore.has(pipeline)) {
					pipeline.bloomEnabled = bloomBefore.get(pipeline)!;
					bloomBefore.delete(pipeline);
				}
			}
		}
	},
	{
		id: 'slowFarScripts',
		label: 'Slow far scripts',
		environments: ['dev', 'prod'],
		description: 'Scripts on things more than 12 m away run once every 4 of their turns, with the time they missed. Far games may react late.',
		apply: (on, { scripts }) => {
			scripts.farScripts = on ? { distance: 12, divisor: 4 } : null;
		}
	},
	{
		id: 'mirrorHalfRate',
		label: 'Mirrors at half rate',
		environments: ['dev', 'prod'],
		description: 'Mirrors draw their reflection every second frame and keep the last one in between. The reflection may lag a little.',
		apply() {
			// Read every frame by the mirror itself (specialSurfaces.ts).
		}
	},
	{
		id: 'fewerLights',
		label: 'Fewer lights per material',
		environments: ['dev', 'prod'],
		description: 'Each surface is lit by at most 2 lights instead of 4: cheaper shaders. Places with many lamps may look darker.',
		apply(on, { scene }) {
			stopLightWatch?.();
			stopLightWatch = undefined;
			const limit = (material: object) => {
				const lit = material as { maxSimultaneousLights?: number };
				if (typeof lit.maxSimultaneousLights !== 'number') return;
				if (on) {
					if (!lightsBefore.has(material)) lightsBefore.set(material, lit.maxSimultaneousLights);
					lit.maxSimultaneousLights = Math.min(lit.maxSimultaneousLights, 2);
				} else if (lightsBefore.has(material)) {
					lit.maxSimultaneousLights = lightsBefore.get(material)!;
					lightsBefore.delete(material);
				}
			};
			for (const material of scene.materials) limit(material);
			if (on) {
				const added = scene.onNewMaterialAddedObservable.add(limit);
				stopLightWatch = () => scene.onNewMaterialAddedObservable.remove(added);
			}
		}
	},
	{
		id: 'avatarHalfRate',
		label: 'Avatar body at half rate',
		environments: ['dev', 'prod'],
		description: 'Poses the body and legs every second frame while the head, arms and fingers keep tracking the controllers every frame, so the hands stay glued to them. The gait looks a little less fluid.',
		apply() {
			// Read every frame by the avatar system (avatarSystem.ts).
		}
	},
	{
		id: 'dashGuiHalfRate',
		label: 'Personal menu at half rate',
		environments: ['dev', 'prod'],
		description: 'The personal menu repaints every second frame instead of every one. Its animations and typing look half as smooth; everything else is untouched.',
		apply() {
			// Read every frame by the GUI upload pass (guiUploads.ts).
		}
	},
	{
		id: 'adaptiveQuality',
		label: 'Adaptive quality',
		description: 'Watches the frame rate and, when the world cannot keep up, sharpens the foveation and then slows the world scripts — and gives the quality back when there is headroom. Never goes past your own Detail and Script rate settings.',
		apply: applyAdaptiveQuality
	},
	{
		id: 'freezeStatics',
		label: 'Freeze static meshes',
		environments: ['dev', 'prod'],
		description: 'Meshes that have not moved for a moment stop recomputing their transforms. The moment a script, a grab or physics writes to one (a ball leaving its rest spot) it is let go again, so nothing can get stuck; a mesh parented to something that starts moving later would, so far, stay behind.',
		apply: applyFreezeStatics
	},
	{
		id: 'autoLod',
		label: 'Hide distant meshes',
		description: `World meshes more than ${LOD_DISTANCE} m away stop drawing, to measure what the far geometry costs. Things pop out at the edge of that range; real distance detail would switch to a cheaper mesh instead.`,
		apply: applyAutoLod
	}
];

/** Whether the Settings tab offers experiments in this build (it does when at least one is visible here). */
export const experimentsAvailable = (): boolean => visibleExperiments().length > 0;

export function isExperimentOn(id: string, dev = isDevBuild()): boolean {
	const experiment = EXPERIMENTS.find((candidate) => candidate.id === id);
	if (!experiment || !experimentVisible(experiment, dev)) return false;
	return xrSettings.experiments[id] === true;
}

/** The ids of the experiments that are on, sorted: the configuration a performance sample was taken under. */
export function activeExperiments(): string[] {
	return visibleExperiments().filter((experiment) => xrSettings.experiments[experiment.id] === true).map((experiment) => experiment.id).sort();
}

/** Puts every experiment in the state the settings say (all off outside a build where it is visible). */
export function applyExperiments(context: ExperimentContext): void {
	for (const experiment of visibleExperiments()) experiment.apply(isExperimentOn(experiment.id), context);
}
