import type { Slot } from '../../ecs/types';
import type { SourceRef } from '../../assets/ref';
import { lookRotation } from '../thumbnail/cameraPose.ts';

/**
 * A material orb: a small sphere showing a material, grabbable, that a tool's socket (tag `material`) takes. Its `material`
 * component is what a tool copies onto what it points at, so the orb is both the preview of how the material looks (full PBR,
 * lit like everything else) and the carrier of it. A label under it says what it is. Pure: runs in Node and in world scripts.
 */
export interface MaterialOrbParams {
	/** Id of the root slot; the others derive theirs from it. */
	id: string;
	/** What it is called, on its label and its name. */
	label: string;
	albedo?: SourceRef;
	normal?: SourceRef;
	arm?: SourceRef;
	/**
	 * The real size, in metres, that one repeat of the maps covers. The orb itself shows the material smaller, so a few repeats fit
	 * on it; this is kept in its `scriptState` (`data.size`) for the tool that lays the material on something.
	 */
	size?: number;
}

/** What one repeat covers on the orb itself: about two and a half repeats round it, enough to see the grain. */
export const ORB_PREVIEW_SIZE = 0.15;

/** The tag a socket must accept to take a material orb. */
export const MATERIAL_ORB_TAG = 'material';
/** Its diameter in metres: small enough to sit in a hand tool. */
export const MATERIAL_ORB_DIAMETER = 0.12;

const D = MATERIAL_ORB_DIAMETER;
const round = (value: number) => Math.round(value * 10000) / 10000 + 0;

export function buildMaterialOrb(params: MaterialOrbParams, placement: { parentId?: string | null; position?: Slot['position'] } = {}): Slot[] {
	const { id, label } = params;
	const root: Slot = {
		id,
		parentId: placement.parentId ?? null,
		name: `Material: ${label}`,
		position: placement.position ?? [0, 0, 0],
		rotation: [0, 0, 0, 1],
		scale: [D, D, D],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#d1d5db' },
			{
				type: 'material',
				...(params.albedo ? { albedo: params.albedo } : {}),
				...(params.normal ? { normal: params.normal } : {}),
				...(params.arm ? { arm: params.arm } : {}),
				mapping: 'world',
				size: ORB_PREVIEW_SIZE,
				label
			},
			{ type: 'scriptState', data: { size: params.size && params.size > 0 ? params.size : 1 } },
			{ type: 'collider', shape: 'sphere' },
			{ type: 'grabbable', scalable: false },
			{ type: 'insertable', tag: MATERIAL_ORB_TAG }
		]
	};
	// The root is scaled by its diameter, so a child's place and size are in orb units (1 unit = the diameter).
	const labelPlate: Slot = {
		id: `${id}-label`,
		parentId: id,
		name: 'Material Label',
		position: [0, -0.95, 0],
		rotation: [0, 0, 0, 1],
		scale: [2.2, 0.4, 1],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#1f2937' },
			{ type: 'textDisplay', title: label, lines: [], color: '#1f2937', verticalAlign: 'middle' }
		]
	};
	// Where a picture of it is taken from: in front of it, a little above, looking at it.
	const eye: [number, number, number] = [0, 0.25, -0.5];
	const camera: Slot = {
		id: `${id}-preview-camera`,
		parentId: id,
		name: 'Material Preview Camera',
		position: [round(eye[0] / D), round(eye[1] / D), round(eye[2] / D)],
		rotation: lookRotation([-eye[0], -eye[1], -eye[2]]).map(round) as Slot['rotation'],
		scale: [1, 1, 1],
		components: [{ type: 'previewCamera' }]
	};
	return [root, labelPlate, camera];
}
