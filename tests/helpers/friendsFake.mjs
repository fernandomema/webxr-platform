/** An in-memory stand-in for the part of Prisma the friends service uses: tables of plain rows, `where` filters and the compound keys. */
function matches(row, where = {}) {
	return Object.entries(where).every(([key, condition]) => {
		if (key === 'OR') return condition.some((branch) => matches(row, branch));
		if (key === 'AND') return condition.every((branch) => matches(row, branch));
		const value = row[key];
		if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
			if ('in' in condition || 'not' in condition || 'gte' in condition) {
				if ('in' in condition && !condition.in.includes(value)) return false;
				if ('not' in condition && value === condition.not) return false;
				return true;
			}
			return value != null && typeof value === 'object' && matches(value, condition);
		}
		return value === condition;
	});
}

export function createFriendsDb({ users = [], worlds = {} } = {}) {
	const unique = (code) => Object.assign(new Error('unique'), { code: 'P2002' });
	const state = {
		users: new Map(users.map((u) => [u.id, { banned: false, friendCode: null, displayUsername: null, image: null, ...u }])),
		friendships: [], requests: [], blocks: [], links: [], sessions: [], nextId: 1
	};
	const byId = (id) => state.users.get(id);
	const withUsers = (row, ...pairs) => ({ ...row, ...Object.fromEntries(pairs.map(([name, key]) => [name, byId(row[key])])) });
	const tables = {
		user: {
			findUnique: async ({ where }) => {
				const found = [...state.users.values()].find((u) => Object.entries(where).every(([k, v]) => u[k] === v));
				return found ? { ...found } : null;
			},
			findFirst: async ({ where }) => {
				const found = [...state.users.values()].find((u) => matches(u, where));
				return found ? { ...found } : null;
			},
			findMany: async ({ where }) => [...state.users.values()].filter((u) => matches(u, where)).map((u) => ({ ...u })),
			updateMany: async ({ where, data }) => {
				const rows = [...state.users.values()].filter((u) => matches(u, where));
				if (data.friendCode && [...state.users.values()].some((u) => u.friendCode === data.friendCode)) throw unique();
				for (const row of rows) Object.assign(row, data);
				return { count: rows.length };
			}
		},
		friendship: {
			findMany: async ({ where }) => state.friendships.filter((r) => matches(r, where)).map((r) => withUsers(r, ['userA', 'userAId'], ['userB', 'userBId'])),
			findUnique: async ({ where }) => state.friendships.find((r) => matches(r, where.userAId_userBId)) ?? null,
			count: async ({ where }) => state.friendships.filter((r) => matches(r, where)).length,
			create: async ({ data }) => {
				if (state.friendships.some((r) => r.userAId === data.userAId && r.userBId === data.userBId)) throw unique();
				state.friendships.push({ ...data, createdAt: new Date() });
			},
			deleteMany: async ({ where }) => {
				const before = state.friendships.length;
				state.friendships = state.friendships.filter((r) => !matches(r, where));
				return { count: before - state.friendships.length };
			}
		},
		friendRequest: {
			findMany: async ({ where }) => state.requests.filter((r) => matches(r, where)).map((r) => withUsers(r, ['from', 'fromUserId'], ['to', 'toUserId'])),
			findFirst: async ({ where }) => state.requests.find((r) => matches(r, where)) ?? null,
			findUnique: async ({ where }) => state.requests.find((r) => matches(r, where.fromUserId_toUserId)) ?? null,
			count: async ({ where }) => state.requests.filter((r) => matches(r, where)).length,
			create: async ({ data }) => {
				if (state.requests.some((r) => r.fromUserId === data.fromUserId && r.toUserId === data.toUserId)) throw unique();
				state.requests.push({ id: `r${state.nextId++}`, createdAt: new Date(), ...data });
			},
			deleteMany: async ({ where }) => {
				const before = state.requests.length;
				state.requests = state.requests.filter((r) => !matches(r, where));
				return { count: before - state.requests.length };
			}
		},
		userBlock: {
			findMany: async ({ where }) => state.blocks.filter((r) => matches(r, where)).map((r) => withUsers(r, ['blocked', 'blockedId'])),
			upsert: async ({ where, create }) => {
				const { blockerId, blockedId } = where.blockerId_blockedId;
				if (!state.blocks.some((r) => r.blockerId === blockerId && r.blockedId === blockedId)) state.blocks.push({ ...create, createdAt: new Date() });
			},
			deleteMany: async ({ where }) => {
				state.blocks = state.blocks.filter((r) => !matches(r, where));
			}
		},
		externalFriendLink: {
			findMany: async ({ where }) => state.links.filter((r) => matches(r, where)),
			deleteMany: async ({ where }) => {
				const before = state.links.length;
				state.links = state.links.filter((r) => !matches(r, where));
				return { count: before - state.links.length };
			},
			create: async ({ data }) => {
				if (state.links.some((r) => r.provider === data.provider && (r.externalId === data.externalId || r.userId === data.userId))) throw unique();
				state.links.push({ ...data });
			}
		},
		worldSession: {
			findFirst: async ({ where, select }) => {
				const row = state.sessions.map((r) => ({ ...r, world: worlds[r.worldId] })).find((r) => matches(r, where));
				return row ?? null;
			},
			findMany: async ({ where }) => state.sessions.map((r) => ({ ...r, world: worlds[r.worldId] })).filter((r) => matches(r, where))
		}
	};
	const prisma = {
		...tables,
		$transaction: async (fn) => {
			const snapshot = structuredClone({ friendships: state.friendships, requests: state.requests, blocks: state.blocks, links: state.links });
			try {
				return await fn(prisma);
			} catch (err) {
				Object.assign(state, snapshot);
				throw err;
			}
		}
	};
	return { prisma, state };
}
