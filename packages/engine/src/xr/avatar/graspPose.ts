import { holdingBends, palmShift, shiftPrimitives, solveGraspFull, type HandModel, type Primitive } from './grasp.ts';
import type { V3 } from './ik.ts';

export interface GraspInput {
	model: HandModel;
	obstacles: Primitive[];
	/** Null for equipment, which already has its authored grip position. */
	reach: number | null;
}

export interface GraspPose {
	model: HandModel;
	shift: V3 | null;
	bends: number[];
	thumbSwing: number;
}

export interface GraspJob {
	id: number;
	input: GraspInput;
}

export interface GraspReply {
	id: number;
	pose: GraspPose;
}

/** Pure geometry: also used by the worker, without importing Babylon or accessing live scene nodes. */
export function solveGraspPose({ model, obstacles, reach }: GraspInput): GraspPose {
	const shift = reach === null ? null : palmShift(model, obstacles, reach);
	return { model, shift, ...solveGraspFull(model, shift ? shiftPrimitives(obstacles, shift) : obstacles, holdingBends()) };
}
