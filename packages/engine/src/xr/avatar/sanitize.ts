import type { Component, Slot, SlotTree } from '../../ecs/types.ts';
import { normalizeMeshRef } from '../../assets/ref.ts';

/**
 * Avatars come from other people's inventories and cross the network, so the host rebuilds one from a
 * strict allowlist instead of trusting it: a bounded tree of plain slots whose only behaviour is being
 * a body with places to attach things. Scripts, portals, panels and everything else are dropped.
 */

export const MAX_AVATAR_SLOTS = 64;
export const MAX_AVATAR_BYTES = 128 * 1024;

export class AvatarRejected extends Error {}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown, length: number): v is number[] => Array.isArray(v) && v.length === length && v.every(isNumber);
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanComponent(raw: unknown): Component | null {
	if (!raw || typeof raw !== 'object') return null;
	const c = raw as Record<string, unknown>;
	switch (c.type) {
		case 'avatar': {
			const bones: Record<string, string> = {};
			if (c.bones && typeof c.bones === 'object') {
				for (const [role, bone] of Object.entries(c.bones as Record<string, unknown>).slice(0, 64)) {
					if (typeof bone === 'string' && bone) bones[text(role, 32)] = text(bone, 128);
				}
			}
			const height = isNumber(c.height) ? Math.min(3, Math.max(0.3, c.height)) : 1.6;
			return { type: 'avatar', height, bones };
		}
		case 'meshRenderer': {
			const meshRef = normalizeMeshRef(c.meshRef);
			return { type: 'meshRenderer', meshRef, ...(typeof c.color === 'string' ? { color: text(c.color, 16) } : {}) };
		}
		case 'boneAttach':
			return { type: 'boneAttach', bone: text(c.bone, 128) };
		case 'socket': {
			const snap = c.snap as { position?: unknown; rotation?: unknown } | undefined;
			return {
				type: 'socket',
				accepts: Array.isArray(c.accepts) ? c.accepts.filter((tag): tag is string => typeof tag === 'string').slice(0, 16).map((tag) => text(tag, 32)) : [],
				radius: isNumber(c.radius) ? Math.min(2, Math.max(0.02, c.radius)) : 0.2,
				snap: {
					position: isVec(snap?.position, 3) ? (snap!.position as [number, number, number]) : [0, 0, 0],
					rotation: isVec(snap?.rotation, 3) ? (snap!.rotation as [number, number, number]) : [0, 0, 0]
				},
				...(typeof c.playMedia === 'boolean' ? { playMedia: c.playMedia } : {})
			};
		}
		case 'insertable':
			return { type: 'insertable', tag: text(c.tag, 32) };
		case 'collider':
			return { type: 'collider', shape: c.shape === 'sphere' || c.shape === 'mesh' ? c.shape : 'box' };
		default:
			return null;
	}
}

/**
 * Returns a clean copy of an avatar tree with the root first, or throws `AvatarRejected`.
 * The copy has no `ownerId` and no socket occupants: those are the host's to assign.
 */
export function sanitizeAvatarTree(input: unknown): SlotTree {
	if (!Array.isArray(input) || input.length === 0) throw new AvatarRejected('An avatar needs at least one slot.');
	if (input.length > MAX_AVATAR_SLOTS) throw new AvatarRejected(`An avatar can have at most ${MAX_AVATAR_SLOTS} slots.`);
	let size = 0;
	try { size = JSON.stringify(input).length; } catch { throw new AvatarRejected('The avatar could not be read.'); }
	if (size > MAX_AVATAR_BYTES) throw new AvatarRejected('The avatar is too large.');

	const slots: Slot[] = [];
	const ids = new Set<string>();
	for (const raw of input) {
		const s = raw as Partial<Slot> | null;
		if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id || ids.has(s.id)) throw new AvatarRejected('The avatar has an invalid or repeated slot id.');
		ids.add(s.id);
		slots.push({
			id: s.id,
			parentId: typeof s.parentId === 'string' ? s.parentId : null,
			name: text(s.name, 64) || 'Slot',
			position: isVec(s.position, 3) ? (s.position as Slot['position']) : [0, 0, 0],
			rotation: isVec(s.rotation, 4) ? (s.rotation as Slot['rotation']) : [0, 0, 0, 1],
			scale: isVec(s.scale, 3) ? (s.scale as Slot['scale']) : [1, 1, 1],
			components: (Array.isArray(s.components) ? s.components : []).map(cleanComponent).filter((c): c is Component => c !== null)
		});
	}

	const roots = slots.filter((slot) => slot.parentId === null);
	if (roots.length !== 1) throw new AvatarRejected('An avatar has exactly one root slot.');
	for (const slot of slots) if (slot.parentId !== null && !ids.has(slot.parentId)) throw new AvatarRejected('A slot points at a parent that is not in the avatar.');
	const root = roots[0];
	const mesh = root.components.find((c) => c.type === 'meshRenderer');
	if (!root.components.some((c) => c.type === 'avatar') || !mesh || mesh.type !== 'meshRenderer' || mesh.meshRef.kind !== 'asset') {
		throw new AvatarRejected('The avatar root needs a model and an avatar component.');
	}
	// A parent cycle can never reach the root, so every slot must lead up to it.
	for (const slot of slots) {
		let current: Slot | undefined = slot;
		for (let hops = 0; current && current.parentId !== null; hops++) {
			if (hops > slots.length) throw new AvatarRejected('The avatar hierarchy loops.');
			current = slots.find((candidate) => candidate.id === current!.parentId);
		}
	}
	return [root, ...slots.filter((slot) => slot !== root)];
}
