import type { Component } from '../../ecs/types';
import { BUILTIN_MESH_IDS } from '../../assets/ref.ts';

export type ComponentType = Component['type'];
export type ComponentGroup = 'Render' | 'Interaction' | 'Logic' | 'Media' | 'World';

interface FieldBase {
	key: string;
	label: string;
	help?: string;
	/** Only shown in Advanced mode. */
	advanced?: boolean;
	/** Optional fields can be cleared, which removes the key from the component. */
	optional?: boolean;
}

export type FieldDef = FieldBase &
	(
		| { kind: 'number'; min?: number; max?: number; step?: number; unit?: string; default?: number }
		| { kind: 'text'; multiline?: boolean; suggestions?: string[]; default?: string }
		| { kind: 'url'; default?: string }
		| { kind: 'bool'; default?: boolean }
		| { kind: 'color'; default?: string }
		| { kind: 'enum'; options: { value: string; label: string }[]; default?: string }
		| { kind: 'vec3'; step?: number; default?: [number, number, number] }
		| { kind: 'mesh' }
		| { kind: 'pose' }
		| { kind: 'lines' }
		| { kind: 'code' }
		| { kind: 'json' }
	);

export interface ComponentSchema {
	type: ComponentType;
	label: string;
	group: ComponentGroup;
	description: string;
	glyph: string;
	/** Hidden from the Simple-mode "Add component" list. */
	advanced?: boolean;
	fields: FieldDef[];
	create: () => Component;
}

export const DEFAULT_CODE = `// A code block returns event handlers.\nreturn {\n  onSpawn() {\n    ctx.log('Ready:', ctx.self.getSlot()?.name);\n  },\n  onGrab() {\n    ctx.log('Grabbed by', ctx.grab.heldBy());\n  },\n  tick(dt) {\n    // Use ctx.self, ctx.world, ctx.hierarchy and ctx.math here.\n  }\n};`;

export const COMPONENT_SCHEMAS: ComponentSchema[] = [
	{
		type: 'meshRenderer',
		label: 'Mesh Renderer',
		group: 'Render',
		description: 'Draw a built-in primitive shape or an already-imported model.',
		glyph: '◇',
		fields: [
			{ key: 'meshRef', label: 'Mesh', kind: 'mesh', help: `A built-in shape (${BUILTIN_MESH_IDS.join(', ')}) or a model already imported into this project. Models cannot be loaded from a URL.` },
			{ key: 'color', label: 'Color', kind: 'color', optional: true, default: '#8b7cf6' }
		],
		create: () => ({ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#8b7cf6' })
	},
	{
		type: 'textDisplay',
		label: 'Text Display',
		group: 'Render',
		description: 'Show a title and lines of text in the world.',
		glyph: 'T',
		fields: [
			{ key: 'title', label: 'Title', kind: 'text', optional: true, default: '' },
			{ key: 'lines', label: 'Lines', kind: 'lines' },
			{ key: 'color', label: 'Color', kind: 'color', optional: true, default: '#ffffff' }
		],
		create: () => ({ type: 'textDisplay', title: 'New label', lines: ['Edit this text'] })
	},
	{
		type: 'scoreboard',
		label: 'Scoreboard',
		group: 'Render',
		description: 'A table of players and scores driven by a code block.',
		glyph: '▤',
		advanced: true,
		fields: [
			{ key: 'title', label: 'Title', kind: 'text', optional: true, default: '' },
			{ key: 'status', label: 'Status line', kind: 'text', optional: true, default: '' },
			{ key: 'columns', label: 'Columns', kind: 'lines' },
			{ key: 'rows', label: 'Rows', kind: 'json', advanced: true }
		],
		create: () => ({ type: 'scoreboard', title: 'Scoreboard', columns: ['Score'], rows: [] })
	},
	{
		type: 'mirror',
		label: 'Mirror',
		group: 'Render',
		description: 'A reflective surface.',
		glyph: '◈',
		advanced: true,
		fields: [{ key: 'resolution', label: 'Resolution', kind: 'number', min: 64, max: 2048, step: 64, optional: true, default: 512 }],
		create: () => ({ type: 'mirror', resolution: 512 })
	},
	{
		type: 'collider',
		label: 'Collider',
		group: 'Interaction',
		description: 'Give the object a physical shape.',
		glyph: '◎',
		fields: [
			{
				key: 'shape',
				label: 'Shape',
				kind: 'enum',
				options: [
					{ value: 'box', label: 'Box' },
					{ value: 'sphere', label: 'Sphere' },
					{ value: 'mesh', label: 'Mesh' }
				]
			}
		],
		create: () => ({ type: 'collider', shape: 'box' })
	},
	{
		type: 'grabbable',
		label: 'Grabbable',
		group: 'Interaction',
		description: 'Let people pick this object up in XR.',
		glyph: '✦',
		fields: [{ key: 'scalable', label: 'Can be scaled', kind: 'bool', help: 'Allow two-handed grabs to resize it.' }],
		create: () => ({ type: 'grabbable', scalable: true })
	},
	{
		type: 'equippable',
		label: 'Equippable',
		group: 'Interaction',
		description: 'Can be equipped in a hand from the radial menu, and stays there after letting go. Needs Grabbable.',
		glyph: '✋',
		fields: [
			{ key: 'right', label: 'Right hand', kind: 'pose', help: 'Position (m) and rotation (°) relative to the controller grip.' },
			{ key: 'left', label: 'Left hand', kind: 'pose', help: 'Position (m) and rotation (°) relative to the controller grip.' }
		],
		create: () => ({
			type: 'equippable',
			right: { position: [0, 0, 0.05], rotation: [0, 0, 0] },
			left: { position: [0, 0, 0.05], rotation: [0, 0, 0] }
		})
	},
	{
		type: 'pressableButton',
		label: 'Pressable Button',
		group: 'Interaction',
		description: 'A button that runs code when pushed.',
		glyph: '▣',
		fields: [
			{ key: 'axis', label: 'Press direction', kind: 'vec3', step: 0.1 },
			{ key: 'travel', label: 'Travel', kind: 'number', min: 0, step: 0.01, unit: 'm' },
			{ key: 'radius', label: 'Touch radius', kind: 'number', min: 0, step: 0.01, unit: 'm' },
			{ key: 'threshold', label: 'Trigger at', kind: 'number', min: 0, max: 1, step: 0.05, optional: true, default: 1, advanced: true }
		],
		create: () => ({ type: 'pressableButton', axis: [0, -1, 0], travel: 0.08, radius: 0.12 })
	},
	{
		type: 'impactSound',
		label: 'Impact Sound',
		group: 'Media',
		description: 'A short generated sound for hits and clicks.',
		glyph: '◌',
		fields: [
			{ key: 'frequency', label: 'Pitch', kind: 'number', min: 0, max: 4000, step: 10, unit: 'Hz', optional: true, default: 220 },
			{ key: 'pitchDrop', label: 'Pitch drop', kind: 'number', min: 0, max: 4000, step: 10, unit: 'Hz', optional: true, default: 60, advanced: true },
			{ key: 'noiseMix', label: 'Noise', kind: 'number', min: 0, max: 1, step: 0.05, optional: true, default: 0.3 },
			{ key: 'durationMs', label: 'Duration', kind: 'number', min: 10, max: 5000, step: 10, unit: 'ms', optional: true, default: 200 },
			{ key: 'volume', label: 'Volume', kind: 'number', min: 0, max: 1, step: 0.05, optional: true, default: 1 }
		],
		create: () => ({ type: 'impactSound', frequency: 220, pitchDrop: 60, noiseMix: 0.3, durationMs: 200, volume: 1 })
	},
	{
		type: 'audioSource',
		label: 'Audio Source',
		group: 'Media',
		description: 'Marks this slot as a spatial audio emitter.',
		glyph: '◉',
		advanced: true,
		fields: [],
		create: () => ({ type: 'audioSource' })
	},
	{
		type: 'audioPlayer',
		label: 'Audio Player',
		group: 'Media',
		description: 'Play an audio file from a URL.',
		glyph: '◖',
		fields: [
			{ key: 'url', label: 'Audio URL', kind: 'url' },
			{ key: 'autoplay', label: 'Autoplay', kind: 'bool', optional: true, default: false },
			{ key: 'loop', label: 'Loop', kind: 'bool', optional: true, default: false },
			{ key: 'volume', label: 'Volume', kind: 'number', min: 0, max: 1, step: 0.05, optional: true, default: 1 }
		],
		create: () => ({ type: 'audioPlayer', url: '', loop: false, volume: 1 })
	},
	{
		type: 'videoPlayer',
		label: 'Video Player',
		group: 'Media',
		description: 'Play a video on the surface of this object.',
		glyph: '▶',
		fields: [
			{ key: 'url', label: 'Video URL', kind: 'url' },
			{ key: 'autoplay', label: 'Autoplay', kind: 'bool', optional: true, default: false },
			{ key: 'loop', label: 'Loop', kind: 'bool', optional: true, default: true },
			{ key: 'muted', label: 'Muted', kind: 'bool', optional: true, default: true },
			{ key: 'volume', label: 'Volume', kind: 'number', min: 0, max: 1, step: 0.05, optional: true, default: 1 }
		],
		create: () => ({ type: 'videoPlayer', url: '', autoplay: false, loop: true, muted: true, volume: 1 })
	},
	{
		type: 'codeBlock',
		label: 'Code Block',
		group: 'Logic',
		description: 'Attach a JavaScript behaviour.',
		glyph: '{}',
		advanced: true,
		fields: [{ key: 'code', label: 'Code', kind: 'code' }],
		create: () => ({ type: 'codeBlock', code: DEFAULT_CODE })
	},
	{
		type: 'scriptState',
		label: 'Script State',
		group: 'Logic',
		description: 'Shared data that scripts can read and write.',
		glyph: '≡',
		advanced: true,
		fields: [{ key: 'data', label: 'Data (JSON)', kind: 'json' }],
		create: () => ({ type: 'scriptState', data: { enabled: true } })
	},
	{
		type: 'velocity',
		label: 'Velocity',
		group: 'World',
		description: 'Keep the object moving at a steady speed.',
		glyph: '↗',
		fields: [
			{ key: 'linear', label: 'Speed', kind: 'vec3', step: 0.1, help: 'Units per second.' },
			{ key: 'drag', label: 'Drag', kind: 'number', min: 0, max: 1, step: 0.05, optional: true, default: 0.2 }
		],
		create: () => ({ type: 'velocity', linear: [0, 0, 0], drag: 0.2 })
	},
	{
		type: 'particleBurst',
		label: 'Particle Burst',
		group: 'World',
		description: 'A short burst of particles.',
		glyph: '✳',
		fields: [
			{ key: 'color', label: 'Color', kind: 'color', optional: true, default: '#a78bfa' },
			{ key: 'count', label: 'Count', kind: 'number', min: 1, max: 500, step: 1, optional: true, default: 24 },
			{ key: 'durationMs', label: 'Duration', kind: 'number', min: 100, max: 10000, step: 100, unit: 'ms', optional: true, default: 900 }
		],
		create: () => ({ type: 'particleBurst', color: '#a78bfa', count: 24, durationMs: 900 })
	},
	{
		type: 'expires',
		label: 'Expires',
		group: 'World',
		description: 'Remove this object at a set time.',
		glyph: '◷',
		advanced: true,
		fields: [{ key: 'expiresAt', label: 'Expires at', kind: 'number', step: 1000, help: 'Epoch milliseconds.' }],
		create: () => ({ type: 'expires', expiresAt: Date.now() + 60_000 })
	},
	{
		type: 'container',
		label: 'Container',
		group: 'World',
		description: 'Mark this slot as a reusable group.',
		glyph: '▱',
		advanced: true,
		fields: [],
		create: () => ({ type: 'container' })
	},
	{
		type: 'worldPortal',
		label: 'World Portal',
		group: 'World',
		description: 'A doorway into another world.',
		glyph: '◎',
		advanced: true,
		fields: [{ key: 'world', label: 'World package', kind: 'json', advanced: true }],
		create: () => ({ type: 'worldPortal', world: undefined as never })
	}
];

const BY_TYPE = new Map<ComponentType, ComponentSchema>(COMPONENT_SCHEMAS.map((schema) => [schema.type, schema]));

export const COMPONENT_GROUPS: ComponentGroup[] = ['Render', 'Interaction', 'Media', 'Logic', 'World'];

export function componentSchema(type: ComponentType): ComponentSchema {
	const schema = BY_TYPE.get(type);
	if (!schema) throw new Error(`No Studio schema for component type "${type}".`);
	return schema;
}

/** The components a person can add; Simple mode hides the technical ones and the ones that cannot be created blank. */
export function addableComponents(advanced: boolean): ComponentSchema[] {
	return COMPONENT_SCHEMAS.filter((schema) => schema.type !== 'worldPortal' && (advanced || !schema.advanced));
}
