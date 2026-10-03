import type { Slot } from '../../ecs/types';
import { createSlot } from '../../ecs/types.ts';
import { BEAT_TURNTABLE, ui, uiPanel } from './beatTurntableParts.ts';
import { DECK } from './beatTurntableDesk.ts';

/** The panels of the Beat Turntable world: the score board above the lane, the hit feedback and the control screen. */

export const UI = {
	/** Width of the progress bar in px, and so of the fill at the end of the song. */
	trackWidth: 940,
	card: '#0f1830',
	cardBorder: '#2a3a78',
	label: '#8fa0d8',
	muted: '#94a3b8',
	accent: '#a78bfa'
} as const;

const card = (id: string, parentId: string, width: number) =>
	ui(id, parentId, 'container', { width, height: 172, flexDirection: 'column', padding: 6, background: UI.card, cornerRadius: 22, borderColor: UI.cardBorder, borderWidth: 3 });

const label = (id: string, parentId: string, text: string) =>
	ui(id, parentId, 'text', { text, height: 34, fontSize: 21, fontWeight: 'bold', textAlign: 'center', color: UI.label });

const value = (id: string, parentId: string, text: string, color = '#ffffff') =>
	ui(id, parentId, 'text', { text, height: 96, fontSize: 76, fontWeight: 'bold', textAlign: 'center', color });

const sub = (id: string, parentId: string, text: string, color: string) =>
	ui(id, parentId, 'text', { text, height: 34, fontSize: 22, fontWeight: 'bold', textAlign: 'center', color });

/**
 * The score board floats above the lane: score, combo with its multiplier and accuracy with the rank it is heading for, a progress
 * bar of the song and its title. After a song the same cards show the result (final score, best combo, rank).
 */
export function buildHud(): Slot[] {
	const root = BEAT_TURNTABLE.hudId;
	return [
		uiPanel(root, 'Score', [0, 2.8, BEAT_TURNTABLE.hudZ], 1040, 330, 3, '#070b18cc'),
		ui('bt-hud-row', root, 'container', { width: 948, height: 172, flexDirection: 'row', gap: 14 }),
		card('bt-hud-card-score', 'bt-hud-row', 400),
		label('bt-hud-score-label', 'bt-hud-card-score', 'SCORE'),
		value('bt-hud-score', 'bt-hud-card-score', '0'),
		sub('bt-hud-best', 'bt-hud-card-score', '', '#facc15'),
		card('bt-hud-card-combo', 'bt-hud-row', 270),
		label('bt-hud-combo-label', 'bt-hud-card-combo', 'COMBO'),
		value('bt-hud-combo', 'bt-hud-card-combo', '0'),
		sub('bt-hud-mult', 'bt-hud-card-combo', 'x1', '#ffffff'),
		card('bt-hud-card-acc', 'bt-hud-row', 250),
		label('bt-hud-detail-label', 'bt-hud-card-acc', 'ACCURACY'),
		value('bt-hud-detail', 'bt-hud-card-acc', '100%'),
		sub('bt-hud-rank', 'bt-hud-card-acc', '', '#4ade80'),
		ui('bt-hud-track', root, 'container', { width: UI.trackWidth, flexDirection: 'row', margin: 12, background: '#16213f', cornerRadius: 7 }),
		// An empty container has no height of its own, so the fill carries an invisible one-line child to hold its 14 px.
		ui('bt-hud-fill', 'bt-hud-track', 'container', { width: 0, flexDirection: 'column', background: UI.accent, cornerRadius: 7 }),
		ui('bt-hud-fill-pad', 'bt-hud-fill', 'text', { text: ' ', height: 14, fontSize: 8, color: '#00000000' }),
		ui('bt-hud-title', root, 'text', { text: 'Beat Turntable', height: 40, fontSize: 26, textAlign: 'center', color: '#cbd5e1' })
	];
}

/** The word that flashes in front of the player for a cut: PERFECT, GREAT, GOOD, BAD CUT or MISS. */
export function buildJudge(): Slot[] {
	return [
		uiPanel('bt-judge', 'Judgement', [0, 1.95, 5], 520, 120, 1.2, '#00000000'),
		ui('bt-judge-text', 'bt-judge', 'text', { text: '', width: 480, height: 90, fontSize: 64, fontWeight: 'bold', textAlign: 'center', color: '#ffffff' })
	];
}

const miniCard = (id: string, label: string, text: string) => [
	ui(`${id}-card`, 'bt-res-stats', 'container', { width: 225, height: 112, flexDirection: 'column', padding: 4, background: UI.card, cornerRadius: 18, borderColor: UI.cardBorder, borderWidth: 3 }),
	ui(`${id}-label`, `${id}-card`, 'text', { text: label, height: 30, fontSize: 18, fontWeight: 'bold', textAlign: 'center', color: UI.label }),
	ui(id, `${id}-card`, 'text', { text, height: 64, fontSize: 48, fontWeight: 'bold', textAlign: 'center', color: '#ffffff' })
];

/**
 * The result screen, in front of the player when a song ends (the script switches it on and off): a headline, the rank and the
 * final score, the numbers of the run, and where the score stands.
 */
export function buildResults(): Slot[] {
	const root = BEAT_TURNTABLE.resultsId;
	return [
		uiPanel(root, 'Results', [0, 1.85, 4.6], 960, 560, 2.2, '#070b18f5'),
		ui('bt-res-title', root, 'text', { text: 'SONG CLEARED', height: 64, fontSize: 48, fontWeight: 'bold', textAlign: 'center', color: '#facc15' }),
		ui('bt-res-song', root, 'text', { text: '', height: 34, fontSize: 24, textAlign: 'center', color: '#cbd5e1' }),
		ui('bt-res-hero', root, 'container', { width: 900, height: 192, margin: 8, flexDirection: 'row', gap: 14 }),
		ui('bt-res-rank-card', 'bt-res-hero', 'container', { width: 250, height: 192, flexDirection: 'column', padding: 4, background: UI.card, cornerRadius: 22, borderColor: UI.cardBorder, borderWidth: 3 }),
		ui('bt-res-rank-label', 'bt-res-rank-card', 'text', { text: 'RANK', height: 32, fontSize: 21, fontWeight: 'bold', textAlign: 'center', color: UI.label }),
		ui('bt-res-rank', 'bt-res-rank-card', 'text', { text: 'S', height: 150, fontSize: 128, fontWeight: 'bold', textAlign: 'center', color: '#facc15' }),
		ui('bt-res-score-card', 'bt-res-hero', 'container', { width: 636, height: 192, flexDirection: 'column', padding: 4, background: UI.card, cornerRadius: 22, borderColor: UI.cardBorder, borderWidth: 3 }),
		ui('bt-res-score-label', 'bt-res-score-card', 'text', { text: 'FINAL SCORE', height: 34, fontSize: 21, fontWeight: 'bold', textAlign: 'center', color: UI.label }),
		ui('bt-res-score', 'bt-res-score-card', 'text', { text: '0', height: 110, fontSize: 92, fontWeight: 'bold', textAlign: 'center', color: '#ffffff' }),
		ui('bt-res-best', 'bt-res-score-card', 'text', { text: '', height: 38, fontSize: 26, fontWeight: 'bold', textAlign: 'center', color: '#facc15' }),
		ui('bt-res-stats', root, 'container', { width: 900, height: 112, margin: 8, flexDirection: 'row', gap: 12 }),
		...miniCard('bt-res-acc', 'ACCURACY', '100%'),
		...miniCard('bt-res-combo', 'BEST COMBO', '0'),
		...miniCard('bt-res-cuts', 'BLOCKS CUT', '0'),
		...miniCard('bt-res-missed', 'MISSED', '0'),
		ui('bt-res-footer', root, 'text', { text: '', height: 40, fontSize: 22, textAlign: 'center', color: UI.muted })
	];
}

/** The screen above the turntable: title, what is going on, the difficulty buttons. `code` is the world's script. */
export function buildConsole(code: string): Slot[] {
	const root = BEAT_TURNTABLE.consoleId;
	const buttons: [string, string][] = [['bt-diff-easy', 'Easy'], ['bt-diff-normal', 'Normal'], ['bt-diff-hard', 'Hard']];
	return [
		createSlot({
			id: root,
			name: 'Beat Turntable Console',
			position: [DECK.x, 1.55, DECK.z + 0.5],
			components: [{ type: 'uiPanel', width: 680, height: 470, worldWidth: 1.15, background: '#0a0f22' }, { type: 'codeBlock', code }]
		}),
		ui('bt-title', root, 'text', { text: 'BEAT TURNTABLE', height: 62, fontSize: 46, fontWeight: 'bold', textAlign: 'center', color: '#c4b5fd' }),
		ui('bt-sub', root, 'text', { text: 'A rhythm game that listens to your records', height: 30, fontSize: 20, textAlign: 'center', color: '#64748b' }),
		ui('bt-status-card', root, 'container', { width: 600, height: 150, margin: 10, padding: 8, flexDirection: 'column', background: UI.card, cornerRadius: 20, borderColor: UI.cardBorder, borderWidth: 3 }),
		ui('bt-status', 'bt-status-card', 'text', { text: 'Place a disc on the turntable to play its song.', height: 130, fontSize: 28, fontWeight: 'bold', textAlign: 'center', color: '#f4f4f5' }),
		ui('bt-info', root, 'text', { text: 'Blue saber: left side. Red saber: right side.', height: 64, fontSize: 20, textAlign: 'center', color: UI.muted }),
		ui('bt-difficulty-row', root, 'container', { width: 600, height: 64, flexDirection: 'row', gap: 10 }),
		...buttons.map(([id, text]) =>
			ui(id, 'bt-difficulty-row', 'button', { width: 190, height: 60, text, fontSize: 26, fontWeight: 'bold', textAlign: 'center', cornerRadius: 18, background: id === 'bt-diff-normal' ? '#7c3aed' : '#1e293b' })
		)
	];
}
