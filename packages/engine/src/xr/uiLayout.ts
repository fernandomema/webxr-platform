import type { Slot, SlotTree, UIElementComponent, UIPanelComponent } from '../ecs/types.ts';

/**
 * How a UI panel's elements are laid out, as plain numbers, so that nothing in a panel is cut off by accident.
 *
 * A panel draws its elements inside a margin (`PANEL_CONTENT_WIDTH` of its width, `PANEL_CONTENT_HEIGHT` of its height), one
 * container inside another, and what is wider than the box around it is cut off at the edge of that box. `layoutUiTree` works
 * out the widths the elements really get, shrinking whatever would not fit (a row's children share the room like CSS `flex-shrink`,
 * so text wraps in the room it has instead of being cut), and `uiLayoutIssues` says where an element asked for more room than it
 * had, so the author can fix the numbers instead of finding out on a headset.
 */
export const PANEL_CONTENT_WIDTH = 0.92;
/** The panel's own margin: 92% of its height, less the 4% of padding above. */
export const PANEL_CONTENT_HEIGHT = 0.88;

export interface UiLayoutNode {
	id: string;
	parentId: string | null;
	component: UIElementComponent;
}

export interface UiLayoutIssue {
	id: string;
	kind: 'too-wide' | 'too-tall';
	message: string;
}

export interface UiLayout {
	/** The width in pixels an element gets, when it asked for one. */
	widths: Map<string, number>;
	issues: UiLayoutIssue[];
}

const DEFAULT_HEIGHTS: Partial<Record<UIElementComponent['kind'], number>> = { button: 44, text: 36, input: 48, image: 120, video: 360, slider: 24, grid: 300 };

const isRow = (component: UIElementComponent) => component.flexDirection === 'row';
const marginOf = (component: UIElementComponent) => Math.max(0, component.margin ?? 0);

/** Elements that take part in the layout: hidden ones take no room, and one laid over the bottom of its parent is not in the flow. */
const inFlow = (component: UIElementComponent) => component.visible !== false && !component.overlayBottom;

export function layoutUiTree(nodes: readonly UiLayoutNode[], panel: Pick<UIPanelComponent, 'width' | 'height'>): UiLayout {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const childrenOf = new Map<string | null, UiLayoutNode[]>();
	for (const node of nodes) {
		const parent = node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
		childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), node]);
	}
	const widths = new Map<string, number>();
	const issues: UiLayoutIssue[] = [];

	const label = (node: UiLayoutNode) => `“${node.component.text?.slice(0, 24) || node.id}”`;
	const visibleChildren = (id: string | null) => (childrenOf.get(id) ?? []).filter((child) => inFlow(child.component));

	/** The height an element takes: the one it asked for (a container grows to its content when it did not ask for one). */
	function heightOf(node: UiLayoutNode): number {
		const { component } = node;
		if (component.height !== undefined) return component.height;
		if (component.kind !== 'container') return DEFAULT_HEIGHTS[component.kind] ?? 0;
		return contentHeight(node);
	}

	function contentHeight(node: UiLayoutNode): number {
		const kids = visibleChildren(node.id);
		const gap = (node.component.gap ?? 0) * Math.max(0, kids.length - 1);
		const pad = 2 * (node.component.padding ?? 0);
		if (isRow(node.component)) return pad + Math.max(0, ...kids.map((kid) => heightOf(kid) + (isRow(node.component) ? 0 : 2 * marginOf(kid.component))));
		return pad + gap + kids.reduce((sum, kid) => sum + heightOf(kid) + 2 * marginOf(kid.component), 0);
	}

	function place(node: UiLayoutNode, available: number): void {
		const { component } = node;
		let width = component.width;
		if (width !== undefined) {
			if (width > available) {
				issues.push({ id: node.id, kind: 'too-wide', message: `${label(node)} is ${width} px wide in ${Math.floor(available)} px of room` });
				width = Math.max(1, Math.floor(available));
			}
			widths.set(node.id, width);
		}
		if (component.kind !== 'container') return;

		const inner = Math.max(0, (width ?? available) - 2 * (component.padding ?? 0));
		const kids = visibleChildren(node.id);
		if (isRow(component) && kids.length > 0) {
			const gap = (component.gap ?? 0) * (kids.length - 1);
			const margins = kids.reduce((sum, kid) => sum + 2 * marginOf(kid.component), 0);
			const wanted = kids.reduce((sum, kid) => sum + (kid.component.width ?? 0), 0);
			const factor = wanted > 0 && wanted + gap + margins > inner ? Math.max(0, inner - gap - margins) / wanted : 1;
			if (factor < 1) issues.push({ id: node.id, kind: 'too-wide', message: `${label(node)}: its children are ${wanted + gap + margins} px across in ${Math.floor(inner)} px of room` });
			for (const kid of kids) place(kid, kid.component.width === undefined ? inner : Math.max(1, Math.floor(kid.component.width * factor)));
		} else {
			for (const kid of kids) place(kid, inner);
		}
		// Hidden elements and ones laid over their parent still get their own size, so showing them later does not change the layout.
		for (const kid of childrenOf.get(node.id) ?? []) if (!inFlow(kid.component) && !widths.has(kid.id)) place(kid, inner);

		if (component.height !== undefined) {
			const content = contentHeight(node);
			if (content > component.height) issues.push({ id: node.id, kind: 'too-tall', message: `${label(node)} is ${component.height} px tall and what is in it is ${content} px` });
		}
	}

	const rootWidth = panel.width * PANEL_CONTENT_WIDTH;
	const roots = visibleChildren(null);
	for (const root of roots) place(root, rootWidth);
	for (const root of childrenOf.get(null) ?? []) if (!inFlow(root.component) && !widths.has(root.id)) place(root, rootWidth);
	const total = roots.reduce((sum, root) => sum + heightOf(root) + 2 * marginOf(root.component), 0);
	if (total > panel.height * PANEL_CONTENT_HEIGHT) issues.push({ id: roots[0]?.id ?? 'panel', kind: 'too-tall', message: `the panel's content is ${total} px tall in ${Math.floor(panel.height * PANEL_CONTENT_HEIGHT)} px of room` });
	return { widths, issues };
}

/** Where an element asked for more room than it has. Empty when the panel's numbers fit. */
export function uiLayoutIssues(nodes: readonly UiLayoutNode[], panel: Pick<UIPanelComponent, 'width' | 'height'>): UiLayoutIssue[] {
	return layoutUiTree(nodes, panel).issues;
}

/** The UI elements of the panel `root` (a slot with a `uiPanel`), as layout nodes, found by walking down the slot tree. */
export function uiNodesOf(scene: readonly Slot[], rootId: string): UiLayoutNode[] {
	const nodes: UiLayoutNode[] = [];
	const visit = (parentId: string) => {
		for (const slot of scene) {
			if (slot.parentId !== parentId) continue;
			const component = slot.components.find((candidate) => candidate.type === 'uiElement');
			if (component) nodes.push({ id: slot.id, parentId, component });
			visit(slot.id);
		}
	};
	visit(rootId);
	return nodes;
}

/** Every layout problem of every UI panel of a scene, for the Studio and for tests. */
export function lintUiPanels(scene: SlotTree): Array<UiLayoutIssue & { panelId: string }> {
	const found: Array<UiLayoutIssue & { panelId: string }> = [];
	for (const slot of scene) {
		const panel = slot.components.find((component) => component.type === 'uiPanel');
		if (!panel) continue;
		for (const issue of uiLayoutIssues(uiNodesOf(scene, slot.id), panel)) found.push({ ...issue, panelId: slot.id });
	}
	return found;
}
