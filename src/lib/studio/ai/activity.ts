import type { SlotTree } from '@kithin/engine/ecs/types';
import { getSlot } from '@kithin/engine/document/tree';

/** One thing the agent did, in words a person understands: the chat shows these instead of raw tool calls. */
export interface ActivityItem {
	/** `read` looked at something, `change` edited the scene, `import` brought a file into the person's assets, `retry` was a mistake the agent corrected on its own. */
	kind: 'read' | 'change' | 'import' | 'retry';
	text: string;
	/** The tool behind it, for the technical details. */
	tool: string;
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Describes a finished tool call. `before` is the scene as it was when the call began (a deleted object is only there), and
 * `output` is what the tool returned: a returned error means the agent will try again, so it is shown as a quiet retry.
 */
export function describeToolCall(name: string, rawArgs: unknown, before: SlotTree, output: unknown): ActivityItem {
	const args = record(rawArgs);
	const nameOf = (id: unknown) => getSlot(before, String(id ?? ''))?.name ?? 'an object';
	const failure = record(output).error;
	if (typeof failure === 'string') return { kind: 'retry', text: `Corrected a mistake: ${failure.slice(0, 120)}`, tool: name };
	const change = (text: string): ActivityItem => ({ kind: 'change', text, tool: name });
	const read = (text: string): ActivityItem => ({ kind: 'read', text, tool: name });
	const imported = (text: string): ActivityItem => ({ kind: 'import', text, tool: name });
	switch (name) {
		case 'list_scene':
		case 'read_scene_json': return read('Looked at the scene');
		case 'inspect_slot': return read(`Inspected ${nameOf(args.id)}`);
		case 'get_component_schema': return read(typeof args.type === 'string' ? `Checked how ${args.type} works` : 'Checked the available components');
		case 'get_script_api': return read('Checked the scripting reference');
		case 'validate_draft': return read('Checked the scene for problems');
		case 'search_assets': return read(`Searched for ${String(args.kind ?? 'assets')} “${String(args.query ?? '').slice(0, 40)}”`);
		case 'import_asset': {
			const asset = typeof record(output).name === 'string' ? String(record(output).name) : '';
			return imported(asset ? `Imported ${asset}` : 'Imported an asset');
		}
		case 'stage_set_material': return change(`Put a material on ${nameOf(args.id)}`);
		case 'stage_subtree': {
			const slots = Array.isArray(args.slots) ? args.slots as { name?: unknown }[] : [];
			const first = typeof slots[0]?.name === 'string' ? slots[0].name : 'a new object';
			return change(slots.length > 1 ? `Created ${first} (${plural(slots.length, 'part')})` : `Created ${first}`);
		}
		case 'stage_update_slot': {
			const keys = Object.keys(record(args.patch));
			const target = nameOf(args.id);
			if (keys.length === 1 && keys[0] === 'position') return change(`Moved ${target}`);
			if (keys.length === 1 && keys[0] === 'scale') return change(`Resized ${target}`);
			if (keys.length === 1 && keys[0] === 'rotation') return change(`Rotated ${target}`);
			if (keys.length === 1 && keys[0] === 'name') return change(`Renamed ${target} to ${String(record(args.patch).name)}`);
			return change(`Updated ${target}`);
		}
		case 'stage_update_slots': return change(`Updated ${plural(Array.isArray(args.updates) ? args.updates.length : 0, 'object')}`);
		case 'stage_reparent_slot': return change(`Moved ${nameOf(args.id)} into ${args.parentId ? nameOf(args.parentId) : 'the scene root'}`);
		case 'stage_add_component': return change(`Added ${String(record(args.component).type ?? 'a component')} to ${nameOf(args.id)}`);
		case 'stage_set_component_field': return change(args.field === 'color' ? `Changed the color of ${nameOf(args.id)}` : `Changed ${String(args.field)} of ${nameOf(args.id)}`);
		case 'stage_set_component_fields': {
			const edits = Array.isArray(args.edits) ? args.edits as { field?: unknown }[] : [];
			return change(edits.length && edits.every((edit) => edit.field === 'color') ? `Recolored ${plural(edits.length, 'part')}` : `Changed ${plural(edits.length, 'property')}`.replace('propertys', 'properties'));
		}
		case 'stage_remove_component': {
			const component = getSlot(before, String(args.id ?? ''))?.components[Number(args.index)];
			return change(`Removed ${component?.type ?? 'a component'} from ${nameOf(args.id)}`);
		}
		case 'stage_duplicate_slot': return change(`Duplicated ${nameOf(args.id)}`);
		case 'stage_delete_slot': return change(`Deleted ${nameOf(args.id)}`);
		default: return read(name);
	}
}

/** The one line a finished run shows while its details are folded away. */
export function summarizeActivity(items: ActivityItem[]): string {
	const changes = items.filter((item) => item.kind === 'change').length;
	const reads = items.filter((item) => item.kind === 'read').length;
	const imports = items.filter((item) => item.kind === 'import').length;
	const parts = [changes ? plural(changes, 'change') : '', imports ? `imported ${plural(imports, 'file')}` : '', reads ? `looked around ${plural(reads, 'time')}` : ''].filter(Boolean);
	return parts.length ? parts.join(' · ') : 'No actions';
}
