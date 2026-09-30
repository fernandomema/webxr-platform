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

/**
 * While a hand holds something with its laser, pushing its stick forward or back moves that object along the laser
 * (see pointerController.ts): the stick's forward/back is taken from walking (left) and running (right) meanwhile, and
 * its sideways still steps or turns.
 */
const stickYClaimed = new Set<Hand>();

export function claimStickY(hand: Hand): void {
	stickYClaimed.add(hand);
}

export function releaseStickY(hand: Hand): void {
	stickYClaimed.delete(hand);
}

export function isStickYClaimed(hand: Hand): boolean {
	return stickYClaimed.has(hand);
}
