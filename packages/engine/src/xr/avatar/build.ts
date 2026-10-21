import type { Slot, SlotTree } from '../../ecs/types.ts';
import { assetMesh, type AssetId } from '../../assets/ref.ts';
import { detectHumanoidMap, type HumanoidMap } from './humanoid.ts';

export interface AvatarModelInfo {
	assetId: AssetId;
	name: string;
	/** Bone names of the model's skin. */
	joints: readonly string[];
	/** Model bounds in metres; the top of the model is taken as the top of the head. */
	bounds?: { min: [number, number, number]; max: [number, number, number] };
}

/** Standing eye height: a little under the top of the head, or a typical 1.6 m when the model's size is unknown. */
export function eyeHeightOf(bounds?: AvatarModelInfo['bounds']): number {
	if (!bounds) return 1.6;
	const top = bounds.max[1] - Math.min(0, bounds.min[1]);
	return Math.round(Math.min(3, Math.max(0.3, top - 0.12)) * 100) / 100;
}

/**
 * Builds the slot tree of an avatar from a skinned model: a root carrying the model and an `avatar`
 * component with the bones it could recognise, plus a couple of sockets so things can be carried.
 * Pure, so the Studio, the in-game inspector and the base avatar all make avatars the same way.
 */
export interface BuildAvatarOptions {
	/** Which carrying sockets to add. `false` adds none; omitted adds both. */
	sockets?: boolean | { shoulder?: boolean; hip?: boolean };
	/** A bone map to use instead of detecting one (the wizard lets the user correct it). */
	bones?: HumanoidMap;
	/** Eye height in metres, instead of deriving it from the model's bounds. */
	height?: number;
}

export function buildAvatarTree(info: AvatarModelInfo, options: BuildAvatarOptions = {}): SlotTree {
	const bones: HumanoidMap = options.bones ?? detectHumanoidMap(info.joints);
	const rootId = crypto.randomUUID();
	const root: Slot = {
		id: rootId,
		parentId: null,
		name: info.name || 'Avatar',
		position: [0, 0, 0],
		rotation: [0, 0, 0, 1],
		scale: [1, 1, 1],
		components: [
			{ type: 'meshRenderer', meshRef: assetMesh(info.assetId) },
			{ type: 'avatar', height: options.height ?? eyeHeightOf(info.bounds), bones }
		]
	};
	const tree: SlotTree = [root];
	const wanted = options.sockets === false ? { shoulder: false, hip: false } : typeof options.sockets === 'object' ? options.sockets : { shoulder: true, hip: true };

	const socket = (name: string, bone: string | undefined, position: [number, number, number]): void => {
		if (!bone) return;
		tree.push({
			id: crypto.randomUUID(),
			parentId: rootId,
			name,
			position,
			rotation: [0, 0, 0, 1],
			scale: [1, 1, 1],
			components: [
				{ type: 'boneAttach', bone },
				{ type: 'socket', accepts: [], radius: 0.15, snap: { position: [0, 0, 0], rotation: [0, 0, 0] } }
			]
		});
	};
	if (wanted.shoulder) socket('Shoulder Socket', bones.rightShoulder ?? bones.rightUpperArm ?? bones.chest, [0, 0.1, 0]);
	if (wanted.hip) socket('Hip Socket', bones.leftUpperLeg ?? bones.hips, [0.1, 0, 0]);
	return tree;
}

/** True when the tree is an avatar: a single root that is a body carrying an `avatar` component. */
export function isAvatarTree(tree: SlotTree): boolean {
	const roots = tree.filter((slot) => slot.parentId === null);
	return roots.length === 1 && roots[0].components.some((component) => component.type === 'avatar');
}

/**
 * Prepares a subtree taken from the live scene for the inventory: avatars are saved as their own kind,
 * without the player they happened to be worn by.
 */
export function forInventory(tree: SlotTree): { tree: SlotTree; kind: 'object' | 'avatar' } {
	if (!isAvatarTree(tree)) return { tree, kind: 'object' };
	const cleaned = tree.map((slot) =>
		slot.parentId === null
			? { ...slot, components: slot.components.map((component) => (component.type === 'avatar' ? { type: 'avatar' as const, height: component.height, bones: component.bones } : component)) }
			: slot
	);
	return { tree: cleaned, kind: 'avatar' };
}
