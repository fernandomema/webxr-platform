import type { BakeStats } from './bakeJob.ts';

// Kept out of the component: strings built inside its script are rewritten by the translation plugin.
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** What the bake panel says about the state of the world's baked lighting. */
export function bakeSummary(hasBake: boolean, bakedLights: number): string {
	const lights = bakedLights ? `${bakedLights} ${plural(bakedLights, 'light is', 'lights are')} marked Baked.` : 'No lights are marked Baked: tick Baked on the lights you want in the bake.';
	return (hasBake ? 'This world has baked lighting. ' : '') + lights;
}

export function bakeStatsText(stats: BakeStats): string {
	return `${stats.dims.join(' × ')} voxels of ${stats.voxel.toFixed(2)} m, ${stats.lights} ${plural(stats.lights, 'light', 'lights')}, ${stats.seconds.toFixed(1)} s.`;
}

/** Identifiers, not text for people: the translation plugin would otherwise pick them up from the component. */
export const ABORT_ERROR = 'AbortError';
export const CAPTURE_CAMERA_NAME = 'Preview Camera';
