import {
	Color3,
	DynamicTexture,
	Mesh,
	MeshBuilder,
	PointerEventTypes,
	Quaternion,
	Ray,
	StandardMaterial,
	Vector3,
	VertexData,
	WebXRFeatureName,
	WebXRHandJoint,
	WebXRState,
	type AbstractMesh,
	type Scene,
	type TransformNode,
	type WebXRDefaultExperience,
	type WebXRHandTracking,
	type WebXRInputSource
} from '@babylonjs/core';
import type { KeyboardKeyComponent, SlotTree } from '$lib/ecs/types';
import { instantiate } from '$lib/ecs/serialize';
import type { SceneGraph } from '../sceneGraph';
import { setupImpactSound } from '../impactSoundEffects';
import { saveSettings, xrSettings } from '../settings';
import frameTemplate from '../templates/keyboard.json';
import { initialEditorState, pickCandidate, pressKey, shownText, switchLayout, type EditorResult, type EditorState } from './editor';
import { getComposer } from './composer';
import { keyLabel, keyVariants, placeKeys, type KeyDef, type KeyboardLayout } from './layout';
import { nextLayout, preferredLayout } from './layouts';
import type { KeyboardPresence } from './presence';
import type { TextInputHandlers, TextInputProvider, TextInputRequest, TextInputSession } from './service';
import { THEME } from '../ui/theme';

/**
 * The in-world keyboard: brought up near whoever asks for text (see service.ts), typed on with the laser or by touching
 * the keys, and put away with enter or its close key. It is made of slots (its frame from templates/keyboard.json, its
 * keys built from the layout in use), added as system slots: they are never saved with the world or sent to anyone.
 * Other players only see a blank stand-in of it (see remoteKeyboards.ts).
 *
 * Keyboard space: +X to the typist's right, +Y out of the board, +Z away from the typist.
 */

/** Distance between neighbouring keys, the size of a key, and how far a key goes down. */
const PITCH = 0.042;
const KEY = 0.036;
const KEY_HEIGHT = 0.012;
const TRAVEL = 0.006;
/** How long a key is held before its variants are offered, and how fast backspace repeats. */
const HOLD_MS = 450;
/** Right after the keyboard appears nothing types: it may have come up around a hand, or under a laser still pressed. */
const SPAWN_GRACE_MS = 400;
const REPEAT_MS = 65;
/** Keys that go on by themselves while held down. */
const REPEATS = new Set<KeyDef['action']>(['backspace', 'left', 'right']);

const COLORS = { key: THEME.surface, action: THEME.raised, hover: '#3a3a55', down: THEME.accentBorder, locked: THEME.accent, variant: THEME.accentSoft, candidate: '#1d3345' };

interface LiveKey {
	slotId: string;
	node: AbstractMesh;
	def: KeyDef;
	/** A variant offered by holding a key down, or a composer candidate. */
	variant?: string;
	candidate?: number;
	/** Centre on the board and size, in metres. */
	x: number;
	z: number;
	width: number;
	depth: number;
	label: Mesh;
	/** How far each finger or laser has it pushed down. */
	pressedBy: Map<string, number>;
	hovered: boolean;
	color: string;
}

interface Press {
	key: LiveKey;
	at: number;
	/** Whether the key has already done its thing (on the way down, or by being held). */
	done: boolean;
	repeatAt: number;
}

interface Tip {
	marker: Mesh;
	/** The tip has come off the keys since its last press: sliding across the board does not type. */
	armed: boolean;
	key: LiveKey | null;
}

interface Session {
	token: number;
	request: TextInputRequest;
	handlers: TextInputHandlers;
}

/** The page's language, which picks the layout until one is chosen. */
const pageLanguage = () => document.documentElement.lang || navigator.language || 'en';

/** Without the default white shine a dark key under the world's light washes out to grey, and its label with it. */
function matte(node: TransformNode): void {
	// An instanced shape shares its material with every other (already softly lit): only a mesh of its own is changed.
	if ((node as AbstractMesh).getClassName?.() === 'InstancedMesh') return;
	// By class name: the material may come from another copy of Babylon's module than this file's import.
	const material = (node as AbstractMesh).material;
	if (material?.getClassName() === 'StandardMaterial') (material as StandardMaterial).specularColor = Color3.Black();
}

export class KeyboardSystem implements TextInputProvider {
	private layout: KeyboardLayout;
	private state!: EditorState;
	private session: Session | null = null;
	private token = 0;
	private rootId: string | null = null;
	private parts = new Map<string, TransformNode>();
	private keys: LiveKey[] = [];
	private keyByNode = new Map<AbstractMesh, LiveKey>();
	private variantsFor: LiveKey | null = null;
	private presses = new Map<string, Press>();
	private tips = new Map<string, Tip>();
	private atlas: DynamicTexture | null = null;
	private atlasMaterial: StandardMaterial;
	private preview: DynamicTexture | null = null;
	private previewMaterial: StandardMaterial;
	private size = { width: 0, depth: 0 };
	/** The layout setting last applied, to notice it being changed from the settings. */
	private layoutSetting: string | null;
	private spawnedAt = 0;
	private readonly observers: Array<() => void> = [];

	constructor(
		private scene: Scene,
		private sceneGraph: SceneGraph,
		private xr: WebXRDefaultExperience,
		/** Where the player's avatar has the tip of its index finger, so keys are pressed where they see their finger. */
		private fingertip?: (side: 'left' | 'right') => Vector3 | null
	) {
		this.layoutSetting = xrSettings.keyboardLayout;
		this.layout = preferredLayout(this.layoutSetting, pageLanguage());
		this.atlasMaterial = new StandardMaterial('keyboard-labels', scene);
		this.atlasMaterial.disableLighting = true;
		this.atlasMaterial.diffuseColor = Color3.Black();
		this.atlasMaterial.backFaceCulling = false;
		this.previewMaterial = new StandardMaterial('keyboard-preview', scene);
		this.previewMaterial.disableLighting = true;
		this.previewMaterial.diffuseColor = Color3.Black();

		const frame = scene.onBeforeRenderObservable.add(() => this.update());
		const pointer = scene.onPointerObservable.add((info) => {
			const mesh = info.pickInfo?.pickedMesh;
			const source = `laser:${(info.event as PointerEvent).pointerId ?? 0}`;
			if (info.type === PointerEventTypes.POINTERDOWN) {
				const key = mesh ? this.keyByNode.get(mesh) : undefined;
				if (key) this.keyDown(key, source, TRAVEL);
			} else if (info.type === PointerEventTypes.POINTERUP) {
				this.keyUp(source);
			}
		});
		const leaving = xr.baseExperience.onStateChangedObservable.add((state) => {
			if (state === WebXRState.EXITING_XR || state === WebXRState.NOT_IN_XR) this.close(true);
		});
		this.observers.push(
			() => scene.onBeforeRenderObservable.remove(frame),
			() => scene.onPointerObservable.remove(pointer),
			() => xr.baseExperience.onStateChangedObservable.remove(leaving)
		);
	}

	// --- the service ------------------------------------------------------------------------------------------------

	request(request: TextInputRequest, handlers: TextInputHandlers): TextInputSession | null {
		if (this.xr.baseExperience.state !== WebXRState.IN_XR) return null;
		// Whoever had the keyboard before is done with it.
		if (this.session) this.session.handlers.onClose?.(shownText(this.state));
		const token = ++this.token;
		this.session = { token, request, handlers };
		this.state = initialEditorState(this.layout, request.initial ?? '', request.maxLength, request.multiline);
		if (!this.rootId || this.tooFar()) this.spawn(request.near ?? null);
		else this.drawPreview();
		return {
			close: () => {
				if (this.session?.token === token) this.close(false);
			},
			setText: (text) => {
				if (this.session?.token !== token) return;
				this.state = initialEditorState(this.layout, text, request.maxLength, request.multiline);
				this.drawPreview();
			}
		};
	}

	/** Where the keyboard's body is (its centre) and how big: all the others get to know about it. */
	presence(): KeyboardPresence | null {
		const root = this.rootId ? this.sceneGraph.getLive(this.rootId)?.node : null;
		const body = this.parts.get('Body') ?? root;
		if (!root || !body) return null;
		root.computeWorldMatrix(true);
		body.computeWorldMatrix(true);
		const rotation = new Quaternion();
		root.getWorldMatrix().decompose(undefined, rotation, undefined);
		const round = (v: number) => Math.round(v * 1000) / 1000;
		return {
			position: body.absolutePosition.asArray().map(round) as KeyboardPresence['position'],
			rotation: rotation.asArray().map(round) as KeyboardPresence['rotation'],
			width: round(this.size.width),
			depth: round(this.size.depth)
		};
	}

	dispose(): void {
		this.close(true);
		for (const remove of this.observers) remove();
		for (const tip of this.tips.values()) tip.marker.dispose();
		this.atlasMaterial.dispose();
		this.previewMaterial.dispose();
	}

	// --- bringing it up and putting it away ---------------------------------------------------------------------------

	private head(): { position: Vector3; forward: Vector3 } {
		const camera = this.xr.baseExperience.camera;
		const forward = camera.getForwardRay().direction;
		const flat = new Vector3(forward.x, 0, forward.z);
		return { position: camera.globalPosition.clone(), forward: flat.lengthSquared() > 1e-6 ? flat.normalize() : new Vector3(0, 0, 1) };
	}

	private tooFar(): boolean {
		const root = this.rootId ? this.sceneGraph.getLive(this.rootId)?.node : null;
		return !root || Vector3.Distance(root.getAbsolutePosition(), this.head().position) > 2.5;
	}

	/** In front of the player at chest height, leaning towards them, between them and whatever asked (if it is near). */
	private placement(near: TransformNode | null): { position: Vector3; rotation: Quaternion } {
		const head = this.head();
		let forward = head.forward;
		let distance = 0.4;
		if (near) {
			near.computeWorldMatrix(true);
			const toTarget = near.getAbsolutePosition().subtract(head.position);
			toTarget.y = 0;
			const length = toTarget.length();
			if (length > 0.2 && length < 3) {
				forward = toTarget.scale(1 / length);
				distance = Math.min(0.4, length - 0.2);
			}
		}
		const position = head.position.add(forward.scale(distance)).add(new Vector3(0, -0.42, 0));
		const yaw = Quaternion.RotationAxis(Vector3.Up(), Math.atan2(forward.x, forward.z));
		const tilt = Quaternion.RotationAxis(Vector3.Right(), (-25 * Math.PI) / 180);
		return { position, rotation: yaw.multiply(tilt) };
	}

	private spawn(near: TransformNode | null): void {
		this.removeSlots();
		const { position, rotation } = this.placement(near);
		const tree = instantiate(frameTemplate as SlotTree, position.asArray() as [number, number, number]);
		tree[0] = { ...tree[0], rotation: rotation.asArray() as [number, number, number, number] };
		for (const slot of tree) this.sceneGraph.addSlot(slot, { system: true });
		this.rootId = tree[0].id;
		// A finger that is already in the keys when they appear has to come out above them before it can type.
		this.spawnedAt = performance.now();
		for (const tip of this.tips.values()) tip.armed = false;
		this.parts.clear();
		for (const slot of tree) {
			const node = this.sceneGraph.getLive(slot.id)?.node;
			if (!node) continue;
			this.parts.set(slot.name, node);
			matte(node);
		}
		const previewNode = this.parts.get('Preview') as Mesh | undefined;
		if (previewNode) {
			this.preview = new DynamicTexture('keyboard-preview-text', { width: 1024, height: 128 }, this.scene, true);
			this.previewMaterial.emissiveTexture = this.preview;
			previewNode.material = this.previewMaterial;
			previewNode.isPickable = false;
		}
		this.buildKeys();
	}

	/** Puts the keyboard away. `silently` when nobody should be told (the headset session ended, or it is being replaced). */
	private close(silently: boolean): void {
		const session = this.session;
		this.session = null;
		if (session && !silently) session.handlers.onClose?.(shownText(this.state));
		this.removeSlots();
	}

	private removeSlots(): void {
		for (const key of this.keys) key.label.dispose();
		this.keys = [];
		this.keyByNode.clear();
		this.variantsFor = null;
		this.presses.clear();
		if (this.rootId) this.sceneGraph.removeSlot(this.rootId);
		this.rootId = null;
		this.parts.clear();
		this.atlas?.dispose();
		this.atlas = null;
		this.preview?.dispose();
		this.preview = null;
		for (const tip of this.tips.values()) tip.marker.setEnabled(false);
	}

	// --- keys -------------------------------------------------------------------------------------------------------

	/** Builds the keys of the current page (plus the frame's own close key), and fits the frame round them. */
	private buildKeys(): void {
		const anchor = this.parts.get('Keys');
		if (!anchor || !this.rootId) return;
		for (const key of this.keys) {
			key.label.dispose();
			if (!this.isFramePart(key.slotId)) this.sceneGraph.removeSlot(key.slotId);
		}
		this.keys = [];
		this.keyByNode.clear();
		this.variantsFor = null;

		const rows = this.layout.pages[this.state.page] ?? this.layout.pages[this.layout.firstPage];
		const placed = placeKeys(rows);
		const composing = getComposer(this.layout.composer).id !== 'direct';
		this.fitFrame(placed.width * PITCH, placed.height * PITCH, composing);
		for (const p of placed.keys) {
			const z = ((placed.height - 1) / 2 - p.y) * PITCH;
			this.addKey(anchor, p.key, p.x * PITCH, z, p.width * PITCH - (PITCH - KEY), KEY, {});
		}
		// The frame's close key is a key like the others, only authored in the template.
		const closeNode = this.parts.get('Close');
		const closeSlot = closeNode ? this.sceneGraph.getSlotIdForNode(closeNode) : null;
		if (closeNode && closeSlot) {
			const def = this.sceneGraph.getLive(closeSlot)?.slot.components.find((c) => c.type === 'keyboardKey') as KeyboardKeyComponent | undefined;
			if (def) this.trackKey({ slotId: closeSlot, node: closeNode as AbstractMesh, def: def.key, x: closeNode.position.x, z: closeNode.position.z, width: KEY, depth: KEY, onBoard: false });
		}
		this.drawLabels();
		this.drawPreview();
	}

	private isFramePart(slotId: string): boolean {
		for (const node of this.parts.values()) if (this.sceneGraph.getSlotIdForNode(node) === slotId) return true;
		return false;
	}

	private addKey(anchor: TransformNode, def: KeyDef, x: number, z: number, width: number, depth: number, extra: { variant?: string; candidate?: number; lift?: number }): LiveKey {
		const lift = extra.lift ?? 0;
		const slotId = crypto.randomUUID();
		const color = extra.variant !== undefined ? COLORS.variant : extra.candidate !== undefined ? COLORS.candidate : def.text !== undefined ? COLORS.key : COLORS.action;
		const component: KeyboardKeyComponent = { type: 'keyboardKey', key: def, ...(extra.variant !== undefined ? { variant: extra.variant } : {}), ...(extra.candidate !== undefined ? { candidate: extra.candidate } : {}) };
		this.sceneGraph.addSlot(
			{
				id: slotId,
				parentId: this.sceneGraph.getSlotIdForNode(anchor),
				name: `Key ${def.label ?? def.text ?? def.action ?? ''}`.trim(),
				position: [x, KEY_HEIGHT / 2 + lift, z],
				rotation: [0, 0, 0, 1],
				scale: [width, KEY_HEIGHT, depth],
				components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'box' }, color }, component]
			},
			{ system: true }
		);
		const node = this.sceneGraph.getLive(slotId)!.node as AbstractMesh;
		matte(node);
		return this.trackKey({ slotId, node, def, variant: extra.variant, candidate: extra.candidate, x, z, width, depth, onBoard: true, lift, color });
	}

	private trackKey(k: { slotId: string; node: AbstractMesh; def: KeyDef; variant?: string; candidate?: number; x: number; z: number; width: number; depth: number; onBoard: boolean; lift?: number; color?: string }): LiveKey {
		k.node.metadata = { ...(k.node.metadata ?? {}), interactive: true };
		const label = this.labelQuad(k.width, k.depth);
		label.parent = k.onBoard ? this.parts.get('Keys')! : k.node.parent;
		label.position.set(k.x, KEY_HEIGHT + (k.lift ?? 0) + 0.0006, k.z);
		if (!k.onBoard) label.position.y = k.node.position.y + KEY_HEIGHT / 2 + 0.0006;
		const key: LiveKey = { slotId: k.slotId, node: k.node, def: k.def, variant: k.variant, candidate: k.candidate, x: k.x, z: k.z, width: k.width, depth: k.depth, label, pressedBy: new Map(), hovered: false, color: k.color ?? COLORS.action };
		this.keys.push(key);
		this.keyByNode.set(k.node, key);
		return key;
	}

	/** A flat quad lying on a key top, showing its cell of the label atlas (its UVs are set when the atlas is drawn). */
	private labelQuad(width: number, depth: number): Mesh {
		const quad = new Mesh('keyboard-label', this.scene);
		const data = new VertexData();
		data.positions = [-width / 2, 0, -depth / 2, width / 2, 0, -depth / 2, width / 2, 0, depth / 2, -width / 2, 0, depth / 2];
		data.indices = [0, 2, 1, 0, 3, 2];
		data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
		data.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
		data.applyToMesh(quad, true);
		quad.material = this.atlasMaterial;
		quad.isPickable = false;
		return quad;
	}

	private shifted(): boolean {
		return this.state.shift !== 'off';
	}

	private labelOf(key: LiveKey): string {
		if (key.variant !== undefined) return key.variant;
		if (key.candidate !== undefined) return this.state.composition.candidates[key.candidate] ?? '';
		if (key.def.action === 'layout') return `⇄ ${this.layout.short}`;
		if (key.def.action === 'space') return this.layout.name;
		return keyLabel(key.def, this.shifted());
	}

	/** Draws every key's label into one texture and points each key's quad at its cell. */
	private drawLabels(): void {
		const CELL = 96;
		const WIDTH = 2048;
		const cells = this.keys.map((key) => Math.max(1, Math.round((key.width / key.depth) * CELL)));
		let x = 0, y = 0;
		const origins = cells.map((w) => {
			if (x + w > WIDTH) { x = 0; y += CELL; }
			const origin = [x, y];
			x += w;
			return origin;
		});
		const height = Math.max(CELL, 2 ** Math.ceil(Math.log2(y + CELL)));
		if (!this.atlas || this.atlas.getSize().height !== height) {
			this.atlas?.dispose();
			this.atlas = new DynamicTexture('keyboard-label-atlas', { width: WIDTH, height }, this.scene, true);
			this.atlas.hasAlpha = true;
			this.atlasMaterial.emissiveTexture = this.atlas;
			this.atlasMaterial.opacityTexture = this.atlas;
		}
		const context = this.atlas.getContext() as unknown as CanvasRenderingContext2D;
		context.clearRect(0, 0, WIDTH, height);
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillStyle = THEME.text;
		this.keys.forEach((key, i) => {
			const [cx, cy] = origins[i];
			const w = cells[i];
			const text = this.labelOf(key);
			let size = text.length <= 2 ? 52 : 38;
			context.font = `600 ${size}px system-ui, sans-serif`;
			while (size > 14 && context.measureText(text).width > w - 16) {
				size -= 2;
				context.font = `600 ${size}px system-ui, sans-serif`;
			}
			context.fillText(text, cx + w / 2, cy + CELL / 2);
			const u0 = cx / WIDTH, u1 = (cx + w) / WIDTH;
			const vTop = 1 - cy / height, vBottom = 1 - (cy + CELL) / height;
			key.label.setVerticesData('uv', [u0, vBottom, u1, vBottom, u1, vTop, u0, vTop], true);
		});
		this.atlas.update(true);
		this.paintKeys();
	}

	/** The text bar: the title, then the text (dots for a secret), what is being composed underlined, and the caret. */
	private drawPreview(): void {
		if (!this.preview) return;
		const context = this.preview.getContext() as unknown as CanvasRenderingContext2D;
		const { width, height } = this.preview.getSize();
		context.fillStyle = THEME.ink;
		context.fillRect(0, 0, width, height);
		context.textBaseline = 'middle';
		context.font = '500 44px system-ui, sans-serif';
		let x = 24;
		const title = this.session?.request.title;
		if (title) {
			context.fillStyle = THEME.muted;
			context.fillText(title, x, height / 2);
			x += context.measureText(title).width + 24;
		}
		const secret = this.session?.request.secret;
		const chars = Array.from(this.state.text);
		const shown = (part: string[]) => (secret ? '•'.repeat(part.length) : part.join('').replaceAll('\n', '↵'));
		const before = shown(chars.slice(0, this.state.cursor));
		const after = shown(chars.slice(this.state.cursor));
		const preedit = this.state.composition.preedit;
		const room = width - x - 24;
		context.font = '500 52px system-ui, sans-serif';
		if (!chars.length && !preedit) {
			context.fillStyle = THEME.dim;
			context.fillText(this.session?.request.placeholder ?? '', x, height / 2);
			context.fillStyle = THEME.ember;
			context.fillRect(x, 30, 4, height - 60);
		} else {
			// The text before the cursor, what is being composed (underlined), the caret, then the rest. When it does not
			// fit, it scrolls so the caret stays in sight.
			const caret = context.measureText(before + preedit).width;
			const total = caret + context.measureText(after).width;
			const scroll = Math.min(Math.max(0, total - room), Math.max(0, caret - room + 40));
			context.save();
			context.beginPath();
			context.rect(x, 0, room, height);
			context.clip();
			const start = x - scroll;
			context.fillStyle = THEME.text;
			context.fillText(before, start, height / 2);
			const preeditX = start + context.measureText(before).width;
			if (preedit) {
				context.fillStyle = THEME.glow;
				context.fillText(preedit, preeditX, height / 2);
				context.fillRect(preeditX, height / 2 + 30, context.measureText(preedit).width, 3);
			}
			context.fillStyle = THEME.text;
			context.fillText(after, start + caret, height / 2);
			context.fillStyle = THEME.ember;
			context.fillRect(start + caret - 2, 30, 4, height - 60);
			context.restore();
		}
		this.preview.update(true);
	}

	/** Sizes the frame's named parts round a block of keys `width` by `depth` metres. */
	private fitFrame(width: number, depth: number, composing: boolean): void {
		const far = depth / 2;
		const candidates = composing ? PITCH * 1.2 : 0;
		const previewZ = far + candidates + 0.05;
		const body = this.parts.get('Body');
		const preview = this.parts.get('Preview');
		const close = this.parts.get('Close');
		const handle = this.parts.get('Handle');
		const near = -depth / 2 - 0.055;
		const back = previewZ + 0.04;
		const bodyWidth = width + 0.13;
		if (body) {
			body.scaling.x = bodyWidth;
			body.scaling.z = back - near;
			body.position.z = (back + near) / 2;
		}
		if (preview) {
			preview.scaling.x = width;
			preview.position.z = previewZ;
		}
		if (close) close.position.set(width / 2 + 0.04, KEY_HEIGHT / 2, previewZ);
		if (handle) {
			handle.scaling.y = width * 0.6;
			handle.position.z = near + 0.025;
		}
		this.size = { width: bodyWidth, depth: back - near };
	}

	// --- pressing -----------------------------------------------------------------------------------------------------

	private keyDown(key: LiveKey, source: string, depth: number): void {
		if (performance.now() - this.spawnedAt < SPAWN_GRACE_MS) return;
		key.pressedBy.set(source, depth);
		if (this.presses.has(source)) return;
		const now = performance.now();
		const press: Press = { key, at: now, done: false, repeatAt: now + HOLD_MS };
		this.presses.set(source, press);
		this.feedback(key, source);
		// A key that offers variants waits: a short press types it, a long one offers the variants.
		const waits = key.variant === undefined && key.candidate === undefined && keyVariants(key.def, false).length > 0;
		if (!waits) {
			press.done = true;
			this.activate(key);
		}
	}

	private keyUp(source: string): void {
		const press = this.presses.get(source);
		this.presses.delete(source);
		for (const key of this.keys) key.pressedBy.delete(source);
		if (press && !press.done) this.activate(press.key);
	}

	private activate(key: LiveKey): void {
		if (!this.session) return;
		const before = this.state;
		const layoutBefore = this.layout;
		let result: EditorResult;
		if (key.candidate !== undefined) result = pickCandidate(this.state, this.layout, key.candidate);
		else result = pressKey(this.state, this.layout, key.def, key.variant);
		// Any key (a variant included) puts the variants away.
		const hadVariants = this.variantsFor !== null;
		this.state = result.state;
		const handlers = this.session.handlers;
		if (shownText(this.state) !== shownText(before)) handlers.onChange?.(shownText(this.state));

		if (result.effect === 'submit') {
			const text = shownText(this.state);
			this.session = null;
			this.removeSlots();
			handlers.onSubmit?.(text);
			return;
		}
		if (result.effect === 'close') {
			this.close(false);
			return;
		}
		if (result.effect === 'next-layout') {
			this.layout = nextLayout(layoutBefore.id);
			this.state = switchLayout(this.state, layoutBefore, this.layout);
			xrSettings.keyboardLayout = this.layout.id;
			this.layoutSetting = this.layout.id;
			saveSettings();
		}
		const candidatesChanged = before.composition.candidates.join('\u0000') !== this.state.composition.candidates.join('\u0000');
		if (this.state.page !== before.page || this.layout !== layoutBefore) this.buildKeys();
		else {
			if (hadVariants) this.hideVariants();
			if (candidatesChanged) this.showCandidates();
			if (this.state.shift !== before.shift || hadVariants || candidatesChanged) this.drawLabels();
		}
		this.drawPreview();
	}

	private showVariants(key: LiveKey): void {
		this.hideVariants();
		const anchor = this.parts.get('Keys');
		const variants = keyVariants(key.def, this.shifted());
		if (!anchor || !variants.length) return;
		const start = key.x - ((variants.length - 1) * PITCH) / 2;
		variants.forEach((variant, i) => this.addKey(anchor, key.def, start + i * PITCH, key.z + PITCH * 1.1, KEY, KEY, { variant, lift: 0.025 }));
		this.variantsFor = key;
		this.drawLabels();
	}

	private hideVariants(): void {
		this.removeKeysWhere((key) => key.variant !== undefined);
		this.variantsFor = null;
	}

	/** The composer's candidates, as a row of keys between the keys and the text bar. */
	private showCandidates(): void {
		this.removeKeysWhere((key) => key.candidate !== undefined);
		const anchor = this.parts.get('Keys');
		const candidates = this.state.composition.candidates.slice(0, 8);
		if (!anchor || !candidates.length) return;
		const rows = this.layout.pages[this.state.page];
		const far = (rows.length * PITCH) / 2;
		const widths = candidates.map((c) => Math.max(1, Array.from(c).length * 0.8) * PITCH);
		let x = -widths.reduce((a, b) => a + b, 0) / 2;
		candidates.forEach((_, i) => {
			this.addKey(anchor, { label: '' }, x + widths[i] / 2, far + PITCH * 0.6, widths[i] - (PITCH - KEY), KEY, { candidate: i });
			x += widths[i];
		});
	}

	private removeKeysWhere(predicate: (key: LiveKey) => boolean): void {
		for (const key of this.keys.filter(predicate)) {
			key.label.dispose();
			this.keyByNode.delete(key.node);
			this.sceneGraph.removeSlot(key.slotId);
		}
		this.keys = this.keys.filter((key) => !predicate(key));
	}

	private feedback(key: LiveKey, source: string): void {
		setupImpactSound(this.scene, key.node, { type: 'impactSound', frequency: 1400, pitchDrop: 500, noiseMix: 0.35, durationMs: 35, volume: 0.22 });
		const controller = this.controllerFor(source);
		void controller?.motionController?.pulse(0.25, 18);
	}

	private controllerFor(source: string): WebXRInputSource | undefined {
		if (source.startsWith('poke:')) return this.xr.input.controllers.find((c) => c.uniqueId === source.slice(5));
		const pointerId = Number(source.slice(6));
		return (this.xr.pointerSelection as unknown as { getXRControllerByPointerId?(id: number): WebXRInputSource | null }).getXRControllerByPointerId?.(pointerId) ?? undefined;
	}

	// --- every frame --------------------------------------------------------------------------------------------------

	/** A layout chosen in the settings applies at once, even to the keyboard already up. */
	private followLayoutSetting(): void {
		if (xrSettings.keyboardLayout === this.layoutSetting) return;
		this.layoutSetting = xrSettings.keyboardLayout;
		const chosen = preferredLayout(this.layoutSetting, pageLanguage());
		if (chosen === this.layout) return;
		const previous = this.layout;
		this.layout = chosen;
		if (!this.state) return;
		this.state = switchLayout(this.state, previous, chosen);
		if (this.rootId) this.buildKeys();
	}

	private update(): void {
		this.followLayoutSetting();
		const root = this.rootId ? this.sceneGraph.getLive(this.rootId)?.node : null;
		if (!root) return;
		this.touch(root);
		const now = performance.now();
		for (const press of this.presses.values()) {
			if (!press.done && now - press.at >= HOLD_MS) {
				press.done = true;
				this.showVariants(press.key);
			} else if (press.done && REPEATS.has(press.key.def.action) && now >= press.repeatAt) {
				press.repeatAt = now + REPEAT_MS;
				this.activate(press.key);
			}
		}
		this.paintKeys();
	}

	/** The tip of each controller (or tracked index finger) pushing keys down. */
	private touch(root: TransformNode): void {
		root.computeWorldMatrix(true);
		const toBoard = root.getWorldMatrix().clone().invert();
		const hands = this.xr.baseExperience.featuresManager.getEnabledFeature(WebXRFeatureName.HAND_TRACKING) as WebXRHandTracking | undefined;
		const seen = new Set<string>();
		for (const controller of this.xr.input.controllers) {
			const id = controller.uniqueId;
			seen.add(id);
			const world = this.tipOf(controller, hands);
			const tip = this.tips.get(id) ?? this.newTip(id);
			if (!world) { tip.marker.setEnabled(false); continue; }
			const local = Vector3.TransformCoordinates(world, toBoard);
			const source = `poke:${id}`;
			const near = local.y < 0.12 && Math.abs(local.x) < this.size.width && Math.abs(local.z) < this.size.depth;
			tip.marker.setEnabled(near);
			tip.marker.position.copyFrom(world);

			const over = this.keys.find((key) => this.isOnBoard(key) && Math.abs(local.x - key.x) <= key.width / 2 && Math.abs(local.z - key.z) <= key.depth / 2) ?? null;
			for (const key of this.keys) key.hovered = key === over && local.y < KEY_HEIGHT + 0.03;
			const top = KEY_HEIGHT + (over?.variant !== undefined ? 0.025 : 0);
			const depth = over ? Math.min(TRAVEL, Math.max(0, top + 0.004 - local.y)) : 0;
			// Ready to press again once above the keys, or between keys at their height (sliding off one and onto the next
			// types both). Not from below: a hand that came up through the board would otherwise type as it rose.
			if (local.y > KEY_HEIGHT + 0.012 || (!over && local.y > KEY_HEIGHT / 2)) tip.armed = true;

			if (tip.key && (tip.key !== over || depth <= 0)) {
				tip.key.pressedBy.delete(source);
				this.keyUp(source);
				tip.key = null;
			}
			if (over && depth > 0) {
				over.pressedBy.set(source, depth);
				if (!tip.key && tip.armed && depth >= TRAVEL * 0.6) {
					tip.armed = false;
					tip.key = over;
					this.keyDown(over, source, depth);
				}
			}
		}
		for (const [id, tip] of this.tips) if (!seen.has(id)) { tip.marker.dispose(); this.tips.delete(id); }
	}

	private isOnBoard(key: LiveKey): boolean {
		return key.node.parent === this.parts.get('Keys');
	}

	private newTip(id: string): Tip {
		const marker = MeshBuilder.CreateSphere(`keyboard-tip-${id}`, { diameter: 0.012, segments: 8 }, this.scene);
		const material = new StandardMaterial(`keyboard-tip-${id}`, this.scene);
		material.emissiveColor = Color3.FromHexString(THEME.glow);
		material.disableLighting = true;
		marker.material = material;
		marker.isPickable = false;
		marker.setEnabled(false);
		// A tip first seen while the keyboard is up may already be inside it: it arms like any other, from above.
		const tip: Tip = { marker, armed: !this.rootId, key: null };
		this.tips.set(id, tip);
		return tip;
	}

	/**
	 * Where a hand touches: the tracked index fingertip; else the tip of the avatar's index finger, which is what the
	 * player sees; else, with no avatar, just ahead of where the controller's ray starts.
	 */
	private tipOf(controller: WebXRInputSource, hands: WebXRHandTracking | undefined): Vector3 | null {
		const joint = hands?.getHandByControllerId(controller.uniqueId)?.getJointMesh(WebXRHandJoint.INDEX_FINGER_TIP);
		if (joint) return joint.absolutePosition.clone();
		const side = controller.inputSource.handedness;
		const avatarTip = side === 'left' || side === 'right' ? this.fingertip?.(side) : null;
		if (avatarTip) return avatarTip;
		const ray = new Ray(Vector3.Zero(), Vector3.Forward());
		controller.getWorldPointerRayToRef(ray);
		return ray.origin.add(ray.direction.scale(0.015));
	}

	/** Each key's colour and how far down it is, from what is pressing it. */
	private paintKeys(): void {
		for (const key of this.keys) {
			const depth = Math.max(0, ...key.pressedBy.values());
			const restY = key.node.parent === this.parts.get('Keys') ? KEY_HEIGHT / 2 + (key.variant !== undefined ? 0.025 : 0) : null;
			if (restY !== null) {
				key.node.position.y = restY - depth;
				key.label.position.y = restY + KEY_HEIGHT / 2 + 0.0006 - depth;
			}
			const locked = key.def.action === 'shift' && this.state?.shift === 'locked';
			const on = key.def.action === 'shift' && this.state?.shift === 'once';
			const color = depth > 0 ? COLORS.down : locked ? COLORS.locked : on ? COLORS.hover : key.hovered ? COLORS.hover : key.variant !== undefined ? COLORS.variant : key.candidate !== undefined ? COLORS.candidate : key.def.text !== undefined ? COLORS.key : key.def.action === 'close' ? THEME.danger : COLORS.action;
			if (color !== key.color) {
				key.color = color;
				this.sceneGraph.setComponentField(key.slotId, 'meshRenderer', 'color', color);
			}
		}
	}
}
