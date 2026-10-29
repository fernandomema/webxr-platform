import type { Component, Slot, SlotTree } from '../ecs/types.ts';

/**
 * What changed between two versions of a slot tree, slot by slot and field by field, written for a reader that has to make the same
 * edits somewhere else: a person or an AI agent updating the code that builds a scene. Slots are matched by id; the components of a
 * slot by type, in order. Nothing here needs a browser.
 */
export interface FieldChange {
	/** Dotted path inside the slot or component: `position`, `color`, `source.assetId`. */
	path: string;
	before: unknown;
	after: unknown;
}

export interface ComponentChange {
	type: string;
	kind: 'added' | 'removed' | 'changed';
	/** Which of the slot's components of this type (0 for the first). */
	index: number;
	/** The whole component, for added and removed. */
	component?: Component;
	fields?: FieldChange[];
}

export interface SlotChange {
	id: string;
	/** Names from the root down to the slot, as it is in `after` (or in `before` for a removed slot). */
	path: string[];
	fields: FieldChange[];
	components: ComponentChange[];
}

export interface TreeDiff {
	added: Array<{ slot: Slot; path: string[] }>;
	removed: Array<{ slot: Slot; path: string[] }>;
	changed: SlotChange[];
}

const SLOT_FIELDS = ['name', 'parentId', 'position', 'rotation', 'scale', 'disabled'] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Differences between two values as a list of the smallest paths that differ. Arrays are compared whole, since their meaning is in the order. */
export function diffValues(before: unknown, after: unknown, path = ''): FieldChange[] {
	if (same(before, after)) return [];
	if (isPlain(before) && isPlain(after)) {
		const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
		return keys.flatMap((key) => diffValues(before[key], after[key], path ? `${path}.${key}` : key));
	}
	return [{ path, before, after }];
}

function pathOf(tree: readonly Slot[], slot: Slot): string[] {
	const byId = new Map(tree.map((candidate) => [candidate.id, candidate]));
	const names: string[] = [];
	const seen = new Set<string>();
	for (let current: Slot | undefined = slot; current && !seen.has(current.id); current = current.parentId ? byId.get(current.parentId) : undefined) {
		seen.add(current.id);
		names.unshift(current.name);
	}
	return names;
}

function diffComponents(before: readonly Component[], after: readonly Component[]): ComponentChange[] {
	const groups = (list: readonly Component[]) => {
		const map = new Map<string, Component[]>();
		for (const component of list) map.set(component.type, [...(map.get(component.type) ?? []), component]);
		return map;
	};
	const was = groups(before);
	const now = groups(after);
	const out: ComponentChange[] = [];
	for (const type of new Set([...was.keys(), ...now.keys()])) {
		const old = was.get(type) ?? [];
		const next = now.get(type) ?? [];
		for (let index = 0; index < Math.max(old.length, next.length); index++) {
			if (!old[index]) out.push({ type, kind: 'added', index, component: next[index] });
			else if (!next[index]) out.push({ type, kind: 'removed', index, component: old[index] });
			else {
				const fields = diffValues(old[index], next[index]);
				if (fields.length) out.push({ type, kind: 'changed', index, fields });
			}
		}
	}
	return out;
}

export function diffTrees(before: SlotTree, after: SlotTree): TreeDiff {
	const was = new Map(before.map((slot) => [slot.id, slot]));
	const now = new Map(after.map((slot) => [slot.id, slot]));
	const diff: TreeDiff = { added: [], removed: [], changed: [] };
	for (const slot of after) {
		const old = was.get(slot.id);
		if (!old) {
			diff.added.push({ slot, path: pathOf(after, slot) });
			continue;
		}
		const fields = SLOT_FIELDS.flatMap((key) => diffValues(old[key], slot[key], key));
		const components = diffComponents(old.components, slot.components);
		if (fields.length || components.length) diff.changed.push({ id: slot.id, path: pathOf(after, slot), fields, components });
	}
	for (const slot of before) if (!now.has(slot.id)) diff.removed.push({ slot, path: pathOf(before, slot) });
	return diff;
}

export function isEmptyDiff(diff: TreeDiff): boolean {
	return !diff.added.length && !diff.removed.length && !diff.changed.length;
}

/** Strings this long are cut when shown; the agent is told where to find the rest. */
const MAX_VALUE_CHARS = 1500;

function show(value: unknown): string {
	if (value === undefined) return '(absent)';
	const text = typeof value === 'string' && value.includes('\n') ? value : JSON.stringify(value);
	return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}… (${text.length - MAX_VALUE_CHARS} more characters)` : text;
}

function showField(change: FieldChange): string[] {
	const multiline = [change.before, change.after].some((value) => typeof value === 'string' && value.includes('\n'));
	if (!multiline) return [`- \`${change.path}\`: ${show(change.before)} → ${show(change.after)}`];
	return [`- \`${change.path}\` (before):`, '```', show(change.before), '```', `- \`${change.path}\` (after):`, '```', show(change.after), '```'];
}

const label = (id: string, path: string[]) => `\`${id}\` — ${path.join(' / ')}`;

/** The diff as Markdown. */
export function formatTreeDiff(diff: TreeDiff): string {
	if (isEmptyDiff(diff)) return 'No changes.';
	const out: string[] = [`${diff.changed.length} modified, ${diff.added.length} added, ${diff.removed.length} removed slot(s).`, ''];
	if (diff.changed.length) {
		out.push('## Modified slots', '');
		for (const change of diff.changed) {
			out.push(`### ${label(change.id, change.path)}`);
			for (const field of change.fields) out.push(...showField(field));
			for (const component of change.components) {
				const name = `\`${component.type}\`${component.index ? ` #${component.index + 1}` : ''}`;
				if (component.kind === 'changed') for (const field of component.fields!) out.push(...showField({ ...field, path: `${component.type}.${field.path}` }));
				else out.push(`- ${component.kind === 'added' ? 'Added' : 'Removed'} component ${name}:`, '```json', JSON.stringify(component.component), '```');
			}
			out.push('');
		}
	}
	for (const [title, list] of [['Added slots', diff.added], ['Removed slots', diff.removed]] as const) {
		if (!list.length) continue;
		out.push(`## ${title}`, '');
		for (const { slot, path } of list) out.push(`### ${label(slot.id, path)}`, '```json', JSON.stringify(slot), '```', '');
	}
	return out.join('\n').trimEnd();
}
