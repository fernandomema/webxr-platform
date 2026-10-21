import { MeshBuilder, Quaternion, StandardMaterial, Color3, Vector3, type Camera, type Observer, type Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui';
import type { PurchasePromptChoice, PurchasePromptDetails } from '../payments/types';
import { yawFacing } from './panelFacing';
import { THEME } from './theme';

/** Drawn after (over) everything else in the scene, whatever a world has built around the player. */
const FRONT_RENDERING_GROUP = 3;
const DISTANCE = 0.9;
/** The pay button only works after this long, so a trigger pull that was meant for something else cannot approve it. */
const ARM_DELAY_MS = 1200;

/**
 * The window that asks the player to approve a purchase. It belongs to the game, not to the world: it is not a slot, so no
 * script can see, move, hide or click it; it is drawn in front of everything and follows the player's head; and the text on
 * it is what the server said the product costs, never what the script that asked says. Only a click on its own buttons
 * leads to a charge.
 */
export function createPurchasePrompt(scene: Scene, getCamera: () => Camera) {
	scene.setRenderingAutoClearDepthStencil(FRONT_RENDERING_GROUP, true, true, true);
	const plane = MeshBuilder.CreatePlane('purchase-prompt', { width: 0.9, height: 0.8 }, scene);
	plane.renderingGroupId = FRONT_RENDERING_GROUP;
	plane.isPickable = true;
	plane.metadata = { interactive: true };
	plane.setEnabled(false);
	const material = new StandardMaterial('purchase-prompt-material', scene);
	material.disableLighting = true;
	material.emissiveColor = Color3.White();
	material.backFaceCulling = false;
	plane.material = material;
	const texture = AdvancedDynamicTexture.CreateForMesh(plane, 720, 640, true);

	const background = new Rectangle('purchase-background');
	background.width = 1; background.height = 1; background.thickness = 4; background.color = THEME.accentBorder; background.background = THEME.panel; background.cornerRadius = 18;
	texture.addControl(background);
	const stack = new StackPanel('purchase-stack');
	stack.width = 0.9;
	background.addControl(stack);
	const text = (name: string, height: number, size: number, color: string, bold = false) => {
		const block = new TextBlock(name, '');
		block.height = `${height}px`; block.fontSize = size; block.color = color; block.textWrapping = true;
		if (bold) block.fontWeight = '700';
		stack.addControl(block);
		return block;
	};
	text('purchase-heading', 48, 26, THEME.muted).text = 'Approve this purchase?';
	const world = text('purchase-world', 40, 22, THEME.muted);
	const product = text('purchase-product', 78, 38, THEME.text, true);
	const price = text('purchase-price', 64, 36, THEME.glow, true);
	const balance = text('purchase-balance', 40, 22, THEME.muted);
	const notice = text('purchase-notice', 70, 17, THEME.dim);
	notice.text = 'Only you can approve this. A world cannot spend your credits without this window.';
	const button = (name: string, label: string, background: string) => {
		const control = Button.CreateSimpleButton(name, label);
		control.height = '64px'; control.color = THEME.text; control.background = background; control.fontSize = 24; control.cornerRadius = 12; control.thickness = 0;
		control.paddingTop = '6px';
		stack.addControl(control);
		return control;
	};
	const pay = button('purchase-pay', 'Pay', THEME.go);
	const topUp = button('purchase-topup', 'Add credits', THEME.accent);
	const cancel = button('purchase-cancel', 'Cancel', THEME.raised);

	let settle: ((choice: PurchasePromptChoice) => void) | null = null;
	let follow: Observer<Scene> | null = null;
	let armTimer: ReturnType<typeof setTimeout> | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	function finish(choice: PurchasePromptChoice) {
		clearTimeout(armTimer);
		clearTimeout(closeTimer);
		if (follow) scene.onBeforeRenderObservable.remove(follow);
		follow = null;
		plane.setEnabled(false);
		const done = settle;
		settle = null;
		done?.(choice);
	}
	pay.onPointerClickObservable.add(() => { if (pay.isEnabled) finish('pay'); });
	topUp.onPointerClickObservable.add(() => finish('topup'));
	cancel.onPointerClickObservable.add(() => finish('cancel'));

	function place() {
		const camera = getCamera();
		const forward = camera.getForwardRay().direction;
		plane.position.copyFrom(camera.globalPosition.add(forward.scale(DISTANCE)).add(new Vector3(0, -0.04, 0)));
		plane.rotationQuaternion = Quaternion.FromEulerAngles(0, yawFacing(plane.position, camera.globalPosition), 0);
	}

	return {
		get isOpen() { return settle !== null; },
		/** Shows the prompt and resolves with the player's choice (`cancel` if it times out or another prompt replaces it). */
		show(details: PurchasePromptDetails): Promise<PurchasePromptChoice> {
			finish('cancel');
			world.text = `${details.worldName} · by ${details.owner}`;
			product.text = details.productName;
			price.text = `${details.price.toLocaleString()} credits`;
			const short = details.balance < details.price;
			balance.text = short ? `You have ${details.balance.toLocaleString()}. You need ${(details.price - details.balance).toLocaleString()} more.` : `You have ${details.balance.toLocaleString()} credits`;
			balance.color = short ? THEME.ember : THEME.muted;
			pay.isVisible = !short;
			topUp.isVisible = short && details.canTopUp;
			pay.isEnabled = false;
			pay.background = THEME.raised;
			pay.textBlock!.text = 'Pay';
			armTimer = setTimeout(() => { pay.isEnabled = true; pay.background = THEME.go; }, ARM_DELAY_MS);
			closeTimer = setTimeout(() => finish('cancel'), details.timeoutMs);
			place();
			plane.setEnabled(true);
			follow = scene.onBeforeRenderObservable.add(place);
			return new Promise((resolve) => { settle = resolve; });
		},
		close: () => finish('cancel'),
		dispose() {
			finish('cancel');
			texture.dispose(); material.dispose(); plane.dispose();
		}
	};
}
