/**
 * The starter objects every player has, as data: a few folders and, per object, a function that builds its slots. The
 * `builtin` inventory adapter lists them read-only; spawning one (or opening it in the Studio) gives a copy to edit.
 * Objects that already have a generator are built from it (record discs, with their own title, author and colours).
 */
import type { Component, Slot, SlotTree } from '../../ecs/types';
import lobby from '../../xr/templates/lobby.json' with { type: 'json' };
import { buildDisc } from '../../xr/templates/recordDisc.ts';
import { PROP_ENTRIES, PROP_FOLDERS } from './props.ts';
import { TOOLS, toolEquippable } from '../../../../scripts/workshop-tools.mjs';

export interface BuiltinFolder {
	id: string;
	name: string;
}

export interface BuiltinEntry {
	id: string;
	folderId: string;
	name: string;
	/** A fresh tree on every call, so nobody shares (or edits) the catalog's own data. */
	build: () => SlotTree;
}

export const BUILTIN_FOLDERS: BuiltinFolder[] = [
	{ id: 'basics', name: 'Basics' },
	{ id: 'music', name: 'Music' },
	{ id: 'tools', name: 'Tools' },
	...PROP_FOLDERS
];

const slot = (id: string, name: string, components: Slot['components'], extra: Partial<Slot> = {}): Slot => ({
	id, parentId: null, name, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components, ...extra
});
const shape = (id: string, name: string, meshId: 'box' | 'sphere' | 'cylinder', color: string, scale: Slot['scale']): SlotTree => [
	slot(id, name, [
		{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: meshId }, color },
		{ type: 'collider', shape: 'box' },
		{ type: 'grabbable', scalable: true }
	], { scale })
];

const lobbySlots = lobby as unknown as SlotTree;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Build a workshop tool as a standalone Starter Kit object, preserving its model and behavior. */
function workshopTool(tool: (typeof TOOLS)[number]): SlotTree {
	const rootId = tool.id;
	const pieces = tool.parts as {
		name: string;
		mesh?: string;
		color?: string;
		collider?: boolean;
		textDisplay?: { title: string; lines: string[]; color: string };
		components?: unknown[];
		position?: Slot['position'];
		rotation?: Slot['rotation'];
		scale?: Slot['scale'];
	}[];
	const parts = pieces.map((piece, index) => slot(`${rootId}-part-${index}`, piece.name, ([
		...(piece.mesh ? [{ type: 'meshRenderer' as const, meshRef: { kind: 'builtin' as const, id: piece.mesh }, ...(piece.color ? { color: piece.color } : {}) }] : []),
		...(piece.collider ? [{ type: 'collider' as const, shape: 'box' as const }] : []),
		...(piece.textDisplay ? [{ type: 'textDisplay' as const, ...piece.textDisplay }] : []),
		...(piece.components ?? [])
	] as unknown as Component[]), {
		parentId: rootId,
		position: piece.position ?? [0, 0, 0],
		rotation: piece.rotation ?? [0, 0, 0, 1],
		scale: piece.scale ?? [1, 1, 1]
	}));
	return clone([
		slot(rootId, tool.name, ([{ type: 'container' }, { type: 'grabbable', scalable: false }, toolEquippable(), { type: 'codeBlock', code: tool.code }] as unknown as Component[])),
		...parts
	]);
}

/** An object that lives in the lobby, with its parts and what hangs from them, moved to the origin. */
function fromLobby(rootId: string): SlotTree {
	const wanted = new Set([rootId]);
	for (const entry of lobbySlots) if (entry.parentId && wanted.has(entry.parentId)) wanted.add(entry.id);
	return clone(lobbySlots.filter((entry) => wanted.has(entry.id))).map((entry) => (entry.id === rootId ? { ...entry, position: [0, 0, 0] as Slot['position'] } : entry));
}

/** A group of the lobby's loose slots (a record player is several) as one object under a new root, centred on `centre`. */
function groupFromLobby(id: string, name: string, include: (entry: Slot) => boolean, centre: [number, number]): SlotTree {
	const parts = clone(lobbySlots.filter(include)).map((entry) => ({
		...entry,
		parentId: entry.parentId ?? id,
		position: entry.parentId ? entry.position : [entry.position[0] - centre[0], entry.position[1], entry.position[2] - centre[1]] as Slot['position'],
		components: entry.components.map((component) => {
			if (component.type !== 'socket') return component;
			const { occupantId: _occupant, ...empty } = component;
			return empty;
		})
	}));
	return [slot(id, name, [{ type: 'container' }]), ...parts];
}

const SOURCES = {
	heartbeat: { kind: 'url' as const, url: '/audio/hampus-naeselius-remembering-a-heartbeat-epidemic-fantasy.mp3' },
	ambient: { kind: 'url' as const, url: '/audio/ambient1.mp3' }
};

const ENTRIES: BuiltinEntry[] = [
	...PROP_ENTRIES,
	{ id: 'cube', folderId: 'basics', name: 'Cube', build: () => shape('cube', 'Cube', 'box', '#8b7cf6', [0.3, 0.3, 0.3]) },
	{ id: 'sphere', folderId: 'basics', name: 'Sphere', build: () => shape('sphere', 'Sphere', 'sphere', '#38bdf8', [0.3, 0.3, 0.3]) },
	{ id: 'cylinder', folderId: 'basics', name: 'Cylinder', build: () => shape('cylinder', 'Cylinder', 'cylinder', '#f59e0b', [0.2, 0.3, 0.2]) },
	{
		id: 'sign', folderId: 'basics', name: 'Sign',
		build: () => [slot('sign', 'Sign', [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' }, color: '#1e1b4b' },
			{ type: 'textDisplay', title: 'Title', lines: ['Your text here'], color: '#1e1b4b', verticalAlign: 'middle' },
			{ type: 'grabbable', scalable: true }
		], { scale: [0.8, 0.5, 1] })]
	},
	{
		id: 'mirror', folderId: 'basics', name: 'Mirror',
		build: () => [slot('mirror', 'Mirror', [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' } },
			{ type: 'mirror', resolution: 1024 },
			{ type: 'grabbable', scalable: true }
		], { scale: [0.8, 1.2, 1] })]
	},
	{
		id: 'record-disc', folderId: 'music', name: 'Record Disc',
		build: () => buildDisc({ id: 'record-disc', title: 'Untitled', author: 'Unknown', labelColor: '#6366f1', source: { kind: 'url', url: '' } })
	},
	{
		id: 'disc-remembering-a-heartbeat', folderId: 'music', name: 'Disc: Remembering a Heartbeat',
		build: () => buildDisc({ id: 'disc-remembering-a-heartbeat', title: 'Remembering a Heartbeat', author: 'Hampus Naeselius', labelColor: '#9f1239', source: SOURCES.heartbeat })
	},
	{
		id: 'disc-ambient', folderId: 'music', name: 'Disc: Ambient',
		build: () => buildDisc({ id: 'disc-ambient', title: 'Ambient', author: 'Kithin', labelColor: '#0f766e', source: SOURCES.ambient })
	},
	{
		id: 'record-player', folderId: 'music', name: 'Record Player',
		build: () => groupFromLobby('record-player', 'Record Player', (entry) => entry.id.startsWith('lobby-jukebox'), [2.2, -2.0])
	},
	{
		id: 'disc-rack', folderId: 'music', name: 'Disc Rack',
		build: () => fromLobby('lobby-disc-rack')
	},
	{
		id: 'camera', folderId: 'tools', name: 'Camera',
		build: () => [
			slot('camera', 'Camera', [
				{ type: 'container' },
				{ type: 'grabbable', scalable: false },
				{ type: 'equippable', left: { position: [0, 0, 0.04], rotation: [0, 0, 0] }, right: { position: [0, 0, 0.04], rotation: [0, 0, 0] } }
			]),
			slot('camera-body', 'Camera Body', [
				{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color: '#1f2937' },
				{ type: 'collider', shape: 'box' }
			], { parentId: 'camera', scale: [0.16, 0.1, 0.07] }),
			// The lens is on the front (+Z) and the screen on the back: the picture is what the lens looks at.
			slot('camera-lens', 'Camera Lens', [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'cylinder' }, color: '#0b0b10' }], {
				parentId: 'camera', position: [0, 0, 0.05], rotation: [0.7071, 0, 0, 0.7071], scale: [0.05, 0.03, 0.05]
			}),
			slot('camera-screen', 'Camera Screen', [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' } }, { type: 'camera', resolution: 960 }], {
				parentId: 'camera', position: [0, 0, -0.036], scale: [0.14, 0.078, 1]
			})
		]
	},
	...TOOLS.map((tool) => ({ id: tool.id, folderId: 'tools', name: tool.name, build: () => workshopTool(tool) }))
];

/** Whatever is spawned from the kit can be picked up and moved by its root, so an object made of parts (a record player) is grabbed as one. */
function withGrabbableRoot(tree: SlotTree): SlotTree {
	const [root, ...rest] = tree;
	if (root.components.some((component) => component.type === 'grabbable')) return tree;
	return [{ ...root, components: [...root.components, { type: 'grabbable', scalable: true }] }, ...rest];
}

export const BUILTIN_ENTRIES: BuiltinEntry[] = ENTRIES.map((entry) => ({ ...entry, build: () => withGrabbableRoot(entry.build()) }));
