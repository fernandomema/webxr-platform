import { Control, StackPanel, TextBlock } from '@babylonjs/gui';
import type { SceneGraph } from '../../sceneGraph';
import type { CodeBlockLogEntry } from '../../codeBlockRuntime';
import { createScrollPanel, sectionLabel } from './guiKit';

const MAX_MESSAGE_CHARS = 90;

function relativeTime(timestamp: number): string {
	const deltaMs = Date.now() - timestamp;
	if (deltaMs < 1000) return 'just now';
	if (deltaMs < 60_000) return `${Math.floor(deltaMs / 1000)}s ago`;
	if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
	return `${Math.floor(deltaMs / 3_600_000)}h ago`;
}

function truncate(message: string): string {
	return message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}…` : message;
}

/**
 * Live feed of a codeBlock's recent compile/hook errors and `ctx.log(...)`
 * calls (from codeBlockRuntime's per-slot ring buffer) — in-game debugging
 * for script authors, since there's no in-VR editor or devtools access.
 * Full untruncated messages still go to the browser console as before.
 */
export function mountCodeBlockDebug(container: StackPanel, sceneGraph: SceneGraph, slotId: string): { refresh(): void } {
	sectionLabel(container, 'Code Block — Debug Log');

	const { viewer, content } = createScrollPanel(`codeblock-debug-${slotId}`, '100%', '150px');
	container.addControl(viewer);

	let lastSignature = '';

	function render(entries: CodeBlockLogEntry[]): void {
		for (const child of [...content.children]) content.removeControl(child);

		if (entries.length === 0) {
			const empty = new TextBlock('', 'No errors or log output yet.');
			empty.color = '#6b7280';
			empty.fontSize = 13;
			empty.height = '22px';
			empty.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			content.addControl(empty);
			return;
		}

		for (const entry of [...entries].reverse()) {
			const line = new TextBlock('', `[${relativeTime(entry.timestamp)}] ${entry.hook}: ${truncate(entry.message)}`);
			line.color = entry.level === 'error' ? '#f87171' : '#d1d5db';
			line.fontSize = 13;
			line.height = '20px';
			line.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			line.textWrapping = false;
			content.addControl(line);
		}
	}

	function refresh(): void {
		const entries = sceneGraph.getCodeBlockDebugLog(slotId);
		const signature = entries.map((e) => `${e.timestamp}:${e.level}`).join('|');
		if (signature === lastSignature) return;
		lastSignature = signature;
		render(entries);
	}

	refresh();
	return { refresh };
}
