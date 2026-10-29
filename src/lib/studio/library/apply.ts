import { assetMesh, assetSource } from '@kithin/engine/assets/ref';
import { getSlot } from '@kithin/engine/document/tree';
import type { StudioDocument } from '../state/document.svelte';
import type { ImportResult } from './importers';

type Material = Extract<ImportResult, { kind: 'material' }>;
type Model = Extract<ImportResult, { kind: 'model' }>;

/** A model as a new object in the scene, at its real size and standing on the ground. */
export function addImportedModel(doc: StudioDocument, model: Model): void {
	const size = Math.min(50, Math.max(0.05, model.size));
	doc.addSlot({
		name: model.name,
		position: [0, size / 2, 0],
		scale: [size, size, size],
		components: [{ type: 'meshRenderer', meshRef: assetMesh(model.assetId) }, { type: 'collider', shape: 'box' }]
	});
}

/** A sound as a small object that plays it. */
export function addImportedAudio(doc: StudioDocument, audio: Extract<ImportResult, { kind: 'audio' }>): void {
	doc.addSlot({
		name: audio.name,
		position: [0, 1, 0],
		scale: [0.4, 0.4, 0.4],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' } },
			{ type: 'audioPlayer', source: assetSource(audio.assetId), loop: false, volume: 1 }
		]
	});
}

/** The fields of a material component that an imported material fills in: its maps and the real size of one repeat. */
export function materialFields(material: Material): Record<string, unknown> {
	return {
		albedo: material.albedo ? assetSource(material.albedo) : undefined,
		normal: material.normal ? assetSource(material.normal) : undefined,
		arm: material.arm ? assetSource(material.arm) : undefined,
		mapping: 'world',
		size: material.size,
		label: material.name
	};
}

/** Why a slot can not take a material, or null when it can. */
export function materialBlocker(doc: StudioDocument, slotId: string | null): string | null {
	const slot = slotId ? getSlot(doc.tree, slotId) : undefined;
	if (!slot) return 'Select an object first.';
	const mesh = slot.components.find((component) => component.type === 'meshRenderer') as { meshRef?: { kind?: string } } | undefined;
	if (!mesh) return 'The selected object needs a Mesh Renderer.';
	if (mesh.meshRef?.kind !== 'builtin') return 'Materials apply to built-in shapes; an imported model keeps its own.';
	return null;
}

/** Puts an imported material on a slot: it replaces the maps of the Material component it has, or adds one. */
export function applyMaterial(doc: StudioDocument, slotId: string, material: Material): void {
	const slot = getSlot(doc.tree, slotId);
	if (!slot) return;
	const fields = materialFields(material);
	const index = slot.components.findIndex((component) => component.type === 'material');
	if (index < 0) {
		doc.addRawComponent(slotId, { type: 'material', ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) } as never);
		return;
	}
	for (const [key, value] of Object.entries(fields)) doc.setField(slotId, index, key, value);
}
