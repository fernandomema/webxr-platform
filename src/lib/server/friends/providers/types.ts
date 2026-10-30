/**
 * A platform whose own friend list can suggest people here (Meta Quest today; Steam when a desktop app can reach Steamworks).
 * The platform's SDK only exists on the player's device, so the device reports who it is and who its friends are, and the server
 * only vouches for the first part: `verifyIdentity` proves the account really belongs to the caller. The friend ids are never
 * trusted for anything but suggesting people (see `syncProviderFriends`); a friendship here always needs both sides to agree.
 */
export interface FriendProvider {
	readonly id: string;
	readonly label: string;
	/** Whether the server has what it needs (keys, app ids) to verify this provider's accounts. */
	isAvailable(): boolean;
	/** Checks the proof the device holds and returns the provider's id for the caller. Throws `BadRequestError` when it does not hold. */
	verifyIdentity(proof: unknown): Promise<string>;
	/** The valid ids among the friend ids a device reported. */
	parseFriendIds(raw: unknown): string[];
}
