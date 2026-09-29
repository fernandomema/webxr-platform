import type { Component, Slot, SlotTree, Vec3 } from '$lib/ecs/types';
import { createSlot } from '$lib/ecs/types';

export type StudioView = 'assets' | 'scene' | 'code' | 'raw';
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface CodeDiagnostic {
	severity: DiagnosticSeverity;
	message: string;
	line: number;
}

export interface ComponentDefinition {
	type: Component['type'];
	label: string;
	group: 'Render' | 'Interaction' | 'Logic' | 'Media' | 'World';
	description: string;
	create: () => Component;
}

export const COMPONENT_DEFINITIONS: ComponentDefinition[] = [
	{
		type: 'meshRenderer',
		label: 'Mesh Renderer',
		group: 'Render',
		description: 'Draw a primitive or an asset URL.',
		create: () => ({ type: 'meshRenderer', meshRef: 'box', color: '#8b7cf6' })
	},
	{
		type: 'textDisplay',
		label: 'Text Display',
		group: 'Render',
		description: 'Show a title and lines in-world.',
		create: () => ({ type: 'textDisplay', title: 'New label', lines: ['Edit this text'] })
	},
	{
		type: 'collider',
		label: 'Collider',
		group: 'Interaction',
		description: 'Give the object a physical interaction shape.',
		create: () => ({ type: 'collider', shape: 'box' })
	},
	{
		type: 'grabbable',
		label: 'Grabbable',
		group: 'Interaction',
		description: 'Allow the object to be grabbed in XR.',
		create: () => ({ type: 'grabbable', scalable: true })
	},
	{
		type: 'pressableButton',
		label: 'Pressable Button',
		group: 'Interaction',
		description: 'Trigger code when the button is pressed.',
		create: () => ({ type: 'pressableButton', axis: [0, -1, 0], travel: 0.08, radius: 0.12 })
	},
	{
		type: 'codeBlock',
		label: 'Code Block',
		group: 'Logic',
		description: 'Attach a bounded JavaScript behaviour.',
		create: () => ({ type: 'codeBlock', code: DEFAULT_CODE })
	},
	{
		type: 'scriptState',
		label: 'Script State',
		group: 'Logic',
		description: 'Store shared JSON state for scripts.',
		create: () => ({ type: 'scriptState', data: { enabled: true } })
	},
	{
		type: 'velocity',
		label: 'Velocity',
		group: 'World',
		description: 'Apply host-authoritative motion.',
		create: () => ({ type: 'velocity', linear: [0, 0, 0], drag: 0.2 })
	},
	{
		type: 'particleBurst',
		label: 'Particle Burst',
		group: 'World',
		description: 'Spawn a short procedural effect.',
		create: () => ({ type: 'particleBurst', color: '#a78bfa', count: 24, durationMs: 900 })
	},
	{
		type: 'audioPlayer',
		label: 'Audio Player',
		group: 'Media',
		description: 'Play an audio URL.',
		create: () => ({ type: 'audioPlayer', url: '', loop: false, volume: 1 })
	},
	{
		type: 'videoPlayer',
		label: 'Video Player',
		group: 'Media',
		description: 'Play video on a mesh surface.',
		create: () => ({ type: 'videoPlayer', url: '', autoplay: false, loop: true, muted: true, volume: 1 })
	},
	{
		type: 'container',
		label: 'Container',
		group: 'World',
		description: 'Mark a slot as a reusable hierarchy container.',
		create: () => ({ type: 'container' })
	}
];

export const DEFAULT_CODE = `// A code block returns event handlers.\nreturn {\n  onSpawn() {\n    ctx.log('Ready:', ctx.self.getSlot()?.name);\n  },\n  onGrab() {\n    ctx.log('Grabbed by', ctx.grab.heldBy());\n  },\n  tick(dt) {\n    // Use ctx.self, ctx.world, ctx.hierarchy and ctx.math here.\n  }\n};`;

export function starterTree(name = 'Untitled asset'): SlotTree {
	const root = createSlot({
		name,
		components: [
			{ type: 'meshRenderer', meshRef: 'box', color: '#8b7cf6' },
			{ type: 'collider', shape: 'box' },
			{ type: 'grabbable', scalable: true }
		]
	});
	return [root];
}

export function cloneTree(tree: SlotTree): SlotTree {
	// SlotTree is deliberately JSON data. JSON cloning also unwraps Svelte 5
	// reactive proxies, which cannot be passed to structuredClone directly.
	return JSON.parse(JSON.stringify(tree)) as SlotTree;
}

export function treeStats(tree: SlotTree) {
	return {
		slots: tree.length,
		components: tree.reduce((total, slot) => total + slot.components.length, 0),
		codeBlocks: tree.filter((slot) => slot.components.some((component) => component.type === 'codeBlock')).length
	};
}

export function componentDefinition(type: Component['type']): ComponentDefinition {
	return COMPONENT_DEFINITIONS.find((definition) => definition.type === type) ?? COMPONENT_DEFINITIONS[0];
}

export function componentGlyph(type: Component['type']): string {
	return {
		meshRenderer: '◇',
		textDisplay: 'T',
		scoreboard: '▤',
		collider: '◎',
		grabbable: '✦',
		pressableButton: '▣',
		codeBlock: '{}',
		scriptState: '≡',
		velocity: '↗',
		particleBurst: '✳',
		audioPlayer: '◖',
		videoPlayer: '▶',
		container: '▱',
		mirror: '◈',
		audioSource: '◉',
		expires: '◷',
		impactSound: '◌'
	}[type];
}

export function lintCode(code: string): CodeDiagnostic[] {
	const diagnostics: CodeDiagnostic[] = [];
	const lines = code.split('\n');
	const pairs: Array<[string, string]> = [['{', '}'], ['(', ')'], ['[', ']']];
	for (const [open, close] of pairs) {
		const opened = (code.match(new RegExp(`\\${open}`, 'g')) ?? []).length;
		const closed = (code.match(new RegExp(`\\${close}`, 'g')) ?? []).length;
		if (opened !== closed) diagnostics.push({ severity: 'error', message: `Unbalanced ${open}${close} pair.`, line: lines.length });
	}
	if (!/return\s*\{/.test(code)) diagnostics.push({ severity: 'warning', message: 'Return an object to expose event handlers.', line: 1 });
	if (!/(onSpawn|onGrab|onRelease|onPress|tick|getRadialItems)\s*\(/.test(code)) diagnostics.push({ severity: 'info', message: 'Add at least one lifecycle handler to make this block active.', line: 1 });
	if (code.includes('document.') || code.includes('window.') || code.includes('fetch(')) diagnostics.push({ severity: 'warning', message: 'Prefer the bounded ctx API inside a code block.', line: lines.findIndex((line) => /document\.|window\.|fetch\(/.test(line)) + 1 });
	return diagnostics;
}

export function componentFieldEntries(component: Component): Array<[string, unknown]> {
	return Object.entries(component).filter(([key]) => key !== 'type');
}

export interface TreeRow {
	slot: Slot;
	depth: number;
}

/**
 * Flattens a SlotTree into real depth-first hierarchy order (every parent
 * immediately followed by its whole subtree) with an accurate `depth` per
 * row — the scene-graph list previously just iterated storage order with a
 * `parentId ? 1 : 0` depth, so a grandchild rendered at the same
 * indentation as a direct child, and rows weren't even grouped under their
 * parent. A slot whose parentId doesn't resolve inside this tree (a
 * fragment pasted without its root, for example) still renders — as its
 * own root — instead of silently disappearing.
 */
export function flattenTree(tree: SlotTree): TreeRow[] {
	const byParent = new Map<string | null, Slot[]>();
	for (const slot of tree) {
		const list = byParent.get(slot.parentId) ?? [];
		list.push(slot);
		byParent.set(slot.parentId, list);
	}

	const rows: TreeRow[] = [];
	const visited = new Set<string>();
	const visit = (parentId: string | null, depth: number) => {
		for (const slot of byParent.get(parentId) ?? []) {
			if (visited.has(slot.id)) continue;
			visited.add(slot.id);
			rows.push({ slot, depth });
			visit(slot.id, depth + 1);
		}
	};
	visit(null, 0);
	for (const slot of tree) {
		if (!visited.has(slot.id)) {
			visited.add(slot.id);
			rows.push({ slot, depth: 0 });
		}
	}
	return rows;
}

export function serializeSlotTree(tree: SlotTree): string {
	return JSON.stringify(tree, null, 2);
}

/**
 * Parses pasted/edited raw JSON into a SlotTree for the Studio's "Raw"
 * editor — this is where a whole subtree exported from the live game (the
 * shape `extractSubtree`/`SceneGraph.serialize()` produce: a flat array,
 * root first, descendants linked via parentId) gets pasted back in as one
 * asset. Validates just enough of each Slot's shape to catch a bad paste
 * without silently corrupting the asset; doesn't try to fix broken
 * parentId references (unresolvable ones simply render outside the tree).
 */
export function parseSlotTreeJSON(text: string): { tree: SlotTree } | { error: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		return { error: err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON.' };
	}

	// A single copied Slot object (not wrapped in an array) is a common paste too.
	const candidates = Array.isArray(parsed) ? parsed : [parsed];
	if (candidates.length === 0) return { error: 'Paste at least one slot.' };

	const tree: Slot[] = [];
	for (let i = 0; i < candidates.length; i++) {
		const raw = candidates[i] as Record<string, unknown>;
		if (typeof raw !== 'object' || raw === null) return { error: `Slot ${i} is not an object.` };
		if (typeof raw.id !== 'string' || !raw.id) return { error: `Slot ${i} is missing a string "id".` };
		if (typeof raw.name !== 'string') return { error: `Slot ${i} ("${raw.id}") is missing a string "name".` };
		if (raw.parentId !== null && typeof raw.parentId !== 'string') {
			return { error: `Slot ${i} ("${raw.id}") has an invalid "parentId" — must be a string or null.` };
		}
		if (!isVec3(raw.position)) return { error: `Slot ${i} ("${raw.id}") has an invalid "position" — must be [x, y, z].` };
		if (!isQuat(raw.rotation)) return { error: `Slot ${i} ("${raw.id}") has an invalid "rotation" — must be [x, y, z, w].` };
		if (!isVec3(raw.scale)) return { error: `Slot ${i} ("${raw.id}") has an invalid "scale" — must be [x, y, z].` };
		if (!Array.isArray(raw.components)) return { error: `Slot ${i} ("${raw.id}") is missing a "components" array.` };
		for (const [ci, component] of (raw.components as unknown[]).entries()) {
			if (typeof component !== 'object' || component === null || typeof (component as { type?: unknown }).type !== 'string') {
				return { error: `Slot ${i} ("${raw.id}"), component ${ci} is missing a string "type".` };
			}
		}
		tree.push(raw as unknown as Slot);
	}

	const ids = new Set(tree.map((slot) => slot.id));
	if (ids.size !== tree.length) return { error: 'Duplicate slot ids — every slot needs a unique id.' };

	return { tree };
}

function isVec3(value: unknown): value is Vec3 {
	return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number');
}

function isQuat(value: unknown): value is [number, number, number, number] {
	return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number');
}
