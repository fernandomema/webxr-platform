import type { Slot, UIElementComponent } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { CARD_LINES, HUD_BAR, POOLS, TEAM } from './data.ts';

export { CARD_LINES, HUD_BAR };
import { ID, PARKED } from './kit.ts';

type Layout = Partial<Omit<UIElementComponent, 'type' | 'kind'>>;

function element(id: string, parentId: string, kind: UIElementComponent['kind'], layout: Layout): Slot {
	return createSlot({ id, parentId, name: id, components: [{ type: 'uiElement', kind, ...layout }] });
}

/** The ids of a HUD's parts, which the script writes. */
export const HUD = (side: number, key: string): string => `rd-hud-${side}-${key}`;

/**
 * The HUD: a small panel that stays in front of each player, above the line of sight, where a game puts its numbers. It has the health of both
 * fighters, the points, the round, the magazine and the shield. One for each side: the script moves it with the player's head and parks it when
 * nobody plays that side.
 */
export function buildHuds(): Slot[] {
	return TEAM.flatMap((team, side) => {
		const root = ID.hud(side);
		const bar = (who: 'me' | 'foe', color: string, parent: string): Slot[] => [
			element(HUD(side, `${who}-bg`), parent, 'container', { width: HUD_BAR, height: 26, background: '#1f2937', cornerRadius: 13 }),
			element(HUD(side, `${who}-bar`), HUD(side, `${who}-bg`), 'container', { width: HUD_BAR, height: 26, background: color, cornerRadius: 13 })
		];
		const cluster = (who: 'me' | 'foe', color: string, align: 'left' | 'right'): Slot[] => [
			element(HUD(side, `${who}-box`), HUD(side, 'top'), 'container', { width: 360, height: 118, flexDirection: 'column', gap: 4, padding: 4 }),
			element(HUD(side, `${who}-name`), HUD(side, `${who}-box`), 'text', { text: '', height: 38, fontSize: 31, fontWeight: 'bold', textAlign: align, color }),
			...bar(who, color, HUD(side, `${who}-box`)),
			element(HUD(side, `${who}-hp`), HUD(side, `${who}-box`), 'text', { text: '', height: 34, fontSize: 28, textAlign: align, color: '#e5e7eb' })
		];
		return [
			createSlot({ id: root, name: `${team.name} HUD`, position: PARKED, components: [{ type: 'uiPanel', width: 1000, height: 270, worldWidth: 1.25, background: '#0a0620d9' }] }),
			element(HUD(side, 'top'), root, 'container', { width: 900, height: 120, flexDirection: 'row', gap: 6, margin: 4 }),
			...cluster('me', team.color, 'left'),
			element(HUD(side, 'mid'), HUD(side, 'top'), 'container', { width: 140, height: 112, flexDirection: 'column' }),
			element(HUD(side, 'score'), HUD(side, 'mid'), 'text', { text: '0 : 0', height: 76, fontSize: 64, fontWeight: 'bold', textAlign: 'center', color: '#ffffff' }),
			element(HUD(side, 'round'), HUD(side, 'mid'), 'text', { text: '', height: 34, fontSize: 25, fontWeight: 'bold', textAlign: 'center', color: '#fbbf24' }),
			...cluster('foe', TEAM[1 - side].color, 'right'),
			element(HUD(side, 'low'), root, 'container', { width: 900, height: 80, flexDirection: 'row', gap: 6, margin: 4 }),
			element(HUD(side, 'ammo'), HUD(side, 'low'), 'text', { text: '', width: 360, height: 80, fontSize: 46, fontWeight: 'bold', textAlign: 'left', color: '#facc15' }),
			element(HUD(side, 'place'), HUD(side, 'low'), 'text', { text: '', width: 140, height: 80, fontSize: 22, textAlign: 'center', color: '#a78bfa' }),
			element(HUD(side, 'shield'), HUD(side, 'low'), 'text', { text: '', width: 360, height: 80, fontSize: 32, fontWeight: 'bold', textAlign: 'right', color: '#22d3ee' })
		];
	});
}

/** The ids of a card's parts, which the script writes. */
export const CARD = (n: number, key: string): string => `rd-card-${n}-${key}`;

/**
 * The cards on offer after a round, as panels of their own: a coloured head with the name, the rarity, what it says in words and the lines of
 * numbers (green when good, red when not), and what to do.
 */
export function buildCards(): Slot[] {
	return Array.from({ length: POOLS.cards }, (_, n) => {
		const root = ID.card(n);
		return [
			createSlot({ id: root, name: 'Card', position: PARKED, components: [{ type: 'uiPanel', width: 440, height: 720, worldWidth: 1.2, background: '#0f0a2a' }] }),
			element(CARD(n, 'head'), root, 'container', { width: 392, height: 100, padding: 8, margin: 4, background: '#cbd5e1', cornerRadius: 28 }),
			element(CARD(n, 'name'), CARD(n, 'head'), 'text', { text: 'CARD', width: 372, height: 84, fontSize: 36, fontWeight: 'bold', textAlign: 'center', color: '#0b1020' }),
			element(CARD(n, 'art'), root, 'container', { width: 130, height: 130, padding: 8, margin: 4, background: '#cbd5e1', cornerRadius: 65 }),
			element(CARD(n, 'letter'), CARD(n, 'art'), 'text', { text: '?', width: 114, height: 114, fontSize: 84, fontWeight: 'bold', textAlign: 'center', color: '#0b1020' }),
			element(CARD(n, 'rarity'), root, 'text', { text: 'COMMON', height: 38, fontSize: 24, fontWeight: 'bold', textAlign: 'center', color: '#cbd5e1' }),
			element(CARD(n, 'text'), root, 'text', { text: '', width: 384, height: 100, fontSize: 27, textAlign: 'center', color: '#f5f3ff' }),
			...Array.from({ length: CARD_LINES }, (_, k) => element(CARD(n, `line${k}`), root, 'text', { text: '', width: 384, height: 38, fontSize: 30, fontWeight: 'bold', textAlign: 'center', color: '#4ade80' })),
			element(CARD(n, 'hint'), root, 'text', { text: 'SHOOT TO TAKE IT', height: 40, margin: 4, fontSize: 24, fontWeight: 'bold', textAlign: 'center', color: '#fbbf24' })
		];
	}).flat();
}

/** The numbers that float up from a hit (-55): small signs of text on no background, turned to whoever looks (`billboard`), that the script puts where the shot landed and lets rise. Their colour is written per hit. */
export function buildNumbers(): Slot[] {
	return Array.from({ length: POOLS.numbers }, (_, n) =>
		createSlot({
			id: ID.number(n),
			name: 'Damage Number',
			position: PARKED,
			scale: [0.9, 0.34, 1],
			components: [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#ffffff', unlit: true },
				{ type: 'textDisplay', title: '', lines: [''], background: '#00000000', titleColor: '#f87171', billboard: 'y', scale: 2.6, verticalAlign: 'middle' }
			]
		})
	);
}
