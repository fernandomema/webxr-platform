import { expandFragments, type FragmentData } from '../assets/fragment.ts';
import type { AssetId } from '../assets/ref.ts';
import type { Slot, SlotTree } from '../ecs/types.ts';
import { compose, multiply, transformDirection, transformPoint } from '../lighting/matrix.ts';
import { worldBounds } from '../lighting/primitives.ts';
import type { Mat4, PrimitiveShape, V3 } from '../lighting/types.ts';
import { lintUiPanels } from '../xr/uiLayout.ts';

/**
 * Checks of a world that need no browser and no headset, run by `kithin-game check` and by tests: things that are wrong in the data and
 * that an author would otherwise find out by standing in the world. Each finding names its rule, the slot and what to change.
 */
export type LintSeverity = 'error' | 'warning';

export interface LintFinding {
	rule: 'ui-layout' | 'text-faces-away' | 'text-too-high' | 'text-grazing' | 'panel-out-of-reach';
	severity: LintSeverity;
	slotId: string;
	message: string;
}

export interface LintOptions {
	/** Where a player's eyes are when they arrive, in world coordinates. Defaults to the world's `spawnPoint` slots (1.6 m up) or, with none, where the engine puts a player: (0, 1.6, 2). */
	viewpoints?: V3[];
	/** Fragments to build into the world before looking (by asset id). */
	fragments?: (assetId: AssetId) => FragmentData | undefined;
	/** How far from a viewpoint a sign is expected to be read (20 m). Farther ones are not judged. */
	readRange?: number;
	/** The highest an interactive panel may float above the floor under it (3 m), the reach of a raised arm. */
	reach?: number;
}

const DEFAULT_VIEWPOINT: V3 = [0, 1.6, 2];
const EYE_HEIGHT = 1.6;
const FLOOR_SHAPES = new Set(['box', 'ground', 'plane', 'disc', 'cylinder']);

const unit = (v: V3): V3 => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const deg = (rad: number) => Math.round((rad * 180) / Math.PI);

/** Every problem the world's data has that can be told without running it. */
export function lintWorld(source: SlotTree, options: LintOptions = {}): LintFinding[] {
	const tree = options.fragments ? expandFragments(source, options.fragments, { onlyEnabled: true }) : source;
	const findings: LintFinding[] = [];
	const byId = new Map(tree.map((slot) => [slot.id, slot]));

	for (const issue of lintUiPanels(source)) findings.push({ rule: 'ui-layout', severity: 'error', slotId: issue.id, message: `${issue.message} (panel ${issue.panelId})` });

	const worlds = new Map<string, Mat4 | null>();
	const worldOf = (slot: Slot): Mat4 | null => {
		if (worlds.has(slot.id)) return worlds.get(slot.id) ?? null;
		worlds.set(slot.id, null);
		const parent = slot.parentId ? byId.get(slot.parentId) : undefined;
		const parentWorld = parent ? worldOf(parent) : null;
		if ((parent && !parentWorld) || slot.disabled) return null;
		const local = compose(slot.position, slot.rotation, slot.scale);
		const result = parentWorld ? multiply(local, parentWorld) : local;
		worlds.set(slot.id, result);
		return result;
	};

	const viewpoints: V3[] = options.viewpoints ?? (() => {
		const spawns = tree.filter((slot) => slot.components.some((c) => c.type === 'spawnPoint')).map(worldOf).filter((m): m is Mat4 => !!m).map((m) => { const p = transformPoint(m, [0, 0, 0]); return [p[0], p[1] + EYE_HEIGHT, p[2]] as V3; });
		return spawns.length ? spawns : [DEFAULT_VIEWPOINT];
	})();
	const readRange = options.readRange ?? 20;
	const reach = options.reach ?? 3;

	// The floors: boxes, grounds and discs a player can stand on, as boxes in the world, to find what is under a panel.
	const floors: Array<{ min: V3; max: V3 }> = [];
	for (const slot of tree) {
		const mesh = slot.components.find((c) => c.type === 'meshRenderer');
		if (!mesh || mesh.type !== 'meshRenderer' || mesh.meshRef.kind !== 'builtin' || !FLOOR_SHAPES.has(mesh.meshRef.id) || !slot.components.some((c) => c.type === 'collider') && mesh.meshRef.id !== 'ground' && mesh.meshRef.id !== 'disc') continue;
		const m = worldOf(slot);
		if (m) floors.push(worldBounds(mesh.meshRef.id as PrimitiveShape, m));
	}
	const floorUnder = (p: V3): number | null => {
		let best: number | null = null;
		for (const f of floors) if (p[0] >= f.min[0] && p[0] <= f.max[0] && p[2] >= f.min[2] && p[2] <= f.max[2] && f.max[1] <= p[1] + 0.05 && (best === null || f.max[1] > best)) best = f.max[1];
		return best;
	};

	for (const slot of tree) {
		const text = slot.components.find((c) => c.type === 'textDisplay');
		const panel = slot.components.find((c) => c.type === 'uiPanel');
		if (!text && !panel) continue;
		const m = worldOf(slot);
		if (!m) continue;
		const center = transformPoint(m, [0, 0, 0]);
		const label = text ? 'The sign' : 'The panel';
		const facesViewer = text ? text.billboard !== 'y' && text.billboard !== 'full' : true;

		const reported = new Set<string>();
		for (const eye of viewpoints) {
			const toEye: V3 = [eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]];
			const distance = Math.hypot(...toEye);
			if (distance > readRange || distance < 1e-6) continue;
			const forward = unit(transformDirection(m, [0, 0, 1]));
			// A plane is read from its −Z side: its +Z must point away from the viewer.
			const cosView = facesViewer ? -dot(forward, toEye) / distance : 1;
			const where = `from the player's start at (${eye.map((v) => Math.round(v * 10) / 10).join(', ')})`;
			if (cosView < 0 && !reported.has('away')) {
				reported.add('away');
				findings.push({ rule: 'text-faces-away', severity: distance < 10 ? 'error' : 'warning', slotId: slot.id, message: `${label} "${slot.name}" shows its back ${where}, ${distance.toFixed(1)} m away: turn it half a turn about the vertical (its local +Z must point away from the viewer).` });
			} else if (cosView >= 0 && cosView < Math.cos((70 * Math.PI) / 180) && !reported.has('grazing')) {
				reported.add('grazing');
				findings.push({ rule: 'text-grazing', severity: 'warning', slotId: slot.id, message: `${label} "${slot.name}" is seen almost edge-on ${where} (${deg(Math.acos(cosView))}° off its front): turn it towards the viewer.` });
			}
			const horizontal = Math.hypot(toEye[0], toEye[2]);
			const elevation = Math.atan2(-toEye[1], Math.max(horizontal, 1e-6));
			if (elevation > (40 * Math.PI) / 180 && !reported.has('high')) {
				reported.add('high');
				findings.push({ rule: 'text-too-high', severity: elevation > (60 * Math.PI) / 180 ? 'error' : 'warning', slotId: slot.id, message: `${label} "${slot.name}" is ${deg(elevation)}° above eye level ${where}: nobody reads that without tilting their head back. Lower it or move it away.` });
			}
		}

		const interactive = !!panel && tree.some((child) => child.parentId === slot.id && child.components.some((c) => c.type === 'uiElement' && ['button', 'input', 'slider', 'grid'].includes((c as { kind?: string }).kind ?? '')));
		if (interactive) {
			const floor = floorUnder(center);
			if (floor === null) findings.push({ rule: 'panel-out-of-reach', severity: 'error', slotId: slot.id, message: `The panel "${slot.name}" has buttons but nothing to stand on under it: a player cannot get to it.` });
			else if (center[1] - floor > reach + 1) findings.push({ rule: 'panel-out-of-reach', severity: 'error', slotId: slot.id, message: `The panel "${slot.name}" has buttons and floats ${(center[1] - floor).toFixed(1)} m above the floor under it: out of reach (${reach} m).` });
		}
	}
	return findings;
}
