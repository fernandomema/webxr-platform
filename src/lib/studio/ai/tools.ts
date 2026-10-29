import type { Component, Slot, SlotTree } from '@kithin/engine/ecs/types';
import { isAssetId, migrateSlotTree } from '@kithin/engine/assets/ref';
import { COMPONENT_SCHEMAS, type FieldDef } from '@kithin/engine/document/components';
import { addComponent, cloneTree, duplicateSlot, getSlot, insertSubtree, removeComponent, removeSlot, reparent, setComponentField, subtreeIds, updateSlot } from '@kithin/engine/document/tree';
import { introducedErrors, validateAiScene, type SceneDiagnostic } from './validation';

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const id = { type: 'string', description: 'An existing slot ID. A temporary ID returned by stage_subtree also works afterwards.' };
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
	{ name: 'list_scene', description: 'Read a paginated hierarchy summary of the open scene as it is now, including your own earlier edits. Use this before editing unfamiliar objects.', parameters: object({ offset: { type: 'integer' }, limit: { type: 'integer' } }) },
	{ name: 'read_scene_json', description: 'Read full slot JSON of the open scene in pages, including your own earlier edits. Use offset and limit; reduce limit if the page is too large.', parameters: object({ offset: { type: 'integer' }, limit: { type: 'integer' } }) },
	{ name: 'inspect_slot', description: 'Read one slot or a bounded subtree of the open scene as it is now, including components, code and your own earlier edits.', parameters: object({ id, subtree: { type: 'boolean' } }, ['id']) },
	{ name: 'get_component_schema', description: 'Read component types, defaults, fields, and the codeBlock context overview.', parameters: object({ type: { type: 'string' } }) },
	{ name: 'get_script_api', description: 'Read the supported codeBlock handlers and ctx runtime API.', parameters: object({}) },
	{ name: 'validate_draft', description: 'Validate the whole scene and return diagnostics.', parameters: object({}) },
	{ name: 'stage_subtree', description: 'Create new slots under parentId. Each new slot needs a unique temporary id and name; omitted parentId, position, rotation, scale and components default to null, [0,0,0], [0,0,0,1], [1,1,1] and []. Child parentId is another temporary id in slots. For one handle: {parentId:"existing-root-id",slots:[{id:"handle",name:"Handle",position:[0,-0.5,0],components:[{type:"meshRenderer",meshRef:{"kind":"builtin","id":"cylinder"},color:"#a16207"}]}]}. Returned idMap maps temporary IDs to real IDs.', parameters: object({ parentId: { type: ['string', 'null'] }, slots: { type: 'array', items: fragmentSlot, minItems: 1, maxItems: 150 } }, ['parentId', 'slots']) },
	{ name: 'stage_update_slot', description: 'Patch an existing slot without replacing omitted fields. Use position/scale [x,y,z] and rotation [x,y,z,w]; components, when present, replaces the complete array. Example: {id:"existing-id",patch:{name:"Blade",scale:[0.5,0.05,0.7]}}.', parameters: object({ id, patch: slotPatch }, ['id', 'patch']) },
	{ name: 'stage_reparent_slot', description: 'Move a slot under a different existing parent, or null for the root.', parameters: object({ id, parentId: { type: ['string', 'null'] } }, ['id', 'parentId']) },
	{ name: 'stage_add_component', description: 'Add one complete component to an existing slot. Read its schema first.', parameters: object({ id, component: { type: 'object' } }, ['id', 'component']) },
	{ name: 'stage_set_component_field', description: 'Change one field of an existing component. index is zero-based; type cannot be changed.', parameters: object({ id, index: { type: 'integer' }, field: { type: 'string' }, value: {} }, ['id', 'index', 'field', 'value']) },
	{ name: 'stage_set_component_fields', description: 'Change many component fields in ONE call (for example recolouring a whole model). Each edit is {id,index,field,value} like stage_set_component_field. All edits apply together or none do. Prefer this over repeating stage_set_component_field.', parameters: object({ edits: { type: 'array', minItems: 1, maxItems: 200, items: object({ id, index: { type: 'integer' }, field: { type: 'string' }, value: {} }, ['id', 'index', 'field', 'value']) } }, ['edits']) },
	{ name: 'stage_update_slots', description: 'Patch many existing slots in ONE call. Each update is {id,patch} like stage_update_slot. All updates apply together or none do. Prefer this over repeating stage_update_slot.', parameters: object({ updates: { type: 'array', minItems: 1, maxItems: 100, items: object({ id, patch: slotPatch }, ['id', 'patch']) } }, ['updates']) },
	{ name: 'search_assets', description: 'Search the online libraries (Poly Haven and others) for something to use: a PBR material such as brick, wood, metal, fabric, concrete or grass, a 3D model, a sound or a picture. Returns refs, titles, licenses and, for materials, the real-world size in metres of one repeat. Only assets that allow commercial use are listed. Follow with import_asset.', parameters: object({ kind: { type: 'string', enum: ['material', 'model', 'audio', 'image'] }, query: { type: 'string', description: 'What to look for, in English, for example "wood floor".' }, source: { type: 'string', description: 'A source id to search only that one; leave out to search all.' } }, ['kind', 'query']) },
	{ name: 'import_asset', description: 'Download something found with search_assets into the person\'s own assets (pictures are converted to optimized WebP) and return what to use. A material returns asset ids for albedo, normal and arm (null when it has none) and size: pass them to stage_set_material. A model returns an assetId: place it with stage_subtree using meshRef {kind:"asset", assetId}, scaled with the returned size in mind. If the license asks for credit the answer says so: mention it to the person.', parameters: object({ ref: { type: 'string', description: 'A ref from search_assets, for example "polyhaven:brick_wall_002".' }, resolution: { type: 'string', description: 'Preferred size for materials, such as "1k" or "2k". Default 1k.' } }, ['ref']) },
	{ name: 'stage_set_material', description: 'Give an object a textured surface (or change its material). The object needs a meshRenderer with a built-in shape (box, sphere, plane, ground, cylinder or disc); imported models keep their own materials. albedo, normal and arm take an asset id from import_asset or an https picture address, and null removes one. Use mapping "triplanarLocal" (real size, fitted to the object) for most surfaces, or "world" (or "wrap" on a box, so the pattern continues across its top edges; "triplanarWorld"/"triplanarLocal" for turned or curved objects) with the texture\'s size so the pattern keeps its real scale on any object; the meshRenderer colour tints the albedo.', parameters: object({ id, albedo: { type: ['string', 'null'] }, normal: { type: ['string', 'null'] }, arm: { type: ['string', 'null'], description: 'Occlusion in red, roughness in green, metallic in blue.' }, mapping: { type: 'string', enum: ['mesh', 'world', 'wrap', 'around', 'triplanarWorld', 'triplanarLocal'] }, size: { type: 'number', description: 'Metres one repeat covers (mapping "world").' }, tiling: { type: 'number', description: 'Repeats across the mesh (mapping "mesh").' }, cells: { type: 'number', description: 'Cells across one repeat of the picture (2 for a 2 by 2 checker); with "triplanarLocal" a checker then continues round the edges of a box.' }, roughness: { type: 'number' }, metallic: { type: 'number' } }, ['id']) },
	{ name: 'stage_remove_component', description: 'Remove one component by zero-based index.', parameters: object({ id, index: { type: 'integer' } }, ['id', 'index']) },
	{ name: 'stage_duplicate_slot', description: 'Duplicate a slot and all descendants.', parameters: object({ id }, ['id']) },
	{ name: 'stage_delete_slot', description: 'Delete a slot and all descendants. Never use without an explicit user request.', parameters: object({ id }, ['id']) }
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

/** Tools the browser runs itself (they fetch and import, so they are asynchronous); `StudioDraft` only handles the ones that edit the scene. */
const REMOTE_TOOLS = new Set(['search_assets', 'import_asset']);
export const isRemoteTool = (name: string): boolean => REMOTE_TOOLS.has(name);

function mapRef(value: unknown, field: string): { kind: 'asset'; assetId: string } | { kind: 'url'; url: string } | null {
	if (value === null) return null;
	if (typeof value === 'string' && isAssetId(value)) return { kind: 'asset', assetId: value };
	if (typeof value === 'string' && /^https:\/\/[^\s]{1,490}$/.test(value)) return { kind: 'url', url: value };
	throw new Error(`${field} must be an asset id from import_asset, an https picture address, or null.`);
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

	/** Continues from the open scene: the person may have edited it (or undone a step) since the last tool call. */
	sync(tree: SlotTree): void {
		if (tree !== this.tree) this.tree = tree;
	}

	private setMaterial(tree: SlotTree, args: Record<string, unknown>, resolveId: (value: unknown) => string): SlotTree {
		const target = getSlot(tree, resolveId(args.id));
		if (!target) throw new Error('Slot not found: ' + String(args.id));
		const mesh = target.components.find((component) => component.type === 'meshRenderer') as unknown as { meshRef?: { kind?: string } } | undefined;
		if (!mesh) throw new Error('Only objects with a meshRenderer can have a material. Add one with a built-in shape first.');
		if (mesh.meshRef?.kind !== 'builtin') throw new Error('Materials apply to built-in shapes only; an imported model keeps its own materials.');
		const set: Record<string, unknown> = {};
		const unset: string[] = [];
		for (const key of ['albedo', 'normal', 'arm']) {
			if (args[key] === undefined) continue;
			const ref = mapRef(args[key], key);
			if (ref) set[key] = ref; else unset.push(key);
		}
		const numbers: Record<string, [number, number]> = { roughness: [0, 1], metallic: [0, 1], size: [0.01, 100], tiling: [0.1, 50], cells: [1, 32] };
		for (const [key, [min, max]] of Object.entries(numbers)) {
			if (args[key] === undefined) continue;
			const value = coerceFieldValue('number', args[key]);
			if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${key} must be a number from ${min} to ${max}.`);
			set[key] = value;
		}
		if (args.mapping !== undefined) {
			if (args.mapping !== 'mesh' && args.mapping !== 'world' && args.mapping !== 'wrap' && args.mapping !== 'around' && args.mapping !== 'triplanarWorld' && args.mapping !== 'triplanarLocal') throw new Error('mapping must be "mesh", "world", "wrap" or "around".');
			set.mapping = args.mapping;
		}
		const index = target.components.findIndex((component) => component.type === 'material');
		const merged: Record<string, unknown> = { ...(index >= 0 ? target.components[index] as unknown as Record<string, unknown> : { type: 'material' }), ...set };
		for (const key of unset) delete merged[key];
		const components = index >= 0 ? target.components.map((component, i) => (i === index ? merged as unknown as Component : component)) : [...target.components, merged as unknown as Component];
		return updateSlot(tree, target.id, { components });
	}

	private setField(tree: SlotTree, args: Record<string, unknown>, resolveId: (value: unknown) => string): SlotTree {
		const target = getSlot(tree, resolveId(args.id));
		const index = args.index;
		if (!target || !Number.isInteger(index) || Number(index) < 0 || Number(index) >= target.components.length) throw new Error('Component not found.');
		if (typeof args.field !== 'string' || args.field === 'type') throw new Error('Invalid component field.');
		const schema = COMPONENT_SCHEMAS.find((item) => item.type === target.components[Number(index)].type);
		const fieldDef = schema?.fields.find((field) => field.key === args.field);
		if (!fieldDef) throw new Error('Unknown component field.');
		return setComponentField(tree, target.id, Number(index), args.field, coerceFieldValue(fieldDef.kind, args.value));
	}

	call(name: string, input: unknown): ToolResult {
		const args = record(input);
		if (!STUDIO_TOOLS.some((tool) => tool.name === name)) throw new Error('Unknown tool.');
		const resolveId = (value: unknown) => this.aliases.get(String(value)) ?? String(value);
		if (name === 'list_scene') {
			const offset = Number.isInteger(args.offset) ? Math.max(0, Number(args.offset)) : 0;
			const limit = Number.isInteger(args.limit) ? Math.min(100, Math.max(1, Number(args.limit))) : 60;
			return { changed: false, value: { total: this.tree.length, selectedId: this.selectedId, slots: this.tree.slice(offset, offset + limit).map((slot) => ({ id: slot.id, parentId: slot.parentId, name: slot.name, components: slot.components.map((c) => c.type) })) } };
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
			return { changed: false, value: schema ? { type: schema.type, description: schema.description, fields: schema.fields.filter((field) => field.kind !== 'action'), example: schema.create(), codeBlockNote: schema.type === 'codeBlock' ? 'Return lifecycle handlers from the code string. Use ctx.self, ctx.world, ctx.hierarchy, ctx.math, ctx.grab, ctx.audio, ctx.net and ctx.ui. Never use document, window, fetch, or arbitrary globals.' : undefined } : { available: COMPONENT_SCHEMAS.map((item) => item.type) } };
		}
		if (name === 'validate_draft') return { changed: false, value: { diagnostics: this.diagnostics } };
		if (name === 'get_script_api') return { changed: false, value: {
			handlers: ['onSpawn()', 'onPlayerReady(player) (may be async)', 'onGrab()', 'onRelease()', 'onPress()', 'onUIEvent(event)', 'onEquip(event)', 'onUnequip(event)', 'onTrigger(event)', 'tick(dt)', 'getRadialItems()'],
			ctx: { self: ['id', 'getSlot()', 'getComponent(type)', 'getWorldPosition()', 'getWorldRotation()', 'setWorldPosition(vec3)', 'setWorldRotation(quat)'], hierarchy: ['getSlot(id)', 'getChildren(id)', 'getParent(id)', 'findByName(name)', 'getWorldPose(id): {position,rotation,forward,up,right}'], equip: ['isEquipped()', 'holder()'], grab: ['isHeld()', 'heldBy()', 'isSlotHeld(id)'], world: ['isHost()', 'spawn(partialSlot)', 'deleteSelf()', 'deleteSlot(id)', 'setComponentField(id,type,field,value)', 'removeComponent(id,type): boolean', 'setWorldPose(id,{position,rotation,scale}): boolean', 'setParent(id,parentId|null): boolean (keeps world pose)', 'setSlotEnabled(id,enabled): boolean (host only)', 'findNear(position,radius)', 'raycast(origin,direction,maxDistance,{ignore}): {slotId,point,normal,u,v}|null', 'overlap(from,to,radius,{ignore}): slotIds (capsule touch test)', 'getPlayer(id)'], storage: ['available', 'player(player).get(key,default)/set(key,value)/increment(key,by,{min,max})/addToSet(key,value)/removeFromSet/remove/transaction(ops) (async, per account + published world)', 'world.<same> (shared by all sessions)'], leaderboards: ['submit(name,player,score,{order})', 'best(name,player)', 'top(name,{limit})', 'showOn(scoreboardSlotId,name)'], math: ['quatFromAxisAngle(axis,radians)', 'vecAdd(a,b)', 'vecSub(a,b)', 'vecScale(a,n)', 'vecDot(a,b)', 'vecCross(a,b)', 'vecLength(a)', 'vecNormalize(a)', 'quatMultiply(a,b)', 'rotateVec(q,v)'], audio: ['play({frequency,pitchDrop,noiseMix,durationMs,volume})', 'analyze(source): Promise<{duration,bpm,bpmConfidence,onsets:[{t,strength,band}],energy:{hop,low,mid,high}}>', 'playTrack(source,{volume,loop,offset}): Promise<{time(),duration,playing,ended,pause(),resume(),stop(),setVolume(v)}> (time() is the audio clock, not spatial)'], particles: ['burst({color,count,durationMs})'], net: ['fetchJson(url): Promise', 'postJson(url, body): Promise'], ui: ['getMedia(videoSlotId)', 'getInputText(inputSlotId)'] },
			notes: 'A codeBlock string is the body of a function receiving ctx; return an object of handlers. onTrigger runs on the host for the equipped hand; return false to allow normal input, otherwise consume it. ctx.world spawning and cross-object writes are host-authoritative. Code runs in a sandbox: only the ctx API and standard JavaScript exist (no window, document or fetch; use ctx.net).'
		} };
		if (this.writes >= 200) throw new Error('Too many edits in one request. Tell the person what is left and stop.');
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
				if (getSlot(this.tree, slot.id) || this.aliases.has(slot.id)) throw new Error('Temporary ID is already used in this scene: ' + slot.id);
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
		} else if (name === 'stage_set_component_field') {
			next = this.setField(this.tree, args, resolveId);
		} else if (name === 'stage_set_component_fields') {
			if (!Array.isArray(args.edits) || args.edits.length === 0 || args.edits.length > 200) throw new Error('edits must contain 1 to 200 edits.');
			let working = this.tree;
			args.edits.forEach((edit, index) => {
				try { working = this.setField(working, record(edit), resolveId); }
				catch (caught) { throw new Error(`edits[${index}]: ${caught instanceof Error ? caught.message : 'failed'}. Nothing was changed.`); }
			});
			next = working;
		} else if (name === 'stage_update_slots') {
			if (!Array.isArray(args.updates) || args.updates.length === 0 || args.updates.length > 100) throw new Error('updates must contain 1 to 100 updates.');
			let working = this.tree;
			args.updates.forEach((update, index) => {
				try {
					const entry = record(update);
					const target = getSlot(working, resolveId(entry.id));
					if (!target) throw new Error('Slot not found: ' + String(entry.id));
					working = updateSlot(working, target.id, normalizePatch(entry.patch));
				} catch (caught) { throw new Error(`updates[${index}]: ${caught instanceof Error ? caught.message : 'failed'}. Nothing was changed.`); }
			});
			next = working;
		} else if (name === 'stage_set_material') {
			next = this.setMaterial(this.tree, args, resolveId);
		} else if (name === 'stage_remove_component') {
			const target = getSlot(this.tree, resolveId(args.id));
			const index = args.index;
			if (!target || !Number.isInteger(index) || Number(index) < 0 || Number(index) >= target.components.length) throw new Error('Component not found.');
			next = removeComponent(this.tree, target.id, Number(index));
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
		return { changed: true, value: { applied: true, createdId, idMap, slots: this.tree.length, diagnostics: this.diagnostics.slice(0, 10) } };
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
