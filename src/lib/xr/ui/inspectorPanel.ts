import { Quaternion, type Scene, type TransformNode, type Mesh } from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, StackPanel, TextBlock, Button, Grid, Control } from '@babylonjs/gui';
import { createSlot, isGrabbable, type Component } from '$lib/ecs/types';
import { extractSubtree } from '$lib/ecs/serialize';
import type { SceneGraph } from '../sceneGraph';
import { availableInventoryFolders } from '$lib/inventory/registry';
import { getInventoryContext, gameState } from '../gameState';

const COMPONENT_LABELS: Record<Component['type'], string> = {
	meshRenderer: 'Mesh',
	collider: 'Collider',
	grabbable: 'Grabbable',
	audioSource: 'Audio'
};

/**
 * Two-column layout: a hierarchy tree of every Slot in the current scene on
 * the left (indented by parent depth, selected row highlighted), full
 * details (transform, attributes, components, save/delete) for the
 * selected Slot on the right. Editing is host-only for v1 (guests can
 * grab/spawn but not rewrite properties on objects they don't own) — see
 * the plan's permission model notes.
 */
export function createInspectorPanel(scene: Scene, sceneGraph: SceneGraph): { root: TransformNode } {
	const slot = createSlot({
		id: 'inspector-panel',
		name: 'Inspector',
		position: [0.9, 1.4, -1],
		components: [
			{ type: 'meshRenderer', meshRef: 'plane' },
			{ type: 'grabbable', scalable: true }
		]
	});
	const node = sceneGraph.addSlot(slot, { system: true });
	const mesh = node as Mesh;
	mesh.scaling.set(1.1, 0.8, 1);
	mesh.metadata = { ...(mesh.metadata ?? {}), interactive: true };
	mesh.setEnabled(false);

	const texture = AdvancedDynamicTexture.CreateForMesh(mesh, 900, 640, true);
	const background = new Rectangle('inspector-bg');
	background.width = 1;
	background.height = 1;
	background.background = '#111827';
	background.thickness = 0;
	texture.addControl(background);

	// --- header ---
	const header = new Rectangle('inspector-header');
	header.height = '56px';
	header.thickness = 0;
	header.top = '-292px';
	background.addControl(header);

	const title = new TextBlock('inspector-title', 'Inspector');
	title.color = 'white';
	title.fontSize = 24;
	title.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	title.left = '16px';
	header.addControl(title);

	const closeBtn = Button.CreateSimpleButton('inspector-close', '✕');
	closeBtn.width = '40px';
	closeBtn.height = '40px';
	closeBtn.color = 'white';
	closeBtn.background = '#374151';
	closeBtn.cornerRadius = 8;
	closeBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
	closeBtn.left = '-16px';
	closeBtn.onPointerClickObservable.add(() => mesh.setEnabled(false));
	header.addControl(closeBtn);

	// --- two-column body ---
	const body = new Grid('inspector-body');
	body.width = '860px';
	body.height = '560px';
	body.top = '18px';
	body.addColumnDefinition(300, true);
	body.addColumnDefinition(560, true);
	background.addControl(body);

	const listPanel = new StackPanel('inspector-list');
	listPanel.width = '290px';
	listPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	body.addControl(listPanel, 0, 0);

	const detail = new StackPanel('inspector-detail');
	detail.width = '540px';
	detail.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
	body.addControl(detail, 0, 1);

	function canEdit(): boolean {
		return gameState.role !== 'guest';
	}

	let selectedSlotId: string | null = null;
	const listButtons = new Map<string, Button>();

	function depthOf(slotId: string): number {
		let depth = 0;
		let current = sceneGraph.getLive(slotId);
		while (current?.slot.parentId) {
			current = sceneGraph.getLive(current.slot.parentId);
			depth++;
			if (depth > 20) break; // guard against any accidental cycle
		}
		return depth;
	}

	function refreshList() {
		for (const child of [...listPanel.children]) listPanel.removeControl(child);
		listButtons.clear();

		const slots = sceneGraph.allSlots().filter((s) => !s.system);
		for (const { slot: s } of slots) {
			const btn = Button.CreateSimpleButton(`inspect-${s.id}`, `${'  '.repeat(depthOf(s.id))}${s.name}`);
			btn.height = '40px';
			btn.color = 'white';
			btn.background = s.id === selectedSlotId ? '#2563eb' : '#1f2937';
			btn.cornerRadius = 6;
			btn.paddingTop = '2px';
			btn.textBlock!.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			btn.textBlock!.paddingLeft = '10px';
			btn.onPointerClickObservable.add(() => selectSlot(s.id));
			listPanel.addControl(btn);
			listButtons.set(s.id, btn);
		}
	}

	function highlightSelection() {
		for (const [id, btn] of listButtons) btn.background = id === selectedSlotId ? '#2563eb' : '#1f2937';
	}

	function row(label?: string): StackPanel {
		const r = new StackPanel(`row-${Math.random()}`);
		r.isVertical = false;
		r.height = '40px';
		r.paddingTop = '2px';
		if (label) {
			const t = new TextBlock('', label);
			t.color = '#9ca3af';
			t.width = '90px';
			t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			r.addControl(t);
		}
		detail.addControl(r);
		return r;
	}

	function stepButton(text: string, onClick: () => void): Button {
		const btn = Button.CreateSimpleButton(`step-${Math.random()}`, text);
		btn.width = '36px';
		btn.height = '36px';
		btn.color = 'white';
		btn.background = '#374151';
		btn.cornerRadius = 6;
		btn.onPointerClickObservable.add(onClick);
		return btn;
	}

	function numberStepper(label: string, step: number, get: () => number, set: (v: number) => void) {
		const r = row(label);
		const valueText = new TextBlock('', get().toFixed(2));
		valueText.color = 'white';
		valueText.width = '60px';
		const refresh = () => (valueText.text = get().toFixed(2));

		r.addControl(stepButton('-', () => (set(get() - step), refresh())));
		r.addControl(valueText);
		r.addControl(stepButton('+', () => (set(get() + step), refresh())));
	}

	function toggleRow(label: string, get: () => boolean, onClick: () => void) {
		const r = row(label);
		const btn = Button.CreateSimpleButton('', get() ? 'Sí' : 'No');
		btn.width = '70px';
		btn.height = '36px';
		btn.color = 'white';
		btn.background = get() ? '#16a34a' : '#374151';
		btn.onPointerClickObservable.add(() => {
			onClick();
			btn.textBlock!.text = get() ? 'Sí' : 'No';
			btn.background = get() ? '#16a34a' : '#374151';
		});
		r.addControl(btn);
	}

	async function saveToInventory(slotId: string, adapterId: string) {
		const tree = sceneGraph.serialize();
		const subtree = extractSubtree(tree, slotId);
		if (subtree.length === 0) return;
		const adapters = availableInventoryFolders(getInventoryContext());
		const adapter = adapters.find((a) => a.id === adapterId);
		if (!adapter) return;
		const rootSlot = subtree[0];
		// only reuse the Dash's current "pwd" if it belongs to THIS adapter — otherwise save to that adapter's root
		const folderId = gameState.currentInventoryAdapterId === adapterId ? gameState.currentInventoryFolderId : null;
		await adapter.saveItem(getInventoryContext(), folderId, rootSlot.name, subtree);
	}

	function selectSlot(slotId: string) {
		selectedSlotId = slotId;
		highlightSelection();
		showDetail(slotId);
	}

	function showDetail(slotId: string) {
		for (const child of [...detail.children]) detail.removeControl(child);
		const live = sceneGraph.getLive(slotId);
		if (!live) return;
		const editable = canEdit();

		const name = new TextBlock('detail-name', live.slot.name);
		name.color = 'white';
		name.fontSize = 22;
		name.height = '36px';
		name.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		detail.addControl(name);

		if (!editable) {
			const notice = new TextBlock('detail-readonly', '(solo el host puede editar)');
			notice.color = '#9ca3af';
			notice.height = '26px';
			detail.addControl(notice);
		}

		const sectionLabel = (text: string) => {
			const t = new TextBlock('', text);
			t.color = '#9ca3af';
			t.fontSize = 16;
			t.height = '26px';
			t.top = '6px';
			t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			detail.addControl(t);
		};

		if (editable) {
			sectionLabel('Posición');
			numberStepper(
				'X',
				0.1,
				() => live.node.position.x,
				(v) => (live.node.position.x = v)
			);
			numberStepper(
				'Y',
				0.1,
				() => live.node.position.y,
				(v) => (live.node.position.y = v)
			);
			numberStepper(
				'Z',
				0.1,
				() => live.node.position.z,
				(v) => (live.node.position.z = v)
			);

			sectionLabel('Rotación / Escala');
			const rotRow = row('Girar Y');
			rotRow.addControl(
				stepButton('-15°', () => {
					const q = live.node.rotationQuaternion ?? Quaternion.Identity();
					live.node.rotationQuaternion = Quaternion.FromEulerAngles(0, -Math.PI / 12, 0).multiply(q);
				})
			);
			rotRow.addControl(
				stepButton('+15°', () => {
					const q = live.node.rotationQuaternion ?? Quaternion.Identity();
					live.node.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.PI / 12, 0).multiply(q);
				})
			);
			numberStepper(
				'Escala',
				0.1,
				() => live.node.scaling.x,
				(v) => live.node.scaling.set(Math.max(v, 0.05), Math.max(v, 0.05), Math.max(v, 0.05))
			);

			sectionLabel('Atributos');
			const grabbable = isGrabbable(live.slot);
			toggleRow(
				'Grabbable',
				() => Boolean(isGrabbable(live.slot)),
				() => {
					if (isGrabbable(live.slot)) {
						live.slot.components = live.slot.components.filter((c) => c.type !== 'grabbable');
					} else {
						live.slot.components = [...live.slot.components, { type: 'grabbable', scalable: false }];
					}
					showDetail(slotId); // rebuild: the Escalable row depends on this
				}
			);
			if (grabbable) {
				toggleRow(
					'Escalable',
					() => Boolean(isGrabbable(live.slot)?.scalable),
					() => {
						const g = isGrabbable(live.slot);
						if (g) g.scalable = !g.scalable;
					}
				);
			}

			sectionLabel('Componentes');
			const compRow = row();
			for (const c of live.slot.components) {
				const badge = new TextBlock('', COMPONENT_LABELS[c.type] ?? c.type);
				badge.color = '#93c5fd';
				badge.width = '110px';
				badge.height = '28px';
				badge.fontSize = 14;
				compRow.addControl(badge);
			}
		}

		const actions = new StackPanel('save-row');
		actions.isVertical = false;
		actions.height = '48px';
		actions.top = '10px';
		for (const folder of availableInventoryFolders(getInventoryContext())) {
			const btn = Button.CreateSimpleButton(`save-${folder.id}`, `Guardar (${folder.label})`);
			btn.width = '160px';
			btn.height = '44px';
			btn.color = 'white';
			btn.background = '#16a34a';
			btn.cornerRadius = 6;
			btn.paddingRight = '6px';
			btn.onPointerClickObservable.add(() => saveToInventory(slotId, folder.id));
			actions.addControl(btn);
		}
		if (editable) {
			const deleteBtn = Button.CreateSimpleButton('delete-slot', 'Eliminar');
			deleteBtn.width = '120px';
			deleteBtn.height = '44px';
			deleteBtn.color = 'white';
			deleteBtn.background = '#7f1d1d';
			deleteBtn.cornerRadius = 6;
			deleteBtn.onPointerClickObservable.add(() => {
				sceneGraph.removeSlot(slotId);
				selectedSlotId = null;
				for (const child of [...detail.children]) detail.removeControl(child);
				refreshList();
			});
			actions.addControl(deleteBtn);
		}
		detail.addControl(actions);
	}

	refreshList();
	scene.onBeforeRenderObservable.add(() => {
		if (mesh.isEnabled() && listButtons.size !== sceneGraph.allSlots().filter((s) => !s.system).length) {
			refreshList();
		}
	});

	return { root: node };
}
