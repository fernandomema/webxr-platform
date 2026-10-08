import type { Slot, SlotTree } from '../../ecs/types';
import { createSlot } from '../../ecs/types';

/** A world a lobby banner advertises: the picture, the built-in world it leads to and its name in the menu. */
export interface LobbyBanner {
	image: string;
	world: string;
	label: string;
}

export const LOBBY_BANNERS: readonly LobbyBanner[] = [
	{ image: '/assets/images/world-banners/beat-turntable.png', world: 'beat-turntable', label: 'Beat Turntable' },
	{ image: '/assets/images/world-banners/feedback.png', world: 'pulse', label: 'Feedback Center' }
];

/** Seconds each banner stays up before the next one takes its place. */
const BANNER_SECONDS = 8;

const ROOT = 'lobby-billboard';
const PANEL = 'lobby-billboard-panel';
const IMAGE = 'lobby-billboard-image';
/** The banners are portrait (2:3). */
const PX_WIDTH = 512;
const PX_HEIGHT = 768;
const WIDTH = 1.2;
const HEIGHT = (WIDTH * PX_HEIGHT) / PX_WIDTH;
const FRAME = 0.08;
const POST_HEIGHT = 0.3;

/** Turns the banners over time: the picture and where its link leads change together. Only the host (or a solo player) can change them. */
function rotationCode(banners: readonly LobbyBanner[]): string {
	return `
const banners = ${JSON.stringify(banners)};
const seconds = ${BANNER_SECONDS};
let index = 0;
let elapsed = 0;
return {
	tick(dt) {
		if (banners.length < 2) return;
		elapsed += dt;
		if (elapsed < seconds) return;
		elapsed = 0;
		index = (index + 1) % banners.length;
		const banner = banners[index];
		ctx.world.setComponentField('${IMAGE}', 'uiElement', 'src', banner.image);
		ctx.world.setComponent('${PANEL}', { type: 'worldLink', target: { kind: 'builtin', id: banner.world }, label: banner.label });
	}
};`;
}

/**
 * An advertising board behind and to the right of the spawn pad, turned to face it. Its picture rotates through `banners`; pressing
 * the board opens a radial menu to go to the world it shows.
 */
export function buildLobbyBillboard(banners: readonly LobbyBanner[] = LOBBY_BANNERS): SlotTree {
	if (!banners.length) return [];
	const first = banners[0];
	const centerY = POST_HEIGHT + HEIGHT / 2 + FRAME;
	const dark = { type: 'meshRenderer', color: '#14131f' } as const;
	const box = { kind: 'builtin', id: 'box' } as const;
	const slots: Slot[] = [
		createSlot({ id: ROOT, name: 'Billboard', position: [4.2, 0, 3.2], rotation: [0, 0.4794, 0, 0.8776] }),
		createSlot({
			id: `${ROOT}-frame`,
			parentId: ROOT,
			name: 'Billboard Frame',
			position: [0, centerY, FRAME / 2 + 0.01],
			scale: [WIDTH + FRAME * 2, HEIGHT + FRAME * 2, FRAME],
			components: [{ ...dark, meshRef: box }, { type: 'collider', shape: 'box' }]
		}),
		...[-1, 1].map((side) => createSlot({
			id: `${ROOT}-post-${side < 0 ? 'L' : 'R'}`,
			parentId: ROOT,
			name: `Billboard Post ${side < 0 ? 'L' : 'R'}`,
			position: [side * (WIDTH / 2 - 0.1), (POST_HEIGHT + FRAME) / 2, FRAME / 2 + 0.01],
			scale: [0.07, POST_HEIGHT + FRAME, 0.07],
			components: [{ ...dark, meshRef: box }, { type: 'collider', shape: 'box' }]
		})),
		createSlot({
			id: PANEL,
			parentId: ROOT,
			name: 'Billboard Banner',
			position: [0, centerY, 0],
			components: [
				{ type: 'uiPanel', width: PX_WIDTH, height: PX_HEIGHT, worldWidth: WIDTH, background: '#000000' },
				{ type: 'worldLink', target: { kind: 'builtin', id: first.world }, label: first.label }
			]
		}),
		createSlot({ id: `${ROOT}-picture`, parentId: PANEL, name: 'Billboard Picture Frame', components: [{ type: 'uiElement', kind: 'container', width: PX_WIDTH, height: PX_HEIGHT }] }),
		createSlot({ id: IMAGE, parentId: `${ROOT}-picture`, name: 'Billboard Picture', components: [{ type: 'uiElement', kind: 'image', src: first.image, width: PX_WIDTH, height: PX_HEIGHT }] }),
		createSlot({ id: `${ROOT}-rotator`, parentId: ROOT, name: 'Billboard Rotator', components: [{ type: 'codeBlock', code: rotationCode(banners) }] })
	];
	return slots;
}
