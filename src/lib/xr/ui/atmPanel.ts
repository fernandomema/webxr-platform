import { MeshBuilder, Quaternion, StandardMaterial, Color3, type Camera, type Observer, type Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui';
import type { AtmController, AtmState } from '../payments/atmController';
import { yawFacing } from './panelFacing';
import { THEME } from './theme';

const DISTANCE = 1.0;
/** The window puts itself away when nobody uses it, or when the player walks off. */
const AUTO_CLOSE_MS = 120_000;
const WALK_AWAY_METERS = 3.5;
const MAX_PACK_ROWS = 4;

export interface AtmPanelDeps {
	/** Opens the website's credits page (only offered outside a headset, where a page can be opened). */
	openWebsite(): void;
	inXr(): boolean;
}

/**
 * The ATM's window: balance, the packs of credits and, where the store is there, buttons to buy them. It belongs to the game
 * (the `atm` component only asks for it to open), so a world cannot change what it says or what its buttons do.
 */
export function createAtmPanel(scene: Scene, getCamera: () => Camera, atm: AtmController, deps: AtmPanelDeps) {
	const plane = MeshBuilder.CreatePlane('atm-panel', { width: 0.9, height: 1.0 }, scene);
	plane.isPickable = true;
	plane.metadata = { interactive: true };
	plane.setEnabled(false);
	const material = new StandardMaterial('atm-panel-material', scene);
	material.disableLighting = true;
	material.emissiveColor = Color3.White();
	material.backFaceCulling = false;
	plane.material = material;
	const texture = AdvancedDynamicTexture.CreateForMesh(plane, 720, 800, true);

	const background = new Rectangle('atm-background');
	background.width = 1; background.height = 1; background.thickness = 3; background.color = THEME.border; background.background = THEME.panel; background.cornerRadius = 18;
	texture.addControl(background);
	const stack = new StackPanel('atm-stack');
	stack.width = 0.9;
	background.addControl(stack);
	const text = (name: string, height: number, size: number, color: string, bold = false) => {
		const block = new TextBlock(name, '');
		block.height = `${height}px`; block.fontSize = size; block.color = color; block.textWrapping = true;
		if (bold) block.fontWeight = '700';
		stack.addControl(block);
		return block;
	};
	text('atm-title', 56, 32, THEME.muted, true).text = 'ATM';
	const balance = text('atm-balance', 84, 52, THEME.glow, true);
	const caption = text('atm-caption', 36, 22, THEME.muted);
	const message = text('atm-message', 64, 20, THEME.mint);
	const button = (name: string, height: number, background: string) => {
		const control = Button.CreateSimpleButton(name, '');
		control.height = `${height}px`; control.color = THEME.text; control.background = background; control.fontSize = 24; control.cornerRadius = 12; control.thickness = 0; control.paddingTop = '8px';
		stack.addControl(control);
		return control;
	};
	const rows = Array.from({ length: MAX_PACK_ROWS }, (_, index) => {
		const row = button(`atm-pack-${index}`, 72, THEME.accent);
		row.onPointerClickObservable.add(() => { const id = (row.metadata as { packId?: string } | undefined)?.packId; if (id) void atm.buy(id); });
		return row;
	});
	const note = text('atm-note', 90, 19, THEME.muted);
	const website = button('atm-website', 64, THEME.raised);
	website.textBlock!.text = 'Open the website';
	website.onPointerClickObservable.add(() => deps.openWebsite());
	const retry = button('atm-retry', 64, THEME.raised);
	retry.textBlock!.text = 'Try again';
	retry.onPointerClickObservable.add(() => void atm.open());
	const close = button('atm-close', 64, THEME.raised);
	close.textBlock!.text = 'Close';

	let unsubscribe: (() => void) | null = null;
	let follow: Observer<Scene> | null = null;
	let autoClose: ReturnType<typeof setTimeout> | undefined;

	function render(state: AtmState) {
		balance.text = state.phase === 'ready' ? state.balance.toLocaleString() : state.phase === 'loading' ? '…' : '—';
		caption.text = state.phase === 'ready' ? 'credits' : '';
		message.text = state.phase === 'signed-out' ? 'Sign in to use credits.' : state.phase === 'loading' ? 'Loading your account…' : state.message;
		message.color = state.phase === 'error' ? THEME.ember : THEME.mint;
		rows.forEach((row, index) => {
			const pack = state.phase === 'ready' ? state.packs[index] : undefined;
			row.isVisible = Boolean(pack) && state.canBuyHere;
			row.metadata = { packId: pack?.id };
			if (pack) row.textBlock!.text = state.busy === pack.id ? 'Paying…' : `${pack.credits.toLocaleString()} credits · ${pack.priceLabel}`;
			row.isEnabled = !state.busy;
			row.alpha = state.busy ? 0.6 : 1;
		});
		const cannotBuy = state.phase === 'ready' && !state.canBuyHere;
		note.text = cannotBuy ? (deps.inXr() ? 'Credits are bought on the website: open this site on a computer or phone, sign in and go to Settings, then Credits.' : 'Credits are bought on the website.') : '';
		website.isVisible = cannotBuy && !deps.inXr();
		retry.isVisible = state.phase === 'error';
		close.isEnabled = !state.busy;
	}

	function hide() {
		clearTimeout(autoClose);
		unsubscribe?.();
		unsubscribe = null;
		if (follow) scene.onBeforeRenderObservable.remove(follow);
		follow = null;
		plane.setEnabled(false);
	}
	close.onPointerClickObservable.add(hide);

	function open() {
		hide();
		const camera = getCamera();
		const forward = camera.getForwardRay().direction;
		plane.position.copyFrom(camera.globalPosition.add(forward.scale(DISTANCE)));
		plane.rotationQuaternion = Quaternion.FromEulerAngles(0, yawFacing(plane.position, camera.globalPosition), 0);
		plane.setEnabled(true);
		unsubscribe = atm.subscribe(render);
		void atm.open();
		autoClose = setTimeout(hide, AUTO_CLOSE_MS);
		follow = scene.onBeforeRenderObservable.add(() => {
			if (getCamera().globalPosition.subtract(plane.position).length() > WALK_AWAY_METERS) hide();
		});
	}

	return {
		open,
		close: hide,
		get isOpen() { return plane.isEnabled(); },
		dispose() {
			hide();
			texture.dispose(); material.dispose(); plane.dispose();
		}
	};
}
