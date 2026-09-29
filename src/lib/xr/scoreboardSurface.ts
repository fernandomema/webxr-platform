import type { AbstractMesh, Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Control, Grid, Rectangle, TextBlock } from '@babylonjs/gui';
import { findComponent, type ScoreboardComponent, type Slot } from '$lib/ecs/types';

export interface ScoreboardBinding {
	dispose(): void;
	sync(slot: Slot): void;
}

const BG = '#081029';
const HEADER_BG = '#132048';
const ROW_BG_A = '#152357';
const ROW_BG_B = '#1a2b66';
const HIGHLIGHT_BG = '#8a6d10';
const GOLD = '#facc15';
const GRID_WIDTH = 860;
const NAME_WIDTH = 200;
const ROW_HEIGHT = 42;

function cell(text: string, opts: { color?: string; bold?: boolean; align?: number } = {}): TextBlock {
	const t = new TextBlock('', text);
	t.color = opts.color ?? 'white';
	t.fontSize = 20;
	if (opts.bold) t.fontStyle = 'bold';
	t.textHorizontalAlignment = opts.align ?? Control.HORIZONTAL_ALIGNMENT_CENTER;
	return t;
}

function cellBackground(color: string): Rectangle {
	const r = new Rectangle('');
	r.thickness = 1;
	r.color = '#0b1330';
	r.background = color;
	return r;
}

/**
 * Renders a `scoreboard` component as a proper grid — header row + one row
 * per player, styled like an arcade/bowling-alley scoreboard (dark blue,
 * gold header, highlighted active row). Purely a function of component
 * data; all scoring logic lives in the codeBlock that writes it.
 */
export function setupScoreboard(scene: Scene, mesh: AbstractMesh, initial: ScoreboardComponent): ScoreboardBinding {
	const texture = AdvancedDynamicTexture.CreateForMesh(mesh, 960, 560, true);

	const background = new Rectangle('scoreboard-bg');
	background.width = 1;
	background.height = 1;
	background.thickness = 0;
	background.background = BG;
	texture.addControl(background);

	const title = new TextBlock('scoreboard-title', initial.title ?? 'Bowling');
	title.color = GOLD;
	title.fontSize = 40;
	title.fontStyle = 'bold';
	title.height = '56px';
	title.top = '18px';
	title.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	background.addControl(title);

	const status = new TextBlock('scoreboard-status', initial.status ?? '');
	status.color = 'white';
	status.fontSize = 24;
	status.height = '36px';
	status.top = '68px';
	status.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	background.addControl(status);

	let grid: Grid | null = null;

	function render(component: ScoreboardComponent): void {
		title.text = component.title ?? 'Bowling';
		status.text = component.status ?? '';

		if (grid) {
			background.removeControl(grid);
			grid.dispose();
			grid = null;
		}

		const cols = component.columns;
		const rows = component.rows;
		const cellWidth = Math.floor((GRID_WIDTH - NAME_WIDTH) / Math.max(cols.length, 1));

		const g = new Grid('scoreboard-grid');
		g.width = `${GRID_WIDTH}px`;
		g.height = `${(rows.length + 1) * ROW_HEIGHT}px`;
		g.top = '118px';
		g.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		g.addColumnDefinition(NAME_WIDTH, true);
		for (let i = 0; i < cols.length; i++) g.addColumnDefinition(cellWidth, true);
		g.addRowDefinition(ROW_HEIGHT, true);
		for (let i = 0; i < rows.length; i++) g.addRowDefinition(ROW_HEIGHT, true);

		g.addControl(cellBackground(HEADER_BG), 0, 0);
		g.addControl(cell('PLAYER', { color: GOLD, bold: true }), 0, 0);
		cols.forEach((col, i) => {
			g.addControl(cellBackground(HEADER_BG), 0, i + 1);
			g.addControl(cell(col, { color: GOLD, bold: true }), 0, i + 1);
		});

		rows.forEach((row, r) => {
			const rowIndex = r + 1;
			const baseBg = row.highlight ? HIGHLIGHT_BG : r % 2 === 0 ? ROW_BG_A : ROW_BG_B;

			g.addControl(cellBackground(baseBg), rowIndex, 0);
			const nameLabel = cell(`${row.isLeader ? '\u{1F3C6} ' : ''}${row.name}`, {
				align: Control.HORIZONTAL_ALIGNMENT_LEFT,
				bold: Boolean(row.highlight)
			});
			nameLabel.paddingLeft = '12px';
			g.addControl(nameLabel, rowIndex, 0);

			cols.forEach((_col, c) => {
				g.addControl(cellBackground(baseBg), rowIndex, c + 1);
				g.addControl(cell(row.cells[c] ?? ''), rowIndex, c + 1);
			});
		});

		background.addControl(g);
		grid = g;
	}

	render(initial);

	return {
		dispose: () => texture.dispose(),
		sync: (slot) => {
			const component = findComponent(slot, 'scoreboard');
			if (component) render(component);
		}
	};
}
