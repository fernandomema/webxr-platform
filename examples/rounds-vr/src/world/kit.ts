import type { MaterialComponent, Slot } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import type { Vec3 } from './data.ts';

/** Where a pooled slot waits, out of sight and out of the way: moving a slot costs guests nothing, switching one on or off costs a snapshot. */
export const PARKED: Vec3 = [0, -200, 0];

/** The ids of everything the script reaches by name. */
export const ID = {
	director: 'rd-hub',
	commands: 'rd-cmd',
	spawn: 'rd-spawn',
	board: 'rd-board',
	lobby: 'rd-lobby',
	ui: (name: string) => `rd-ui-${name}`,
	banner: (i: number) => `rd-banner-${i}`,
	flash: (i: number) => `rd-flash-${i}`,
	hud: (i: number) => `rd-hud-${i}`,
	number: (n: number) => `rd-number-${n}`,
	map: (m: number) => `rd-map-${m}`,
	pad: (i: number) => `rd-pad-${i}`,
	padRing: (i: number) => `rd-pad-ring-${i}`,
	gun: (i: number) => `rd-gun-${i}`,
	gunPart: (i: number, part: string) => `rd-gun-${i}-${part}`,
	shield: (i: number) => `rd-shield-${i}`,
	shieldPart: (i: number, part: string) => `rd-shield-${i}-${part}`,
	tag: (i: number) => `rd-tag-${i}`,
	tagPart: (i: number, part: string) => `rd-tag-${i}-${part}`,
	veil: (i: number) => `rd-veil-${i}`,
	bubble: (i: number) => `rd-bubble-${i}`,
	bot: (i: number) => `rd-bot-${i}`,
	botPart: (i: number, part: string) => `rd-bot-${i}-${part}`,
	bullet: (n: number) => `rd-b-${n}`,
	card: (n: number) => `rd-card-${n}`,
	/** A slot of a map's fragment: the fragment's own id under the slot that builds it. */
	mapPart: (map: number, part: string) => `rd-map-${map}::${part}`
} as const;

type Shape = 'box' | 'sphere' | 'cylinder' | 'plane' | 'disc';

export interface MeshOptions {
	parentId?: string;
	unlit?: boolean;
	opacity?: number;
	solid?: boolean;
	disabled?: boolean;
	rotation?: [number, number, number, number];
	material?: MaterialComponent;
}

/** A mesh slot with a built-in shape, lit unless `unlit`. */
export function mesh(id: string, name: string, shape: Shape, position: Vec3, scale: Vec3, color: string, options: MeshOptions = {}): Slot {
	const slot = createSlot({
		id,
		name,
		parentId: options.parentId ?? null,
		position,
		scale,
		...(options.rotation ? { rotation: options.rotation } : {}),
		components: [
			{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: shape }, color, ...(options.unlit ? { unlit: true } : {}), ...(options.opacity === undefined ? {} : { opacity: options.opacity }) },
			...(options.material ? [options.material] : []),
			...(options.solid ? [{ type: 'collider' as const, shape: 'box' as const }] : [])
		]
	});
	return options.disabled ? { ...slot, disabled: true } : slot;
}

/** A turn about y by `yaw` radians, as a quaternion (0 looks along +Z, positive turns toward +X). */
export const yawQuat = (yaw: number): [number, number, number, number] => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

/** A turn about x by `angle` radians. */
export const pitchQuat = (angle: number): [number, number, number, number] => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];

const texture = (id: string, map: string) => ({ kind: 'url' as const, url: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${id}_${map}_1k.jpg` });

/** A Poly Haven (CC0) material laid on a surface by real size: `size` metres per repeat, however the slot is scaled. Loaded from the library's own CDN. */
export function polyHaven(id: string, size: number, label: string, options: { roughness?: number; metallic?: number } = {}): MaterialComponent {
	return { type: 'material', albedo: texture(id, 'diff'), normal: texture(id, 'nor_gl'), arm: texture(id, 'arm'), mapping: 'world', size, label, ...options };
}
