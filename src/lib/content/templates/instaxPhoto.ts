/**
 * An instant print (Instax square, a little larger than life so the caption can be read) as plain slots: a white card with a square
 * picture, in 2D or 3D, and a strip for a caption. It is parametric: `photo` (an image URL, or the `data:image/jpeg` a camera prints),
 * `layout` (`mono`, or `sbs` for a stereo pair) and `caption` are bound to the fields that show them, so an `instancer` builds as
 * many different prints as it is given values for. Pure: no Babylon, runs in Node.
 *
 * The card is squashed flat like a record disc, so what hangs from it is given in the root's own (stretched) units.
 */
import type { Quat, Slot, Vec3 } from '@kithin/engine/ecs/types';

/** Larger than a real Instax square card (72 × 86 mm) by this much. */
const SIZE = 1.6;
export const CARD_WIDTH = 0.072 * SIZE;
export const CARD_THICKNESS = 0.0012 * SIZE;
export const CARD_DEPTH = 0.086 * SIZE;
export const PICTURE_SIDE = 0.062 * SIZE;
/** Distance from the card's middle to the picture's (towards the top of the card), and to the caption's (towards the bottom). */
export const PICTURE_Z = -0.006 * SIZE;
export const CAPTION_Z = 0.0335 * SIZE;
export const CAPTION_HEIGHT = 0.017 * SIZE;
const CARD_COLOR = '#f5f2ea';

const round = (value: number) => Math.round(value * 10000) / 10000 + 0;
/** Lies flat on the card facing up, the top of its content towards the card's -Z (as a disc's label text does). */
const FLAT: Quat = [0, 0.7071, -0.7071, 0];
/** Just above the card's top face (the root's units run along its thickness). */
const ABOVE = round(0.5 + 0.0004 / CARD_THICKNESS);

export const INSTAX_PARAMS = [
	{ name: 'photo', label: 'Photo', kind: 'url', default: '' },
	{ name: 'layout', label: 'Layout (mono, sbs, depth)', kind: 'text', default: 'mono' },
	{ name: 'inset', label: 'Margin of a spatial photo', kind: 'number', default: 0 },
	{ name: 'caption', label: 'Caption', kind: 'text', default: '' }
] as const;

export function buildInstaxPhoto(id: string, placement: { parentId?: string | null; position?: Vec3; rotation?: Quat } = {}): Slot[] {
	const root: Slot = {
		id,
		parentId: placement.parentId ?? null,
		name: 'Instax photo',
		position: placement.position ?? [0, 0, 0],
		rotation: placement.rotation ?? [0, 0, 0, 1],
		scale: [CARD_WIDTH, CARD_THICKNESS, CARD_DEPTH],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: CARD_COLOR },
			{ type: 'collider', shape: 'box' },
			{ type: 'grabbable', scalable: true },
			{
				type: 'params',
				params: INSTAX_PARAMS.map((p) => ({ ...p })),
				bindings: [
					{ param: 'photo', slot: `${id}-picture`, component: 'stereoImage', field: 'source.url' },
					{ param: 'layout', slot: `${id}-picture`, component: 'stereoImage', field: 'layout' },
					{ param: 'inset', slot: `${id}-picture`, component: 'stereoImage', field: 'inset' },
					{ param: 'caption', slot: `${id}-caption`, component: 'textDisplay', field: 'lines.0' }
				]
			}
		]
	};
	return [
		root,
		{
			id: `${id}-picture`, parentId: id, name: 'Instax Picture', rotation: FLAT,
			position: [0, ABOVE, round(PICTURE_Z / CARD_DEPTH)],
			scale: [round(PICTURE_SIDE / CARD_WIDTH), round(PICTURE_SIDE / CARD_DEPTH), 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: CARD_COLOR },
				{ type: 'stereoImage', source: { kind: 'url', url: '' }, layout: 'mono' }
			]
		},
		{
			id: `${id}-caption`, parentId: id, name: 'Instax Caption', rotation: FLAT,
			position: [0, ABOVE, round(CAPTION_Z / CARD_DEPTH)],
			scale: [round(PICTURE_SIDE / CARD_WIDTH), round(CAPTION_HEIGHT / CARD_DEPTH), 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: CARD_COLOR },
				{ type: 'textDisplay', lines: [''], background: CARD_COLOR, lineColor: '#2b2b2b', lit: true, verticalAlign: 'middle' }
			]
		}
	];
}
