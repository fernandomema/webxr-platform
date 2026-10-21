/** How a request to pay ended. Scripts see exactly this and nothing else: no token, no balance, no account detail. */
export interface PayResult {
	ok: boolean;
	reason?: 'declined' | 'insufficient' | 'owned' | 'limit' | 'unavailable' | 'busy' | 'error';
}

/** What `ctx.pay` can do, provided by the engine for the player it is asked about. */
export interface ScriptPayments {
	/** Asks `playerId` (the local player when omitted) to pay for `sku` of the published world being played. */
	request(playerId: string | undefined, sku: string): Promise<PayResult>;
	/** Whether `playerId` owns `sku` in this world. */
	owns(playerId: string | undefined, sku: string): Promise<boolean>;
}

/** Everything the purchase prompt shows. It comes from the server, never from the script that asked. */
export interface PurchasePromptDetails {
	worldName: string;
	owner: string;
	productName: string;
	price: number;
	balance: number;
	/** The player can add credits without leaving (a store purchase on a headset). */
	canTopUp: boolean;
	/** The prompt closes itself as a cancel after this long. */
	timeoutMs: number;
}

export type PurchasePromptChoice = 'pay' | 'cancel' | 'topup';
