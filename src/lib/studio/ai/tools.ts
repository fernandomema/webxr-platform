import type { Component, Slot, SlotTree } from '$lib/ecs/types';
import { migrateSlotTree } from '../../assets/ref';
import { COMPONENT_SCHEMAS, type FieldDef } from '../schema/components';
import { addComponent, cloneTree, duplicateSlot, getSlot, insertSubtree, removeComponent, removeSlot, reparent, setComponentField, subtreeIds, updateSlot } from '../tree/ops';
import { introducedErrors, validateAiScene, type SceneDiagnostic } from './validation';

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const id = { type: 'string', description: 'An existing slot ID. A temporary ID returned by stage_subtree also works in this draft.' };
const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Local [x, y, z] finite numbers.' };
const quat = { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: 'Local quaternion [x, y, z, w]; identity is [0, 0, 0, 1].' };
const component = { type: 'object', properties: { type: { type: 'string' } }, required: ['type'], additionalProperties: true };
const componentList = { type: 'array', items: component, description: 'Full component objects. Read get_component_schema for valid fields.' };
const slotPatch = object({ name: { type: 'string' }, position: vec3, rotation: quat, scale: vec3, components: componentList });
const fragmentSlot = object({
	id: { type: 'string', description: 'Unique temporary ID for this fragment (for example, handle).' },
	parentId: { type: ['string', 'null'], description: 'Temporary ID of another slot in this fragment, or null. Omit for a fragment root.' },
	name: { type: 'string' },
	position: vec3,
	rotation: quat,
	scale: vec3,
	components: componentList
}, ['id', 'name']);

export const STUDIO_TOOLS: ToolDefinition[] = [
	{ name: 'list_scene', description: 'Read a paginated hierarchy summary of YOUR DRAFT, including edits already staged this session. This is never what the person sees in the editor — nothing here is visible to them until they click Apply. Use this before editing unfamiliar objects.', parameters: object({ offset: { type: 'integer' }, limit: { type: 'integer' } }) },
	{ name: 'read_scene_json', description: 'Read full slot JSON of YOUR DRAFT in pages, including edits already staged this session. This is never what the person sees in the editor — nothing here is visible to them until they click Apply. Use offset and limit; reduce limit if the page is too large.', parameters: object({ offset: { type: 'integer' }, limit: { type: 'integer' } }) },
	{ name: 'inspect_slot', description: 'Read one slot or a bounded subtree of YOUR DRAFT, including components, code, and edits already staged this session. This is never what the person sees in the editor — nothing here is visible to them until they click Apply.', parameters: object({ id, subtree: { type: 'boolean' } }, ['id']) },
	{ name: 'get_component_schema', description: 'Read component types, defaults, fields, and the codeBlock context overview.', parameters: object({ type: { type: 'string' } }) },
	{ name: 'get_script_api', description: 'Read the supported codeBlock handlers and ctx runtime API.', parameters: object({}) },
	{ name: 'validate_draft', description: 'Validate all currently staged edits and return diagnostics. A clean result means the draft is internally consistent, not that anything has reached the editor — staged edits stay invisible to the person until they click Apply.', parameters: object({}) },
	{ name: 'stage_subtree', description: 'Create new slots under parentId. Each new slot needs a unique temporary id and name; omitted parentId, position, rotation, scale and components default to null, [0,0,0], [0,0,0,1], [1,1,1] and []. Child parentId is another temporary id in slots. For one handle: {parentId:"existing-root-id",slots:[{id:"handle",name:"Handle",position:[0,-0.5,0],components:[{type:"meshRenderer",meshRef:{"kind":"builtin","id":"cylinder"},color:"#a16207"}]}]}. Returned idMap maps temporary IDs to real IDs.', parameters: object({ parentId: { type: ['string', 'null'] }, slots: { type: 'array', items: fragmentSlot, minItems: 1, maxItems: 150 } }, ['parentId', 'slots']) },
	{ name: 'stage_update_slot', description: 'Patch an existing slot without replacing omitted fields. Use position/scale [x,y,z] and rotation [x,y,z,w]; components, when present, replaces the complete array. Example: {id:"existing-id",patch:{name:"Blade",scale:[0.5,0.05,0.7]}}.', parameters: object({ id, patch: slotPatch }, ['id', 'patch']) },
	{ name: 'stage_reparent_slot', description: 'Stage moving a slot under a different existing parent, or null for the root.', parameters: object({ id, parentId: { type: ['string', 'null'] } }, ['id', 'parentId']) },
	{ name: 'stage_add_component', description: 'Stage adding one complete component to an existing slot. Read its schema first.', parameters: object({ id, component: { type: 'object' } }, ['id', 'component']) },
	{ name: 'stage_set_component_field', description: 'Stage changing one field of an existing component. index is zero-based; type cannot be changed.', parameters: object({ id, index: { type: 'integer' }, field: { type: 'string' }, value: {} }, ['id', 'index', 'field', 'value']) },
	{ name: 'stage_remove_component', description: 'Stage removing one component by zero-based index.', parameters: object({ id, index: { type: 'integer' } }, ['id', 'index']) },
	{ name: 'stage_duplicate_slot', description: 'Stage a copy of a slot and all descendants.', parameters: object({ id }, ['id']) },
	{ name: 'stage_delete_slot', description: 'Stage deletion of a slot and all descendants. Never use without an explicit user request.', parameters: object({ id }, ['id']) }
];

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
	return value as Record<string, unknown>;
}

function vector(value: unknown, size: 3 | 4, field: string): number[] {
	const keys = size === 3 ? ['x', 'y', 'z'] : ['x', 'y', 'z', 'w'];
	const objectValue = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
	const numbers = Array.isArray(value) ? value : objectValue ? keys.map((key) => objectValue[key]) : null;
	if (!numbers || numbers.length !== size || numbers.some((number) => typeof number !== 'number' || !Number.isFinite(number))) {
		throw new Error(`${field} must contain ${size} finite numbers: [${keys.join(', ')}].`);
	}
	return numbers as number[];
}

/** Models frequently stringify obvious booleans and numbers inside free-form tool arguments; accept the unambiguous cases rather than forcing another failed round trip. */
function coerceFieldValue(kind: FieldDef['kind'], value: unknown): unknown {
	if (kind === 'bool' && typeof value === 'string') {
		if (value === 'true') return true;
		if (value === 'false') return false;
	} else if (kind === 'number' && typeof value === 'string') {
		const trimmed = value.trim();
		const parsed = Number(trimmed);
		if (trimmed !== '' && Number.isFinite(parsed)) return parsed;
	}
	return value;
}

function coerceComponentFields(component: Component): Component {
	const schema = COMPONENT_SCHEMAS.find((item) => item.type === component.type);
	if (!schema) return component;
	const next: Record<string, unknown> = { ...(component as unknown as Record<string, unknown>) };
	for (const field of schema.fields) {
		if (field.key in next) next[field.key] = coerceFieldValue(field.kind, next[field.key]);
	}
	return next as unknown as Component;
}

function componentArray(value: unknown, field: string): Component[] {
	if (!Array.isArray(value)) throw new Error(`${field} must be an array of component objects.`);
	const result: Component[] = [];
	for (let i = 0; i < value.length; i++) {
		const item = value[i];
		if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.type !== 'string' || !item.type) {
			throw new Error(`${field}[${i}] must be an object with a component type.`);
		}
		result.push(coerceComponentFields(item as Component));
	}
	return result;
}

function normalizeFragmentSlot(value: unknown, index: number, attachedTo: string | null): Slot {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`slots[${index}] must be an object.`);
	const slot = value as Record<string, unknown>;
	if (typeof slot.id !== 'string' || !slot.id.trim()) throw new Error(`slots[${index}].id must be a unique temporary string.`);
	if (typeof slot.name !== 'string' || !slot.name.trim()) throw new Error(`slots[${index}].name is required.`);
	const unexpected = Object.keys(slot).find((key) => !['id', 'parentId', 'name', 'position', 'rotation', 'scale', 'components'].includes(key));
	if (unexpected) throw new Error(`slots[${index}].${unexpected} is not a slot field. Put visual and interaction data in components.`);
	const rawParent = slot.parentId === undefined || slot.parentId === attachedTo ? null : slot.parentId;
	if (rawParent !== null && typeof rawParent !== 'string') throw new Error(`slots[${index}].parentId must be another temporary slot ID or null.`);
	return {
		id: slot.id,
		parentId: rawParent,
		name: slot.name,
		position: (slot.position === undefined ? [0, 0, 0] : vector(slot.position, 3, `slots[${index}].position`)) as Slot['position'],
		rotation: (slot.rotation === undefined ? [0, 0, 0, 1] : vector(slot.rotation, 4, `slots[${index}].rotation`)) as Slot['rotation'],
		scale: (slot.scale === undefined ? [1, 1, 1] : vector(slot.scale, 3, `slots[${index}].scale`)) as Slot['scale'],
		components: slot.components === undefined ? [] : componentArray(slot.components, `slots[${index}].components`)
	};
}

function normalizePatch(value: unknown): Partial<Slot> {
	const patch = record(value);
	const fields = Object.keys(patch);
	if (!fields.length) throw new Error('patch must contain at least one slot field.');
	const unsupported = fields.find((key) => !['name', 'position', 'rotation', 'scale', 'components'].includes(key));
	if (unsupported) throw new Error(`patch.${unsupported} is not editable here.`);
	if (patch.name !== undefined && (typeof patch.name !== 'string' || !patch.name.trim())) throw new Error('patch.name must be a non-empty string.');
	return {
		...('name' in patch ? { name: patch.name as string } : {}),
		...('position' in patch ? { position: vector(patch.position, 3, 'patch.position') as Slot['position'] } : {}),
		...('rotation' in patch ? { rotation: vector(patch.rotation, 4, 'patch.rotation') as Slot['rotation'] } : {}),
		...('scale' in patch ? { scale: vector(patch.scale, 3, 'patch.scale') as Slot['scale'] } : {}),
		...('components' in patch ? { components: componentArray(patch.components, 'patch.components') } : {})
	};
}

export interface ToolResult {
	value: unknown;
	changed: boolean;
}

export class StudioDraft {
	tree: SlotTree;
	readonly before: SlotTree;
	private writes = 0;
	private aliases = new Map<string, string>();
	readonly selectedId: string | null;

	constructor(tree: SlotTree, selectedId: string | null) {
		this.before = cloneTree(tree);
		this.tree = cloneTree(tree);
		this.selectedId = selectedId;
	}

	get changed(): boolean { return JSON.stringify(this.before) !== JSON.stringify(this.tree); }
	get diagnostics(): SceneDiagnostic[] { return validateAiScene(this.tree); }

	call(name: string, input: unknown): ToolResult {
		const args = record(input);
		if (!STUDIO_TOOLS.some((tool) => tool.name === name)) throw new Error('Unknown tool.');
		const resolveId = (value: unknown) => this.aliases.get(String(value)) ?? String(value);
		if (name === 'list_scene') {
			const offset = Number.isInteger(args.offset) ? Math.max(0, Number(args.offset)) : 0;
			const limit = Number.isInteger(args.limit) ? Math.min(100, Math.max(1, Number(args.limit))) : 60;
			return { changed: false, value: { visibleToUserInEditor: !this.changed, note: this.changed ? 'This tree includes edits staged this session that the person cannot see yet. Nothing here reaches the editor until they click Apply.' : undefined, total: this.tree.length, selectedId: this.selectedId, slots: this.tree.slice(offset, offset + limit).map((slot) => ({ id: slot.id, parentId: slot.parentId, name: slot.name, components: slot.components.map((c) => c.type) })) } };
		}
		if (name === 'read_scene_json') {
			const offset = Number.isInteger(args.offset) ? Math.max(0, Number(args.offset)) : 0;
			const limit = Number.isInteger(args.limit) ? Math.min(30, Math.max(1, Number(args.limit))) : 10;
			const slots = this.tree.slice(offset, offset + limit);
			if (JSON.stringify(slots).length > 100_000) throw new Error('Page is too large. Request fewer slots.');
			return { changed: false, value: { total: this.tree.length, offset, slots } };
		}
		if (name === 'inspect_slot') {
			const slot = getSlot(this.tree, resolveId(args.id ?? this.selectedId ?? ''));
			if (!slot) throw new Error('Slot not found.');
			const slots = args.subtree === true ? this.tree.filter((candidate) => subtreeIds(this.tree, slot.id).has(candidate.id)) : [slot];
			const serialized = JSON.stringify(slots);
			if (serialized.length > 100_000) throw new Error('Subtree is too large. Inspect smaller slots.');
			return { changed: false, value: slots };
		}
		if (name === 'get_component_schema') {
			const schema = COMPONENT_SCHEMAS.find((item) => item.type === args.type);
			return { changed: false, value: schema ? { type: schema.type, description: schema.description, fields: schema.fields, example: schema.create(), codeBlockNote: schema.type === 'codeBlock' ? 'Return lifecycle handlers from the code string. Use ctx.self, ctx.world, ctx.hierarchy, ctx.math, ctx.grab, ctx.audio, ctx.net and ctx.ui. Never use document, window, fetch, or arbitrary globals.' : undefined } : { available: COMPONENT_SCHEMAS.map((item) => item.type) } };
		}
		if (name === 'validate_draft') return { changed: false, value: { visibleToUserInEditor: !this.changed, note: this.changed ? 'Clean validation only means the staged draft is internally consistent. It is still invisible to the person until they click Apply.' : undefined, diagnostics: this.diagnostics } };
		if (name === 'get_script_api') return { changed: false, value: {
			handlers: ['onSpawn()', 'onPlayerReady(player) (may be async)', 'onGrab()', 'onRelease()', 'onPress()', 'onUIEvent(event)', 'onEquip(event)', 'onUnequip(event)', 'onTrigger(event)', 'tick(dt)', 'getRadialItems()'],
			ctx: { self: ['id', 'getSlot()', 'getComponent(type)', 'getWorldPosition()', 'getWorldRotation()', 'setWorldPosition(vec3)', 'setWorldRotation(quat)'], hierarchy: ['getSlot(id)', 'getChildren(id)', 'getParent(id)', 'findByName(name)', 'getWorldPose(id): {position,rotation,forward,up,right}'], equip: ['isEquipped()', 'holder()'], grab: ['isHeld()', 'heldBy()', 'isSlotHeld(id)'], world: ['isHost()', 'spawn(partialSlot)', 'deleteSelf()', 'deleteSlot(id)', 'setComponentField(id,type,field,value)', 'removeComponent(id,type): boolean', 'setWorldPose(id,{position,rotation,scale}): boolean', 'setParent(id,parentId|null): boolean (keeps world pose)', 'setSlotEnabled(id,enabled): boolean (host only)', 'findNear(position,radius)', 'raycast(origin,direction,maxDistance,{ignore}): {slotId,point,normal,u,v}|null', 'overlap(from,to,radius,{ignore}): slotIds (capsule touch test)', 'getPlayer(id)'], storage: ['available', 'player(player).get(key,default)/set(key,value)/increment(key,by,{min,max})/addToSet(key,value)/removeFromSet/remove/transaction(ops) (async, per account + published world)', 'world.<same> (shared by all sessions)'], leaderboards: ['submit(name,player,score,{order})', 'best(name,player)', 'top(name,{limit})', 'showOn(scoreboardSlotId,name)'], math: ['quatFromAxisAngle(axis,radians)', 'vecAdd(a,b)', 'vecSub(a,b)', 'vecScale(a,n)', 'vecDot(a,b)', 'vecCross(a,b)', 'vecLength(a)', 'vecNormalize(a)', 'quatMultiply(a,b)', 'rotateVec(q,v)'], audio: ['play({frequency,pitchDrop,noiseMix,durationMs,volume})', 'analyze(source): Promise<{duration,bpm,bpmConfidence,onsets:[{t,strength,band}],energy:{hop,low,mid,high}}>', 'playTrack(source,{volume,loop,offset}): Promise<{time(),duration,playing,ended,pause(),resume(),stop(),setVolume(v)}> (time() is the audio clock, not spatial)'], particles: ['burst({color,count,durationMs})'], net: ['fetchJson(url): Promise', 'postJson(url, body): Promise'], ui: ['getMedia(videoSlotId)', 'getInputText(inputSlotId)'] },
			notes: 'A codeBlock string is the body of a function receiving ctx; return an object of handlers. onTrigger runs on the host for the equipped hand; return false to allow normal input, otherwise consume it. ctx.world spawning and cross-object writes are host-authoritative. Code executes in the page and is not sandboxed.'
		} };
		if (this.writes >= 40) throw new Error('Too many edits in one request. Apply this proposal, then continue.');
		let next: SlotTree;
		let createdId: string | undefined;
		let idMap: Record<string, string> | undefined;
		if (name === 'stage_subtree') {
			const requestedParent = args.parentId === undefined ? null : args.parentId;
			if (requestedParent !== null && typeof requestedParent !== 'string') throw new Error('parentId must be an existing slot ID or null.');
			const parentId = requestedParent === null ? null : resolveId(requestedParent);
			if (parentId !== null && !getSlot(this.tree, parentId)) throw new Error('Parent slot not found: ' + requestedParent);
			if (!Array.isArray(args.slots) || args.slots.length === 0 || args.slots.length > 150) throw new Error('slots must contain 1 to 150 new slot objects.');
			const fragment = args.slots.map((slot, index) => normalizeFragmentSlot(slot, index, parentId));
			const ids = new Set(fragment.map((slot) => slot.id));
			if (ids.size !== fragment.length) throw new Error('Every fragment slot needs a unique temporary ID.');
			for (const slot of fragment) {
				if (getSlot(this.tree, slot.id) || this.aliases.has(slot.id)) throw new Error('Temporary ID is already used in this draft: ' + slot.id);
				if (slot.parentId !== null && !ids.has(slot.parentId)) throw new Error('Fragment parentId must name another temporary slot ID: ' + slot.parentId);
			}
			// The fragment is independently validated before ID remapping.
			const fragmentDiagnostics = validateAiScene(fragment).filter((issue) => issue.severity === 'error');
			if (fragmentDiagnostics.length) throw new Error(fragmentDiagnostics[0].message);
			const result = insertSubtree(this.tree, parentId, fragment);
			if (!result) throw new Error('Could not insert fragment.');
			next = result.tree;
			createdId = result.id;
			idMap = result.idMap;
		} else if (name === 'stage_update_slot') {
			const target = getSlot(this.tree, resolveId(args.id));
			if (!target) throw new Error('Slot not found: ' + String(args.id));
			next = updateSlot(this.tree, target.id, normalizePatch(args.patch));
		} else if (name === 'stage_reparent_slot') {
			if (args.parentId !== null && typeof args.parentId !== 'string') throw new Error('Invalid parent ID.');
			const parentId = args.parentId === null ? null : resolveId(args.parentId);
			const result = reparent(this.tree, resolveId(args.id), parentId);
			if (!result) throw new Error('Slot or parent not found, or the move would create a cycle.');
			next = result;
		} else if (name === 'stage_add_component') {
			const target = getSlot(this.tree, resolveId(args.id));
			if (!target) throw new Error('Slot not found: ' + String(args.id));
			const component = record(args.component);
			if (typeof component.type !== 'string') throw new Error('Component type is required.');
			next = addComponent(this.tree, target.id, coerceComponentFields(component as unknown as Component));
		} else if (name === 'stage_set_component_field' || name === 'stage_remove_component') {
			const target = getSlot(this.tree, resolveId(args.id));
			const index = args.index;
			if (!target || !Number.isInteger(index) || Number(index) < 0 || Number(index) >= target.components.length) throw new Error('Component not found.');
			if (name === 'stage_remove_component') next = removeComponent(this.tree, target.id, Number(index));
			else {
				if (typeof args.field !== 'string' || args.field === 'type') throw new Error('Invalid component field.');
				const schema = COMPONENT_SCHEMAS.find((item) => item.type === target.components[Number(index)].type);
				const fieldDef = schema?.fields.find((field) => field.key === args.field);
				if (!fieldDef) throw new Error('Unknown component field.');
				next = setComponentField(this.tree, target.id, Number(index), args.field, coerceFieldValue(fieldDef.kind, args.value));
			}
		} else if (name === 'stage_duplicate_slot') {
			const result = duplicateSlot(this.tree, resolveId(args.id));
			if (!result) throw new Error('Slot not found.');
			next = result.tree;
			createdId = result.id;
		} else if (name === 'stage_delete_slot') {
			const result = removeSlot(this.tree, resolveId(args.id));
			if (!result) throw new Error('Cannot delete this slot.');
			next = result;
		} else throw new Error('Unknown tool.');
		const errors = introducedErrors(this.tree, next);
		if (errors.length) throw new Error(errors[0].message);
		this.tree = migrateSlotTree(next);
		this.writes += 1;
		if (idMap) for (const [temporary, permanent] of Object.entries(idMap)) this.aliases.set(temporary, permanent);
		return { changed: true, value: { staged: true, createdId, idMap, slots: this.tree.length, diagnostics: this.diagnostics.slice(0, 10) } };
	}
}

export function summarizeDiff(before: SlotTree, after: SlotTree): string[] {
	const previous = new Map(before.map((slot) => [slot.id, slot]));
	const current = new Map(after.map((slot) => [slot.id, slot]));
	const result: string[] = [];
	for (const slot of after) {
		if (!previous.has(slot.id)) result.push(`Added ${slot.name}`);
		else if (JSON.stringify(previous.get(slot.id)) !== JSON.stringify(slot)) result.push(`Changed ${slot.name}`);
	}
	for (const slot of before) if (!current.has(slot.id)) result.push(`Removed ${slot.name}`);
	return result;
}
