import { BUILTIN_MESH_IDS, isAssetId, isBuiltinMeshId, normalizeMeshRef } from '../../assets/ref';
import type { SlotTree } from '$lib/ecs/types';
import { validateWorldScene } from '$lib/worlds/package';
import { COMPONENT_SCHEMAS } from '../schema/components';
import { lintCode } from '../lint/code';

export interface SceneDiagnostic {
	severity: 'error' | 'warning';
	message: string;
	slotId?: string;
}

const schemas = new Map(COMPONENT_SCHEMAS.map((schema) => [schema.type, schema]));

export function validateAiScene(tree: SlotTree): SceneDiagnostic[] {
	const diagnostics: SceneDiagnostic[] = [];
	try {
		validateWorldScene(tree);
	} catch (error) {
		diagnostics.push({ severity: 'error', message: error instanceof Error ? error.message : 'Invalid scene' });
	}
	for (const slot of tree) {
		if (!slot || typeof slot !== 'object') {
			diagnostics.push({ severity: 'error', message: 'Scene contains a non-object slot.' });
			continue;
		}
		for (const [field, value, length] of [
			['position', slot.position, 3],
			['rotation', slot.rotation, 4],
			['scale', slot.scale, 3]
		] as const) {
			if (!Array.isArray(value) || value.length !== length || value.some((number) => typeof number !== 'number' || !Number.isFinite(number))) {
				diagnostics.push({ severity: 'error', slotId: slot.id, message: `slot.${field} must contain ${length} finite numbers.` });
			}
		}
		if (Array.isArray(slot.scale) && slot.scale.some((value) => value === 0)) diagnostics.push({ severity: 'warning', slotId: slot.id, message: 'A zero scale can make the object invisible.' });
		if (!Array.isArray(slot.components)) {
			diagnostics.push({ severity: 'error', slotId: slot.id, message: 'slot.components must be an array.' });
			continue;
		}
		for (const component of slot.components) {
			if (!component || typeof component.type !== 'string') {
				diagnostics.push({ severity: 'error', slotId: slot.id, message: 'Component has no type.' });
				continue;
			}
			const schema = schemas.get(component.type);
			if (!schema) {
				diagnostics.push({ severity: 'error', slotId: slot.id, message: `Unknown component: ${component.type}` });
				continue;
			}
			const values = component as unknown as Record<string, unknown>;
			for (const field of schema.fields) {
				const value = values[field.key];
				if (value === undefined) {
					if (!field.optional) diagnostics.push({ severity: 'error', slotId: slot.id, message: `${component.type}.${field.key} is required.` });
					continue;
				}
				let valid = true;
				let expected = 'a valid value';
				switch (field.kind) {
					case 'number':
						valid = typeof value === 'number' && Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
						expected = field.min !== undefined || field.max !== undefined
							? `a number between ${field.min ?? '-Infinity'} and ${field.max ?? 'Infinity'}${field.unit ? ` (${field.unit})` : ''}, not a string or units suffix`
							: `a finite number${field.unit ? ` (${field.unit})` : ''}, not a string or units suffix`;
						break;
					case 'bool': valid = typeof value === 'boolean'; expected = 'true or false'; break;
					case 'vec3': valid = Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n)); expected = 'a flat array of 3 finite numbers, [x, y, z]'; break;
					case 'enum': valid = typeof value === 'string' && field.options.some((option) => option.value === value); expected = `one of: ${field.options.map((option) => option.value).join(', ')}`; break;
					case 'lines': valid = Array.isArray(value) && value.every((line) => typeof line === 'string'); expected = 'an array of strings'; break;
					case 'pose':
						valid = typeof value === 'object' && value !== null && ['position', 'rotation'].every((key) => Array.isArray((value as Record<string, unknown>)[key]) && ((value as Record<string, unknown>)[key] as unknown[]).length === 3 && ((value as Record<string, unknown>)[key] as unknown[]).every((n) => typeof n === 'number' && Number.isFinite(n)));
						expected = "{ position: [x, y, z], rotation: [x, y, z] } — both flat 3-number arrays; rotation is Euler degrees, not a quaternion";
						break;
					case 'mesh':
						valid = isBuiltinMeshId(value) || (typeof value === 'object' && value !== null && normalizeMeshRef(value).kind === (value as { kind?: unknown }).kind && (((value as { kind?: unknown }).kind === 'builtin') || isAssetId((value as { assetId?: unknown }).assetId)));
						expected = `{ kind: 'builtin', id } with id one of ${BUILTIN_MESH_IDS.join(', ')}, or { kind: 'asset', assetId } naming an asset already in the scene`;
						break;
					case 'json': valid = value !== undefined; expected = 'any JSON value'; break;
					default: valid = typeof value === 'string'; expected = 'a string';
				}
				if (!valid) diagnostics.push({ severity: 'error', slotId: slot.id, message: `${component.type}.${field.key} must be ${expected}.` });
			}
			if (component.type === 'codeBlock' && typeof component.code === 'string') {
				for (const issue of lintCode(component.code)) {
					if (issue.severity !== 'info') diagnostics.push({ severity: issue.severity, slotId: slot.id, message: `Code line ${issue.line}: ${issue.message}` });
				}
				if (component.code.trim()) diagnostics.push({ severity: 'warning', slotId: slot.id, message: 'Review this JavaScript before playing or publishing. Code blocks are not sandboxed.' });
			}
		}
	}
	return diagnostics;
}

/** Existing issues must not prevent an unrelated, valid edit. */
export function introducedErrors(before: SlotTree, after: SlotTree): SceneDiagnostic[] {
	const previous = new Map<string, number>();
	const key = (item: SceneDiagnostic) => `${item.slotId ?? ''}:${item.message}`;
	for (const item of validateAiScene(before).filter((issue) => issue.severity === 'error')) {
		previous.set(key(item), (previous.get(key(item)) ?? 0) + 1);
	}
	return validateAiScene(after).filter((item) => {
		if (item.severity !== 'error') return false;
		const remaining = previous.get(key(item)) ?? 0;
		if (remaining) { previous.set(key(item), remaining - 1); return false; }
		return true;
	});
}
