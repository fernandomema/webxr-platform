import type { ParamBinding, ParamDef, ParamsComponent, ParamValue, SlotTree } from '../ecs/types.ts';

export const PARAM_LIMITS = { maxParams: 64, maxBindings: 256, maxText: 4000, maxImage: 300_000 } as const;

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
/** A field is a name, or a path into what the component holds (`source.url`, `lines.0`). */
const pathOf = (field: string): string[] | null => { const parts = field.split('.'); return parts.every((part) => part && !FORBIDDEN.has(part)) ? parts : null; };

/** `target` with the value at `path` replaced, copying only what lies on the path. Null when the path leads through something that is not there. */
function setPath(target: unknown, path: string[], value: ParamValue): unknown | null {
	if (!target || typeof target !== 'object') return null;
	const [key, ...rest] = path;
	const holder = target as Record<string, unknown>;
	const copy: unknown = Array.isArray(target) ? [...target] : { ...holder };
	if (rest.length === 0) {
		if (holder[key] !== undefined && typeof holder[key] === 'object') return null;
		if (Array.isArray(target) && !(Number(key) in target)) return null;
		(copy as Record<string, unknown>)[key] = value;
		return copy;
	}
	const inner = setPath(holder[key], rest, value);
	if (inner === null) return null;
	(copy as Record<string, unknown>)[key] = inner;
	return copy;
}

/** `value` as the parameter's kind, or `undefined` when it is not one (the default is used instead). */
export function coerceParam(def: ParamDef, value: unknown): ParamValue | undefined {
	switch (def.kind) {
		case 'number': return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
		case 'bool': return typeof value === 'boolean' ? value : undefined;
		case 'color': return typeof value === 'string' && COLOR.test(value) ? value : undefined;
		default: return typeof value === 'string' && value.length <= (value.startsWith('data:image/') ? PARAM_LIMITS.maxImage : PARAM_LIMITS.maxText) ? value : undefined;
	}
}

/** The `params` an object declares (the first one found), with the malformed parameters and bindings left out. */
export function findParams(tree: SlotTree): ParamsComponent | null {
	for (const slot of tree) {
		const found = slot.components.find((c): c is ParamsComponent => c.type === 'params');
		if (!found) continue;
		const params = (Array.isArray(found.params) ? found.params : []).filter((p): p is ParamDef => !!p && typeof p.name === 'string' && NAME.test(p.name)).slice(0, PARAM_LIMITS.maxParams);
		const names = new Set(params.map((p) => p.name));
		const text = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200;
		const bindings = (Array.isArray(found.bindings) ? found.bindings : []).filter((b): b is ParamBinding => !!b && names.has(b.param) && text(b.slot) && text(b.component) && text(b.field) && pathOf(b.field) !== null).slice(0, PARAM_LIMITS.maxBindings);
		return { type: 'params', params, bindings };
	}
	return null;
}

/** The value each parameter takes: the one given when it fits the parameter's kind, else its default. */
export function resolveParams(params: ParamsComponent, values: Record<string, unknown> | undefined): Record<string, ParamValue> {
	const out: Record<string, ParamValue> = {};
	for (const def of params.params) {
		const value = coerceParam(def, values?.[def.name]) ?? coerceParam(def, def.default);
		if (value !== undefined) out[def.name] = value;
	}
	return out;
}

/**
 * The object with each binding's field set to its parameter's value; the tree given is not changed. A binding whose slot or
 * component is not there is skipped, and one only fills a plain value (`source.url` reaches into an object; it never replaces one).
 */
export function applyParams(tree: SlotTree, values: Record<string, unknown> | undefined): { tree: SlotTree; values: Record<string, ParamValue> } {
	const params = findParams(tree);
	if (!params) return { tree, values: {} };
	const resolved = resolveParams(params, values);
	const edits = new Map<string, ParamBinding[]>();
	for (const binding of params.bindings) if (binding.param in resolved) edits.set(binding.slot, [...(edits.get(binding.slot) ?? []), binding]);
	if (edits.size === 0) return { tree, values: resolved };
	return {
		values: resolved,
		tree: tree.map((slot) => {
			const mine = edits.get(slot.id);
			if (!mine) return slot;
			return {
				...slot,
				components: slot.components.map((component) => {
					const fields = mine.filter((b) => b.component === component.type);
					if (fields.length === 0) return component;
					let next: unknown = component;
					for (const b of fields) next = setPath(next, pathOf(b.field)!, resolved[b.param]) ?? next;
					return next as typeof component;
				})
			};
		})
	};
}
