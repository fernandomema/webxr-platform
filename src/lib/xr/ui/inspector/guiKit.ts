import { Button, Control, Rectangle, ScrollViewer, StackPanel, TextBlock } from '@babylonjs/gui';

/**
 * Small, reusable GUI building blocks shared by the hierarchy tree and the
 * detail panel. Nothing here knows about Slots/SceneGraph — it only knows
 * how to lay out Babylon GUI controls, so it can be reused by any future
 * in-VR panel.
 */

/** A StackPanel wrapped in a ScrollViewer — content that grows past its
 * column now scrolls instead of being silently clipped (the bug where long
 * component/detail lists got cut off with no way to reach the rest). */
export function createScrollPanel(name: string, width: string, height: string): { viewer: ScrollViewer; content: StackPanel } {
	const viewer = new ScrollViewer(`${name}-viewer`);
	viewer.width = width;
	viewer.height = height;
	viewer.thickness = 0;
	viewer.barColor = '#4b5563';
	viewer.barBackground = 'transparent';
	viewer.barSize = 8;
	viewer.wheelPrecision = 40;

	const content = new StackPanel(`${name}-content`);
	content.width = '100%';
	content.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	content.adaptHeightToChildren = true;
	viewer.addControl(content);

	return { viewer, content };
}

export function clearContainer(container: StackPanel): void {
	for (const child of [...container.children]) container.removeControl(child);
}

export function sectionLabel(container: StackPanel, text: string): void {
	const t = new TextBlock('', text);
	t.color = '#9ca3af';
	t.fontSize = 16;
	t.height = '26px';
	t.top = '6px';
	t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	container.addControl(t);
}

export function row(container: StackPanel, label?: string): StackPanel {
	const r = new StackPanel(`row-${Math.random()}`);
	r.isVertical = false;
	r.height = '40px';
	r.paddingTop = '2px';
	if (label) {
		const t = new TextBlock('', label);
		t.color = '#9ca3af';
		t.width = '90px';
		t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		r.addControl(t);
	}
	container.addControl(r);
	return r;
}

export function stepButton(text: string, onClick: () => void): Button {
	const btn = Button.CreateSimpleButton(`step-${Math.random()}`, text);
	btn.width = '36px';
	btn.height = '36px';
	btn.color = 'white';
	btn.background = '#374151';
	btn.cornerRadius = 6;
	btn.onPointerClickObservable.add(onClick);
	return btn;
}

export function numberStepper(container: StackPanel, label: string, step: number, get: () => number, set: (v: number) => void): void {
	const r = row(container, label);
	const valueText = new TextBlock('', get().toFixed(2));
	valueText.color = 'white';
	valueText.width = '60px';
	const refresh = () => (valueText.text = get().toFixed(2));

	r.addControl(stepButton('-', () => (set(get() - step), refresh())));
	r.addControl(valueText);
	r.addControl(stepButton('+', () => (set(get() + step), refresh())));
}

export function toggleRow(container: StackPanel, label: string, get: () => boolean, onClick: () => void): void {
	const r = row(container, label);
	const btn = Button.CreateSimpleButton('', get() ? 'Yes' : 'No');
	btn.width = '70px';
	btn.height = '36px';
	btn.color = 'white';
	btn.background = get() ? '#16a34a' : '#374151';
	btn.onPointerClickObservable.add(() => {
		onClick();
		btn.textBlock!.text = get() ? 'Yes' : 'No';
		btn.background = get() ? '#16a34a' : '#374151';
	});
	r.addControl(btn);
}

/**
 * Packs fixed-width items left-to-right and wraps onto a new line once
 * `maxWidthPx` would be exceeded. Plain StackPanel rows never wrap, which is
 * what was clipping the Components badges and the per-folder Save buttons
 * whenever there were more of them than fit on one line.
 */
export function createWrapPanel(container: StackPanel, maxWidthPx: number, lineHeight = '34px'): { addItem(control: Control, widthPx: number): void } {
	let currentLine: StackPanel | null = null;
	let usedWidth = 0;

	function newLine(): StackPanel {
		const line = new StackPanel(`wrap-line-${Math.random()}`);
		line.isVertical = false;
		line.height = lineHeight;
		line.paddingTop = '4px';
		line.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		container.addControl(line);
		usedWidth = 0;
		return line;
	}

	return {
		addItem(control, widthPx) {
			if (!currentLine || usedWidth + widthPx > maxWidthPx) {
				currentLine = newLine();
			}
			currentLine.addControl(control);
			usedWidth += widthPx;
		}
	};
}

/** A fixed-width, invisible spacer — used to indent tree rows with real layout space instead of prepended text characters. */
export function spacer(widthPx: number, heightPx: string): Rectangle {
	const r = new Rectangle(`spacer-${Math.random()}`);
	r.width = `${widthPx}px`;
	r.height = heightPx;
	r.thickness = 0;
	return r;
}
