import { sha256Hex } from '../assets/hash.ts';
import type { Component, Slot } from './types.ts';

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.filter(([, entry]) => entry !== undefined)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, entry]) => [key, canonicalValue(entry)]));
}

function canonicalComponent(component: Component): unknown {
	if (component.type === 'scriptState' || component.type === 'expires' || component.type === 'velocity') return null;
	if (component.type === 'socket') {
		const { occupantId: _occupantId, ...rest } = component;
		return canonicalValue(rest);
	}
	if (component.type === 'avatar') {
		const { ownerId: _ownerId, ...rest } = component;
		return canonicalValue(rest);
	}
	if (component.type === 'audioPlayer') {
		const { playing: _playing, currentTime: _currentTime, ...rest } = component;
		return canonicalValue(rest);
	}
	return canonicalValue(component);
}

function canonicalSlot(slot: Slot, getChildren: (id: string) => Slot[], root = false): unknown {
	return {
		name: slot.name,
		position: root ? null : canonicalValue(slot.position),
		rotation: root ? null : canonicalValue(slot.rotation),
		scale: root ? null : canonicalValue(slot.scale),
		disabled: root ? null : slot.disabled === true,
		components: slot.components.map(canonicalComponent).filter((component) => component !== null).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
		children: getChildren(slot.id).map((child) => JSON.stringify(canonicalSlot(child, getChildren))).sort()
	};
}

/**
 * A content fingerprint of a slot and everything below it. Slot ids, child/component order and the root's parent, position,
 * rotation and scale do not change it; inventory copies with fresh ids therefore match the original. Live session data does not
 * belong to the object's identity, while its geometry, authored local transforms, components and descendants do.
 */
export async function hashSlot(root: Slot, getChildren: (id: string) => Slot[]): Promise<string> {
	const canonical = JSON.stringify(canonicalSlot(root, getChildren, true));
	return sha256Hex(new TextEncoder().encode(canonical));
}
