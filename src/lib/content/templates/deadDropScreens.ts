import type { Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { NEON, ui } from './arcadeKit.ts';
import type { Vec3 } from './arcadeKit.ts';
import { SCREEN, SCREEN_AT } from './deadDropEconomy.ts';
import { ID, mesh } from './deadDropKit.ts';
import { COLOR, yawOf } from './deadDropLook.ts';

/** Where the two screens stand, in the bunker: the stash on the west wall beside the lockers, the trader's on his counter. */
export const STASH_AT: Vec3 = [SCREEN_AT.stash[0], 1.75, SCREEN_AT.stash[1]];
export const TRADER_AT: Vec3 = [SCREEN_AT.trader[0], 1.95, SCREEN_AT.trader[1]];

const PAGE = '#0c0a09';
const MUTED = '#a8a29e';
const button = (id: string, parent: string, text: string, width: number, background: string, height = 52, fontSize = 24) =>
	ui(id, parent, 'button', { width, height, text, fontSize, fontWeight: 'bold', textAlign: 'center', cornerRadius: 12, background });
const line = (id: string, parent: string, text: string, height: number, fontSize: number, color = '#f5f5f4', align: 'left' | 'center' | 'right' = 'left', width = 700, bold = false) =>
	ui(id, parent, 'text', { text, height, width, fontSize, textAlign: align, color, ...(bold ? { fontWeight: 'bold' } : {}) });
const row = (id: string, parent: string, height = 56, gap = 8) => ui(id, parent, 'container', { width: 700, height, flexDirection: 'row', gap, margin: 2 });

/** The screen of the stash: what the player takes on a raid, one row to a thing, with a pair of arrows to change each. */
export function buildStashScreen(): Slot[] {
	const root = ID.stashScreen;
	const slots: Slot[] = [
		createSlot({
			id: root,
			parentId: ID.director,
			name: 'Stash Screen',
			position: STASH_AT,
			rotation: yawOf(-Math.PI / 2),
			components: [{ type: 'uiPanel', width: 760, height: 840, worldWidth: 1.5, background: PAGE }]
		}),
		line('dd-ss-title', root, 'STASH', 56, 44, NEON.orange, 'center', 700, true),
		line('dd-ss-user', root, 'Step up to the lockers', 36, 28, '#f5f5f4', 'center', 700, true),
		line('dd-ss-credits', root, '', 32, 24, '#fde047', 'center', 700, true),
		line('dd-ss-help', root, 'CHOOSE WHAT TO TAKE ON THE RAID  ·  press < or > on a row', 30, 17, MUTED, 'center'),
		line('dd-ss-help2', root, 'What you carry is lost if you die, except the case.', 28, 17, '#f87171', 'center')
	];
	for (let i = 0; i < SCREEN.loadoutRows; i++) {
		const r = `dd-ss-line-${i}`;
		slots.push(
			row(r, root, 52),
			line(`dd-ss-label-${i}`, r, '', 52, 20, MUTED, 'left', 150),
			button(`dd-ss-prev-${i}`, r, '<', 56, '#57534e'),
			line(`dd-ss-row-${i}`, r, '', 52, 24, '#f5f5f4', 'center', 340, true),
			button(`dd-ss-next-${i}`, r, '>', 56, '#57534e')
		);
	}
	slots.push(line('dd-ss-list', root, '', 62, 17, MUTED), line('dd-ss-kit', root, 'Press any button to open your stash.', 62, 20, NEON.green, 'left', 700, true));
	return slots;
}

/** The trader's screen: buy, sell, or improve the refuge. */
export function buildTraderScreen(): Slot[] {
	const root = ID.traderScreen;
	const slots: Slot[] = [
		createSlot({
			id: root,
			parentId: ID.director,
			name: 'Trader Screen',
			position: TRADER_AT,
			rotation: yawOf(Math.PI / 2),
			components: [{ type: 'uiPanel', width: 760, height: 780, worldWidth: 1.5, background: PAGE }]
		}),
		line('dd-ts-title', root, 'TRADER', 56, 44, NEON.orange, 'center', 700, true),
		line('dd-ts-user', root, 'Step up to the counter', 36, 28, '#f5f5f4', 'center', 700, true),
		line('dd-ts-credits', root, '', 32, 24, '#fde047', 'center', 700, true),
		row('dd-ts-modes', root, 64),
		button('dd-ts-buy', 'dd-ts-modes', 'BUY', 220, '#2563eb', 56),
		button('dd-ts-sell', 'dd-ts-modes', 'SELL', 220, '#292524', 56),
		button('dd-ts-up', 'dd-ts-modes', 'REFUGE', 240, '#292524', 56)
	];
	for (let i = 0; i < SCREEN.traderRows; i++) {
		const r = `dd-ts-line-${i}`;
		slots.push(
			row(r, root, 54),
			line(`dd-ts-row-${i}`, r, '', 54, 21, '#f5f5f4', 'left', 400, true),
			line(`dd-ts-price-${i}`, r, '', 54, 22, '#fde047', 'right', 100, true),
			button(`dd-ts-go-${i}`, r, '', 160, '#44403c', 50, 22)
		);
	}
	slots.push(
		line('dd-ts-note', root, '', 50, 20, MUTED, 'center', 700, true),
		row('dd-ts-foot', root, 60),
		button('dd-ts-prev', 'dd-ts-foot', '<', 70, '#57534e', 54),
		line('dd-ts-page', 'dd-ts-foot', 'Page 1/1', 54, 18, MUTED, 'center', 340),
		button('dd-ts-next', 'dd-ts-foot', '>', 70, '#57534e', 54),
		button('dd-ts-sellall', 'dd-ts-foot', 'SELL ALL LOOT', 190, '#b45309', 54, 17)
	);
	return slots;
}

/** The counter the trader stands behind: a stand for the screen. */
export function buildTraderStand(): Slot[] {
	return [
		mesh('dd-ts-stand', 'Screen Stand', 'box', [TRADER_AT[0] + 0.2, 1.15, TRADER_AT[2]], [0.3, 0.2, 0.3], COLOR.metalDark),
		mesh('dd-ss-stand', 'Screen Stand', 'box', [STASH_AT[0] - 0.25, 0.9, STASH_AT[2]], [0.4, 1.8, 0.8], COLOR.metalDark)
	];
}
