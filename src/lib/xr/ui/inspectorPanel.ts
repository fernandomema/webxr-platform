import { Quaternion, type Scene, type TransformNode, type Mesh } from '@babylonjs/core';
import { AdvancedDynamicTexture, Rectangle, StackPanel, TextBlock, Button, Grid, Control } from '@babylonjs/gui';
import { createSlot, findComponent, isGrabbable, type Component } from '$lib/ecs/types';
import { extractSubtree } from '$lib/ecs/serialize';
import type { SceneGraph } from '../sceneGraph';
import { availableInventoryFolders } from '$lib/inventory/registry';
import { getInventoryContext, gameState } from '../gameState';
import { createScrollPanel, clearContainer, sectionLabel, row, stepButton, numberStepper, toggleRow, createWrapPanel } from './inspector/guiKit';
import { createHierarchyTree } from './inspector/hierarchyTree';
import { getComponentDetailRenderer } from './inspector/componentDetails';

const COMPONENT_LABELS: Record<Component['type'], string> = {
	meshRenderer: 'Mesh',
	collider: 'Collider',
	grabbable: 'Grabbable',
	equippable: 'Equippable',
	audioSource: 'Audio',
	container: 'Container',
	worldPortal: 'World Portal',
	mirror: 'Mirror',
	videoPlayer: 'Video Player',
	audioPlayer: 'Audio Player',
	codeBlock: 'Code Block',
	expires: 'Expires',
	particleBurst: 'Particle Burst',
	velocity: 'Velocity',
	textDisplay: 'Text Display',
	scoreboard: 'Scoreboard',
	scriptState: 'Script State',
	pressableButton: 'Pressable Button',
	impactSound: 'Impact Sound'
};

const TREE_COLUMN_WIDTH = 290;
const DETAIL_COLUMN_WIDTH = 540;
// scrollbar + inner margin allowance so wrapped/indented content never brushes the ScrollViewer's own edge
const TREE_INNER_WIDTH = TREE_COLUMN_WIDTH - 30;
const DETAIL_INNER_WIDTH = DETAIL_COLUMN_WIDTH - 20;

export interface InspectorCallbacks {
	onSceneChanged?(): void;
}

/**
 * Two-column layout: a scrollable hierarchy tree of every Slot on the left
 * (see inspector/hierarchyTree.ts — real indentation, collapsible
 * branches), a scrollable detail panel for the selected Slot on the right.
 * Both columns are wrapped in ScrollViewers so content that outgrows the
 * panel scrolls instead of being clipped, and rows that can hold a variable
 * number of items (Components badges, Save buttons) wrap onto new lines
 * instead of overflowing the column width.
 *
 * Per-component-type detail (media source, codeBlock's debug log, …) comes
 * from inspector/componentDetails.ts's renderer registry — extending the
 * Inspector for a new component type means registering a renderer there,
 * not editing this file. Editing is host-only for v1 (guests can grab/spawn
 * but not rewrite properties on objects they don't own).
 */
export function createInspectorPanel(
	scene: Scene,
	sceneGraph: SceneGraph,
	callbacks: InspectorCallbacks = {}
): { root: TransformNode } {
	const slot = createSlot({
		id: 'inspector-panel',
		name: 'Inspector',
		position: [0.9, 1.4, -1],
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'plane' } },
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

	const addContainerBtn = Button.CreateSimpleButton('inspector-add-container', '+ Container');
	addContainerBtn.width = '150px';
	addContainerBtn.height = '40px';
	addContainerBtn.color = 'white';
	addContainerBtn.background = '#166534';
	addContainerBtn.cornerRadius = 8;
	addContainerBtn.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
	addContainerBtn.left = '170px';
	addContainerBtn.onPointerClickObservable.add(() => createContainer());
	header.addControl(addContainerBtn);

	// --- two-column body, each column independently scrollable ---
	const body = new Grid('inspector-body');
	body.width = '860px';
	body.height = '560px';
	body.top = '18px';
	body.addColumnDefinition(TREE_COLUMN_WIDTH, true);
	body.addColumnDefinition(DETAIL_COLUMN_WIDTH, true);
	background.addControl(body);

	const tree = createScrollPanel('inspector-tree', `${TREE_COLUMN_WIDTH - 10}px`, '550px');
	body.addControl(tree.viewer, 0, 0);

	const detailScroll = createScrollPanel('inspector-detail', `${DETAIL_COLUMN_WIDTH - 10}px`, '550px');
	const detail = detailScroll.content;
	body.addControl(detailScroll.viewer, 0, 1);

	function canEdit(): boolean {
		return gameState.role !== 'guest';
	}

	function createContainer(): void {
		if (!canEdit()) return;
		const container = createSlot({
			name: 'Container',
			position: [0, 1.2, -1.2],
			components: [
				{ type: 'container' },
				{ type: 'grabbable', scalable: true }
			]
		});
		sceneGraph.addSlot(container);
		selectedSlotId = container.id;
		notifySceneChanged();
		hierarchyTree.refresh();
		showDetail(container.id);
	}

	let selectedSlotId: string | null = null;
	let reparentMode = false;
	let hierarchySignature = '';
	/** Sections (e.g. the codeBlock debug log) that need polling while visible — reset on every showDetail() rebuild. */
	let liveRefreshers: (() => void)[] = [];

	function notifySceneChanged() {
		callbacks.onSceneChanged?.();
	}

	const hierarchyTree = createHierarchyTree(tree.content, sceneGraph, TREE_INNER_WIDTH, {
		getSelectedId: () => selectedSlotId,
		isReparentMode: () => reparentMode,
		onSelectRow: (id) => {
			if (reparentMode) {
				if (selectedSlotId && selectedSlotId !== id && sceneGraph.reparentSlot(selectedSlotId, id)) {
					reparentMode = false;
					notifySceneChanged();
					hierarchyTree.refresh();
					showDetail(selectedSlotId);
				}
				return;
			}
			selectedSlotId = id;
			hierarchyTree.refresh();
			showDetail(id);
		}
	});

	function currentHierarchySignature(): string {
		return sceneGraph
			.allSlots()
			.filter((entry) => !entry.system)
			.map(({ slot: s }) => `${s.id}:${s.parentId}:${s.name}`)
			.sort()
			.join('|');
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

	function showDetail(slotId: string) {
		clearContainer(detail);
		liveRefreshers = [];
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
			const notice = new TextBlock('detail-readonly', '(only the host can edit)');
			notice.color = '#9ca3af';
			notice.height = '26px';
			detail.addControl(notice);
		}

		sectionLabel(detail, 'Hierarchy');
		const parentRow = row(detail, 'Parent');
		const parent = live.slot.parentId ? sceneGraph.getLive(live.slot.parentId)?.slot.name : null;
		const parentText = new TextBlock('', parent ?? 'Root');
		parentText.color = 'white';
		parentText.width = '180px';
		parentText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		parentRow.addControl(parentText);
		if (editable) {
			const reparentBtn = Button.CreateSimpleButton('reparent-selected', reparentMode ? 'Cancel' : 'Choose parent');
			reparentBtn.width = '150px';
			reparentBtn.height = '34px';
			reparentBtn.color = 'white';
			reparentBtn.background = reparentMode ? '#991b1b' : '#374151';
			reparentBtn.cornerRadius = 6;
			reparentBtn.onPointerClickObservable.add(() => {
				reparentMode = !reparentMode;
				hierarchyTree.refresh();
				showDetail(slotId);
			});
			parentRow.addControl(reparentBtn);
			if (live.slot.parentId) {
				const rootBtn = Button.CreateSimpleButton('move-to-root', 'Move to root');
				rootBtn.width = '140px';
				rootBtn.height = '34px';
				rootBtn.color = 'white';
				rootBtn.background = '#374151';
				rootBtn.cornerRadius = 6;
				rootBtn.onPointerClickObservable.add(() => {
					if (sceneGraph.reparentSlot(slotId, null)) {
						reparentMode = false;
						notifySceneChanged();
						hierarchyTree.refresh();
						showDetail(slotId);
					}
				});
				parentRow.addControl(rootBtn);
			}
		}

		if (editable) {
			sectionLabel(detail, 'Transform');
			numberStepper(
				detail,
				'X',
				0.1,
				() => live.node.position.x,
				(v) => (live.node.position.x = v)
			);
			numberStepper(
				detail,
				'Y',
				0.1,
				() => live.node.position.y,
				(v) => (live.node.position.y = v)
			);
			numberStepper(
				detail,
				'Z',
				0.1,
				() => live.node.position.z,
				(v) => (live.node.position.z = v)
			);

			sectionLabel(detail, 'Rotation / Scale');
			const rotRow = row(detail, 'Rotate Y');
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
				detail,
				'Scale',
				0.1,
				() => live.node.scaling.x,
				(v) => live.node.scaling.set(Math.max(v, 0.05), Math.max(v, 0.05), Math.max(v, 0.05))
			);

			sectionLabel(detail, 'Attributes');
			const grabbable = isGrabbable(live.slot);
			toggleRow(
				detail,
				'Grabbable',
				() => Boolean(isGrabbable(live.slot)),
				() => {
					if (isGrabbable(live.slot)) {
						live.slot.components = live.slot.components.filter((c) => c.type !== 'grabbable');
					} else {
						live.slot.components = [...live.slot.components, { type: 'grabbable', scalable: false }];
					}
					notifySceneChanged();
					showDetail(slotId); // rebuild: the scalable row depends on this
				}
			);
			if (grabbable) {
				toggleRow(
					detail,
					'Scalable',
					() => Boolean(isGrabbable(live.slot)?.scalable),
					() => {
						const g = isGrabbable(live.slot);
						if (g) {
							g.scalable = !g.scalable;
							notifySceneChanged();
						}
					}
				);
			}

			sectionLabel(detail, 'Components');
			const badges = createWrapPanel(detail, DETAIL_INNER_WIDTH);
			for (const c of live.slot.components) {
				const badge = new TextBlock('', COMPONENT_LABELS[c.type] ?? c.type);
				badge.color = '#93c5fd';
				badge.width = '110px';
				badge.height = '28px';
				badge.fontSize = 14;
				badges.addItem(badge, 110);
			}
		}

		// Extensible per-component-type detail (media source, codeBlock debug
		// log, …) — see inspector/componentDetails.ts's renderer registry.
		for (const c of live.slot.components) {
			const renderer = getComponentDetailRenderer(c.type);
			renderer?.(c, {
				slotId,
				sceneGraph,
				container: detail,
				onLiveRefresh: (refresh) => liveRefreshers.push(refresh)
			});
		}

		sectionLabel(detail, 'Actions');
		const actions = createWrapPanel(detail, DETAIL_INNER_WIDTH, '48px');
		for (const folder of availableInventoryFolders(getInventoryContext())) {
			const btn = Button.CreateSimpleButton(`save-${folder.id}`, `Save (${folder.label})`);
			btn.width = '160px';
			btn.height = '44px';
			btn.color = 'white';
			btn.background = '#16a34a';
			btn.cornerRadius = 6;
			btn.paddingRight = '6px';
			btn.onPointerClickObservable.add(() => saveToInventory(slotId, folder.id));
			actions.addItem(btn, 166);
		}
		if (editable) {
			const deleteBtn = Button.CreateSimpleButton('delete-slot', 'Delete');
			deleteBtn.width = '120px';
			deleteBtn.height = '44px';
			deleteBtn.color = 'white';
			deleteBtn.background = '#7f1d1d';
			deleteBtn.cornerRadius = 6;
			deleteBtn.onPointerClickObservable.add(() => {
				sceneGraph.removeSlot(slotId);
				selectedSlotId = null;
				reparentMode = false;
				notifySceneChanged();
				clearContainer(detail);
				liveRefreshers = [];
				hierarchyTree.refresh();
			});
			actions.addItem(deleteBtn, 126);
		}
	}

	hierarchyTree.refresh();
	hierarchySignature = currentHierarchySignature();
	scene.onBeforeRenderObservable.add(() => {
		if (!mesh.isEnabled()) return;
		const currentSignature = currentHierarchySignature();
		if (currentSignature !== hierarchySignature) {
			hierarchySignature = currentSignature;
			hierarchyTree.refresh();
		}
		for (const refresh of liveRefreshers) refresh();
	});

	return { root: node };
}
