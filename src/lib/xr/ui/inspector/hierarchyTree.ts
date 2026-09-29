import { Button, Control, StackPanel } from '@babylonjs/gui';
import type { SceneGraph } from '../../sceneGraph';
import { spacer } from './guiKit';

export interface HierarchyTreeCallbacks {
	getSelectedId(): string | null;
	isReparentMode(): boolean;
	onSelectRow(slotId: string): void;
}

const INDENT_PX = 18;
const TOGGLE_WIDTH_PX = 22;
const ROW_HEIGHT = '34px';

/**
 * Mounts a collapsible tree of every non-system Slot into `content` (meant
 * to sit inside a ScrollViewer — see guiKit.createScrollPanel). Depth is
 * real layout width (a spacer control), not text characters prepended to
 * the label, so it reliably reads as a hierarchy regardless of font/DPI.
 * Each branch with children can be collapsed independently, so a deep tree
 * stays navigable instead of dumping every descendant into one flat list.
 *
 * Reusable: takes only a SceneGraph and plain callbacks, no inspector-panel
 * state leaks in here.
 */
export function createHierarchyTree(content: StackPanel, sceneGraph: SceneGraph, availableWidthPx: number, callbacks: HierarchyTreeCallbacks) {
	const collapsedIds = new Set<string>();

	function refresh(): void {
		for (const child of [...content.children]) content.removeControl(child);

		const renderBranch = (parentId: string | null, depth: number) => {
			const children = sceneGraph.getChildren(parentId).sort((a, b) => a.slot.name.localeCompare(b.slot.name));
			for (const { slot: s } of children) {
				const hasChildren = sceneGraph.getChildren(s.id).length > 0;
				const isCollapsed = collapsedIds.has(s.id);
				const indentPx = depth * INDENT_PX;

				const line = new StackPanel(`tree-line-${s.id}`);
				line.isVertical = false;
				line.height = ROW_HEIGHT;
				line.paddingTop = '1px';
				content.addControl(line);

				if (indentPx > 0) line.addControl(spacer(indentPx, ROW_HEIGHT));

				const toggle = Button.CreateSimpleButton(`tree-toggle-${s.id}`, hasChildren ? (isCollapsed ? '▸' : '▾') : '');
				toggle.width = `${TOGGLE_WIDTH_PX}px`;
				toggle.height = ROW_HEIGHT;
				toggle.color = '#9ca3af';
				toggle.thickness = 0;
				toggle.fontSize = 14;
				toggle.isEnabled = hasChildren;
				toggle.onPointerClickObservable.add(() => {
					if (isCollapsed) collapsedIds.delete(s.id);
					else collapsedIds.add(s.id);
					refresh();
				});
				line.addControl(toggle);

				const selected = callbacks.getSelectedId() === s.id;
				const inReparentMode = callbacks.isReparentMode();
				const nameWidthPx = Math.max(availableWidthPx - indentPx - TOGGLE_WIDTH_PX, 60);
				const nameBtn = Button.CreateSimpleButton(`tree-name-${s.id}`, s.name);
				nameBtn.width = `${nameWidthPx}px`;
				nameBtn.height = ROW_HEIGHT;
				nameBtn.color = 'white';
				nameBtn.background = selected ? '#2563eb' : inReparentMode ? '#78350f' : '#1f2937';
				nameBtn.cornerRadius = 6;
				nameBtn.textBlock!.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
				nameBtn.textBlock!.paddingLeft = '8px';
				nameBtn.textBlock!.textWrapping = false;
				nameBtn.onPointerClickObservable.add(() => callbacks.onSelectRow(s.id));
				line.addControl(nameBtn);

				if (!isCollapsed) renderBranch(s.id, depth + 1);
			}
		};
		renderBranch(null, 0);
	}

	return { refresh };
}
