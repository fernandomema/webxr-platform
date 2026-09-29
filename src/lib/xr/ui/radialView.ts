import { Color3, MeshBuilder, Quaternion, StandardMaterial, Vector3, type Scene, type TransformNode, type Camera } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button } from '@babylonjs/gui';

export interface RadialItem {
	label: string;
	isEnabled(): boolean;
	onSelect(): void | Promise<void>;
}

/** Visual/layout layer shared by hand and world-anchored radial menus. */
export function createRadialView(
	scene: Scene,
	id: string,
	getCamera: () => Camera,
	options: { pointerSelectable: boolean; size: number; offset?: Vector3 }
) {
	const plane = MeshBuilder.CreatePlane(`radial-${id}`, { size: options.size }, scene);
	const material = new StandardMaterial(`radial-material-${id}`, scene);
	material.disableLighting = true;
	material.emissiveColor = Color3.White();
	material.backFaceCulling = false;
	plane.material = material;
	plane.isPickable = options.pointerSelectable;
	plane.metadata = { interactive: options.pointerSelectable, radialMenu: true };
	plane.setEnabled(false);
	const texture = AdvancedDynamicTexture.CreateForMesh(plane, 512, 512, true);
	let items: RadialItem[] = [];
	let buttons: Button[] = [];
	let anchor: TransformNode | null = null;
	let hoveredIndex = -1;

	function highlight() {
		buttons.forEach((button, index) => {
			const enabled = items[index].isEnabled();
			button.alpha = enabled ? 1 : 0.45;
			button.background = !enabled ? '#374151' : hoveredIndex === index ? '#6d28d9' : '#1f2937';
		});
	}

	function close() {
		plane.setEnabled(false);
		anchor = null;
		items = [];
		buttons = [];
		texture.clear();
	}

	function open(node: TransformNode, nextItems: RadialItem[]) {
		close();
		if (nextItems.length === 0) return;
		anchor = node;
		items = nextItems;
		buttons = nextItems.map((item, index) => {
			const angle = (2 * Math.PI * index) / nextItems.length - Math.PI / 2;
			const button = Button.CreateSimpleButton(`radial-${id}-${index}`, item.label);
			button.width = '116px';
			button.height = '116px';
			button.cornerRadius = 58;
			button.color = 'white';
			button.fontSize = 17;
			button.left = `${Math.cos(angle) * 155}px`;
			button.top = `${Math.sin(angle) * 155}px`;
			if (options.pointerSelectable) button.onPointerClickObservable.add(() => void select(index));
			texture.addControl(button);
			return button;
		});
		hoveredIndex = 0;
		highlight();
		plane.setEnabled(true);
	}

	async function select(index: number) {
		const item = items[index];
		if (!item?.isEnabled()) return;
		close();
		await item.onSelect();
	}

	const observer = scene.onBeforeRenderObservable.add(() => {
		if (!anchor || !plane.isEnabled()) return;
		plane.position.copyFrom(anchor.absolutePosition.add(options.offset ?? Vector3.Zero()));
		const camera = getCamera();
		const dx = camera.globalPosition.x - plane.position.x;
		const dz = camera.globalPosition.z - plane.position.z;
		// +Math.PI: the plane's GUI-textured face is on its -Z side, so without it the menu is seen from behind (mirrored text).
		plane.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.atan2(dx, dz) + Math.PI, 0);
		highlight();
	});

	return {
		plane,
		open,
		close,
		select,
		setHovered(index: number) { hoveredIndex = index; highlight(); },
		get itemCount() { return items.length; },
		get isOpen() { return plane.isEnabled(); },
		dispose() { close(); scene.onBeforeRenderObservable.remove(observer); texture.dispose(); material.dispose(); plane.dispose(); }
	};
}
