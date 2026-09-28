export type Hand = 'left' | 'right';

/**
 * While a hand's radial menu is open, that hand's thumbstick is repurposed
 * for hovering/selecting radial items — movementController.ts (left stick)
 * and rotationController.ts (right stick) check this and skip applying
 * their own input for that hand until it's released.
 */
const locked = new Set<Hand>();

export function lockHand(hand: Hand): void {
	locked.add(hand);
}

export function unlockHand(hand: Hand): void {
	locked.delete(hand);
}

export function isHandLocked(hand: Hand): boolean {
	return locked.has(hand);
}
