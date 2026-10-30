import { Quaternion, type Scene } from '@babylonjs/core';
import type { Vec3, Quat } from '../../ecs/types.ts';
import type { SceneGraph } from '../sceneGraph.ts';
import type { GrabSystem } from './grabSystem.ts';
import { pinnedUiFrom } from '../ui/dashGrid.ts';
import { gridDropTargets, type GridDropTarget } from '../ui/gridDrop.ts';

/**
 * Lets a player keep a piece of UI: with a grid open for editing (the Home tab, a custom tab, a panel of a world), hold any panel (or control of a panel) over it to see
 * where it would go, and let go of it there to keep a copy, with its scripts, in every world from then on. The grabbed object is
 * the player's to keep wherever it came from (the world, their inventory, a thrown copy), so this looks only at where it is held.
 * What was a part of a world goes back to where it was taken from, so a copy is not left floating over the menu; that is done where
 * the world is decided (the host or a solo player), as a guest's release is applied by the host.
 */
export class DashPinSystem {
	private before = new Map<string, { position: Vec3; rotation: Quat }>();
	/** The UI being held, with the size of its panel (for the preview). */
	private held = new Map<string, { width: number; height: number }>();
	/** The grid that is showing a preview now. */
	private previewing: GridDropTarget | null = null;

	constructor(
		scene: Scene,
		private sceneGraph: SceneGraph,
		grabSystem: GrabSystem,
		private isHost: () => boolean
	) {
		grabSystem.addListener({
			onGrab: (slotId) => this.handleGrab(slotId),
			onRelease: (slotId) => this.handleRelease(slotId)
		});
		scene.onBeforeRenderObservable.add(() => this.preview());
	}

	private handleGrab(slotId: string): void {
		const node = this.sceneGraph.getLive(slotId)?.node;
		if (!node) return;
		this.before.set(slotId, { position: node.position.asArray() as Vec3, rotation: (node.rotationQuaternion ?? Quaternion.Identity()).asArray() as Quat });
		const ui = this.sceneGraph.getLive(slotId)?.system ? null : pinnedUiFrom(this.sceneGraph.serialize({ withExternal: true }), slotId);
		if (ui) this.held.set(slotId, ui.panel);
	}

	/** The open grid a point of the world is over, with where on it. */
	private gridAt(world: Parameters<GridDropTarget['pointAt']>[0]): { target: GridDropTarget; point: { x: number; y: number } } | null {
		for (const target of gridDropTargets()) {
			if (!target.isOpen()) continue;
			const point = target.pointAt(world);
			if (point) return { target, point };
		}
		return null;
	}

	private stopPreview(): void {
		this.previewing?.previewDrop(null, null);
		this.previewing = null;
	}

	/** Each frame, shows where what is held over an open grid would land. */
	private preview(): void {
		for (const [slotId, panel] of this.held) {
			const node = this.sceneGraph.getLive(slotId)?.node;
			if (!node) continue;
			node.computeWorldMatrix(true);
			const over = this.gridAt(node.getAbsolutePosition());
			if (!over) continue;
			if (this.previewing && this.previewing !== over.target) this.stopPreview();
			over.target.previewDrop(panel, over.point);
			this.previewing = over.target;
			return;
		}
		this.stopPreview();
	}

	private handleRelease(slotId: string): void {
		const start = this.before.get(slotId);
		this.before.delete(slotId);
		this.held.delete(slotId);
		this.stopPreview();
		const live = this.sceneGraph.getLive(slotId);
		if (!live || live.system) return;
		live.node.computeWorldMatrix(true);
		const over = this.gridAt(live.node.getAbsolutePosition());
		if (!over) return;
		const outcome = over.target.pinUi(this.sceneGraph.serialize({ withExternal: true }), slotId, over.point);
		if (outcome !== 'pinned' || !start || !this.isHost()) return;
		this.sceneGraph.placeSlotLocal(slotId, start.position, start.rotation);
	}
}
