import {
	Color3,
	KeyboardEventTypes,
	MeshBuilder,
	Quaternion,
	StandardMaterial,
	Vector3,
	type AbstractMesh,
	type Mesh,
	type Scene,
	type TransformNode,
	type UniversalCamera
} from '@babylonjs/core';
import { fitPanel, viewSizeAt } from './desktopMath';

/** How far in front of the eye a full-screen panel sits. Its size is worked out from this so it fills the view whatever it is. */
const DOCK_DISTANCE = 1;
/** Drawn after the world and the radial menu, each group with its own depth, so nothing of the world can poke through. */
const BACKDROP_GROUP = 2;
const PANEL_GROUP = 3;
const BACKDROP_ALPHA = 0.6;

export interface DockablePanel {
	name: string;
	/** The panel's mesh. It is enabled and disabled by whatever opens it (a key, a button, the page inside it). */
	root: TransformNode;
}

export interface DesktopPanels {
	/** The panel that fills the screen now, if one does. */
	readonly docked: DockablePanel | null;
	close(): void;
	dispose(): void;
}

interface Saved {
	parent: TransformNode['parent'];
	position: Vector3;
	rotation: Vector3;
	rotationQuaternion: Quaternion | null;
	scaling: Vector3;
	renderingGroupId: number;
	picks: [AbstractMeshPredicate | undefined, AbstractMeshPredicate | undefined, AbstractMeshPredicate | undefined];
}

type AbstractMeshPredicate = (mesh: AbstractMesh) => boolean;

/**
 * On desktop the personal menu and the inspector are not objects standing in the world: when one opens (by whichever
 * way: its key, a button, its own close control), it is put in front of the camera, sized to fill the screen over a dimmed
 * backdrop, with the mouse freed to use it like any page. When it closes it goes back to where it was.
 *
 * It watches the panels' `isEnabled` rather than being told, so it does not matter what opened them. Only one is shown at
 * a time: opening the other one replaces it.
 */
export function setupDesktopPanels(
	scene: Scene,
	camera: UniversalCamera,
	panels: DockablePanel[],
	options: { isXr(): boolean; onDockChange(panel: DockablePanel | null): void }
): DesktopPanels {
	const aspects = new Map(panels.map((panel) => [panel, (panel.root as Mesh).scaling.x / (panel.root as Mesh).scaling.y]));
	const backdrop = MeshBuilder.CreatePlane('desktop-panel-backdrop', { size: 1 }, scene);
	const backdropMaterial = new StandardMaterial('desktop-panel-backdrop-material', scene);
	backdropMaterial.emissiveColor = Color3.Black();
	backdropMaterial.disableLighting = true;
	backdropMaterial.backFaceCulling = false;
	backdropMaterial.alpha = BACKDROP_ALPHA;
	backdrop.material = backdropMaterial;
	backdrop.isPickable = false;
	backdrop.renderingGroupId = BACKDROP_GROUP;
	backdrop.parent = camera;
	backdrop.position.set(0, 0, DOCK_DISTANCE + 0.01);
	backdrop.setEnabled(false);
	scene.setRenderingAutoClearDepthStencil(BACKDROP_GROUP, true, true, true);
	scene.setRenderingAutoClearDepthStencil(PANEL_GROUP, true, true, true);

	let docked: DockablePanel | null = null;
	let saved: Saved | null = null;

	function dock(panel: DockablePanel): void {
		const root = panel.root as Mesh;
		saved = {
			parent: root.parent,
			position: root.position.clone(),
			rotation: root.rotation.clone(),
			rotationQuaternion: root.rotationQuaternion?.clone() ?? null,
			scaling: root.scaling.clone(),
			renderingGroupId: root.renderingGroupId,
			picks: [scene.pointerMovePredicate, scene.pointerDownPredicate, scene.pointerUpPredicate]
		};
		root.parent = camera;
		root.rotationQuaternion = Quaternion.Identity();
		root.position.set(0, 0, DOCK_DISTANCE);
		root.renderingGroupId = PANEL_GROUP;
		// The panel is in front of everything in the picture, so it is also first for the mouse: what is behind it is not hit.
		const onlyPanel: AbstractMeshPredicate = (mesh) => mesh === root;
		scene.pointerMovePredicate = scene.pointerDownPredicate = scene.pointerUpPredicate = onlyPanel;
		backdrop.setEnabled(true);
		docked = panel;
		options.onDockChange(panel);
	}

	function undock(): void {
		const panel = docked;
		const previous = saved;
		docked = null;
		saved = null;
		backdrop.setEnabled(false);
		if (panel && previous) {
			const root = panel.root as Mesh;
			root.parent = previous.parent;
			root.position.copyFrom(previous.position);
			root.rotation.copyFrom(previous.rotation);
			root.rotationQuaternion = previous.rotationQuaternion;
			root.scaling.copyFrom(previous.scaling);
			root.renderingGroupId = previous.renderingGroupId;
			[scene.pointerMovePredicate, scene.pointerDownPredicate, scene.pointerUpPredicate] = previous.picks as [AbstractMeshPredicate, AbstractMeshPredicate, AbstractMeshPredicate];
		}
		options.onDockChange(null);
	}

	function fit(panel: DockablePanel): void {
		const aspect = aspects.get(panel) ?? 1.5;
		const view = viewSizeAt(DOCK_DISTANCE, camera.fov, scene.getEngine().getAspectRatio(camera));
		const size = fitPanel(view.width, view.height, aspect);
		(panel.root as Mesh).scaling.set(size.width, size.height, 1);
		backdrop.scaling.set(view.width * 1.2, view.height * 1.2, 1);
	}

	const frameObserver = scene.onBeforeRenderObservable.add(() => {
		if (options.isXr()) {
			if (docked) undock();
			return;
		}
		if (docked && !docked.root.isEnabled()) undock();
		const opened = panels.find((panel) => panel !== docked && panel.root.isEnabled());
		if (opened) {
			if (docked) {
				docked.root.setEnabled(false);
				undock();
			}
			dock(opened);
		}
		if (docked) fit(docked);
	});

	const keyObserver = scene.onKeyboardObservable.add((info) => {
		if (docked && info.type === KeyboardEventTypes.KEYDOWN && info.event.code === 'Escape') docked.root.setEnabled(false);
	});

	return {
		get docked() {
			return docked;
		},
		close() {
			docked?.root.setEnabled(false);
		},
		dispose() {
			scene.onBeforeRenderObservable.remove(frameObserver);
			scene.onKeyboardObservable.remove(keyObserver);
			if (docked) undock();
			backdrop.dispose();
			backdropMaterial.dispose();
		}
	};
}
