import { platformFetch } from './config.ts';
import { questBridge, type QuestBridge } from './questBridge.ts';

/** A person as the friends screens show them. */
export interface FriendPerson {
	id: string;
	name: string;
	username: string | null;
	image: string | null;
}

export interface FriendSession {
	roomCode: string;
	worldName: string;
	visibility: string;
}

export interface Friend extends FriendPerson {
	/** The session this friend is hosting right now, if one their friendship lets you into. */
	session: FriendSession | null;
}

export interface FriendsOverview {
	friends: Friend[];
	incoming: Array<{ id: string; createdAt: string; from: FriendPerson }>;
	outgoing: Array<{ id: string; createdAt: string; to: FriendPerson }>;
}

export class FriendsError extends Error {
	constructor(message: string, readonly status: number) { super(message); }
}

/** "ABCD1234" as people read and say it: "ABCD-1234". */
export function formatFriendCode(code: string): string {
	return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** Whether what was typed looks like a friend code ("ABCD-1234", or eight capitals and digits) rather than a username. */
export function looksLikeFriendCode(value: string): boolean {
	const text = value.trim();
	return /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(text) || /^[A-Z0-9]{8}$/.test(text);
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const NO_STORE_JSON = { 'content-type': 'application/json' };

/** Short wording for what the server answered, so the dash can show it as is. */
function describe(status: number, message: string | undefined): string {
	if (status === 401) return 'Sign in to use friends';
	if (status === 404) return 'No one was found with that';
	if (status === 429) return 'Too many tries, wait a little';
	return message || 'Something went wrong';
}

/** The friends API of the platform. `fetchImpl` is for tests; games use `friendsApi`. */
export function createFriendsApi(fetchImpl: Fetch = platformFetch, bridge: () => QuestBridge = questBridge) {
	async function call<T>(path: string, init?: RequestInit): Promise<T> {
		let response: Response;
		try { response = await fetchImpl(path, init); } catch { throw new FriendsError('Could not reach the platform', 0); }
		const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
		if (!response.ok) throw new FriendsError(describe(response.status, body?.message), response.status);
		return body as T;
	}
	const post = (path: string, body: unknown) => call<{ status: string }>(path, { method: 'POST', headers: NO_STORE_JSON, body: JSON.stringify(body) });

	return {
		overview: () => call<FriendsOverview>('/api/friends'),
		/** Asks someone by the username they chose, or by their friend code. `friends` means they had already asked you. */
		sendRequest: (who: { username: string } | { code: string }) => post('/api/friends/requests', who) as Promise<{ status: 'pending' | 'friends' }>,
		accept: (requestId: string) => post(`/api/friends/requests/${encodeURIComponent(requestId)}`, { action: 'accept' }),
		decline: (requestId: string) => post(`/api/friends/requests/${encodeURIComponent(requestId)}`, { action: 'decline' }),
		cancel: (requestId: string) => post(`/api/friends/requests/${encodeURIComponent(requestId)}`, { action: 'cancel' }),
		remove: (userId: string) => call<{ ok: true }>(`/api/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
		block: (userId: string) => post('/api/friends/blocks', { userId }),
		myCode: () => call<{ code: string }>('/api/friends/code'),
		newCode: () => call<{ code: string }>('/api/friends/code', { method: 'POST' }),
		/** Whether this device can read a platform's friends (today: inside the Quest app). */
		canFindPlatformFriends: () => bridge().available,
		/**
		 * Asks the Quest app who the player is and who their friends are, and lets the platform match them with accounts here.
		 * Returns the Meta friends who can be asked to be friends; nobody becomes a friend without accepting.
		 */
		async findQuestFriends(): Promise<FriendPerson[]> {
			const app = bridge();
			if (!await app.whenAvailable(2000)) throw new FriendsError('Open Kithin from the Quest app to find your Meta friends', 0);
			try {
				const [user, proof, friends] = await Promise.all([app.request('getLoggedInUser'), app.request('getUserProof'), app.request('getLoggedInUserFriends')]);
				const answer = await call<{ suggestions: FriendPerson[] }>('/api/friends/providers/meta/sync', {
					method: 'POST', headers: NO_STORE_JSON,
					body: JSON.stringify({ proof: { metaUserId: user.id, nonce: proof.nonce }, friendIds: friends.ids })
				});
				return answer.suggestions;
			} catch (error) {
				if (error instanceof FriendsError) throw error;
				throw new FriendsError(error instanceof Error ? error.message : 'Could not read your Meta friends', 0);
			}
		}
	};
}

export const friendsApi = createFriendsApi();
