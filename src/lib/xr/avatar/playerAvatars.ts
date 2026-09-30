import { findComponent, type Quat, type SlotTree, type Vec3 } from '$lib/ecs/types';
import { instantiate } from '$lib/ecs/serialize';
import type { SceneGraph } from '../sceneGraph';
import { sanitizeAvatarTree } from './sanitize';

interface CarriedItem {
	slotId: string;
	/** Name of the avatar slot it was attached to (a socket), used to find its place on the next avatar. */
	parentName: string;
	position: Vec3;
	rotation: Quat;
}

/**
 * Keeps one avatar subtree per player in the scene graph. Only the host (or a solo player) runs this;
 * guests receive the result in the snapshot. An avatar is ordinary slots, so anything a player attaches
 * to it (an item resting in a shoulder socket) is a child of it too. When the avatar is replaced, those
 * items move to the matching socket of the new one, or fall into the world where they are.
 */
export class PlayerAvatars {
	/** Slots that belong to the avatar itself, per player; anything else below it was attached by the player. */
	private templates = new Map<string, Set<string>>();

	constructor(private sceneGraph: SceneGraph) {}

	has(playerId: string): boolean {
		return this.rootOf(playerId) !== null;
	}

	/** Replaces the player's avatar with `tree` (validated here, given fresh ids, and owned by the player). */
	setAvatar(playerId: string, tree: unknown): void {
		const fresh = instantiate(sanitizeAvatarTree(tree));
		fresh[0] = {
			...fresh[0],
			components: fresh[0].components.map((component) => (component.type === 'avatar' ? { ...component, ownerId: playerId } : component))
		};

		const carried = this.detachAttachments(playerId);
		const old = this.rootOf(playerId);
		if (old) this.sceneGraph.removeSlot(old);
		for (const slot of fresh) this.sceneGraph.addSlot(slot);
		this.templates.set(playerId, new Set(fresh.map((slot) => slot.id)));

		for (const item of carried) {
			const home = fresh.find((slot) => slot.name === item.parentName && findComponent(slot, 'socket'));
			if (!home || !this.sceneGraph.reparentSlot(item.slotId, home.id)) continue;
			this.sceneGraph.placeSlotLocal(item.slotId, item.position, item.rotation);
			const socket = this.sceneGraph.getLive(home.id)?.slot;
			const component = socket && findComponent(socket, 'socket');
			if (component) component.occupantId = item.slotId;
		}
	}

	/** Removes every avatar, for when the session they belonged to is over. Attachments drop into the world. */
	clearAll(): void {
		const owners = new Set<string>();
		for (const entry of this.sceneGraph.allSlots()) {
			const ownerId = entry.slot.parentId === null ? findComponent(entry.slot, 'avatar')?.ownerId : undefined;
			if (ownerId) owners.add(ownerId);
		}
		for (const ownerId of owners) this.removePlayer(ownerId);
	}

	/** Removes the player's avatar. Whatever they had attached drops into the world at its current pose. */
	removePlayer(playerId: string): void {
		this.detachAttachments(playerId);
		const root = this.rootOf(playerId);
		if (root) this.sceneGraph.removeSlot(root);
		this.templates.delete(playerId);
	}

	private rootOf(playerId: string): string | null {
		for (const entry of this.sceneGraph.allSlots()) {
			if (entry.slot.parentId === null && findComponent(entry.slot, 'avatar')?.ownerId === playerId) return entry.slot.id;
		}
		return null;
	}

	/** Frees the player's attachments into the world and returns where each one was, so they can be re-attached. */
	private detachAttachments(playerId: string): CarriedItem[] {
		const template = this.templates.get(playerId);
		if (!template) return [];
		const carried: CarriedItem[] = [];
		for (const entry of this.sceneGraph.allSlots()) {
			const { slot } = entry;
			if (template.has(slot.id) || !slot.parentId || !template.has(slot.parentId)) continue;
			const parent = this.sceneGraph.getLive(slot.parentId)?.slot;
			if (!parent) continue;
			carried.push({
				slotId: slot.id,
				parentName: parent.name,
				position: entry.node.position.asArray() as Vec3,
				rotation: (entry.node.rotationQuaternion?.asArray() ?? [0, 0, 0, 1]) as Quat
			});
		}
		for (const item of carried) this.sceneGraph.reparentSlot(item.slotId, null);
		return carried;
	}
}
