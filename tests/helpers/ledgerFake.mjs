/** An in-memory stand-in for the part of Prisma's transaction client the ledger uses, with rollback when the callback throws. */
export function createFakeDb() {
	const state = { accounts: new Map(), transactions: [], entitlements: new Map() };
	const clone = () => ({ accounts: new Map([...state.accounts].map(([k, v]) => [k, { ...v }])), transactions: state.transactions.map((t) => ({ ...t })), entitlements: new Map([...state.entitlements].map(([k, v]) => [k, { ...v }])) });
	const entitlementKey = ({ userId, publicationId, sku }) => `${userId}|${publicationId}|${sku}`;
	const tx = {
		creditAccount: {
			upsert: async ({ where, create }) => { if (!state.accounts.has(where.userId)) state.accounts.set(where.userId, { balance: create.balance }); return { ...state.accounts.get(where.userId) }; },
			findUnique: async ({ where }) => (state.accounts.has(where.userId) ? { ...state.accounts.get(where.userId) } : null),
			updateMany: async ({ where, data }) => {
				const account = state.accounts.get(where.userId);
				if (!account) return { count: 0 };
				if ('gte' in where.balance && !(account.balance >= where.balance.gte)) return { count: 0 };
				if ('lte' in where.balance && !(account.balance <= where.balance.lte)) return { count: 0 };
				account.balance += 'increment' in data.balance ? data.balance.increment : -data.balance.decrement;
				return { count: 1 };
			}
		},
		creditTransaction: {
			findUnique: async ({ where }) => state.transactions.find((t) => t.idempotencyKey === where.idempotencyKey) ?? null,
			create: async ({ data }) => {
				if (state.transactions.some((t) => t.idempotencyKey === data.idempotencyKey)) throw Object.assign(new Error('unique'), { code: 'P2002' });
				state.transactions.push({ ...data, createdAt: new Date(state.now ?? Date.now()) });
			},
			aggregate: async ({ where }) => ({ _sum: { delta: state.transactions.filter((t) => t.userId === where.userId && t.kind === where.kind && t.createdAt >= where.createdAt.gte && (where.publicationId === undefined || t.publicationId === where.publicationId)).reduce((sum, t) => sum + t.delta, 0) || null } })
		},
		productEntitlement: {
			findUnique: async ({ where }) => state.entitlements.get(entitlementKey(where.userId_publicationId_sku)) ?? null,
			upsert: async ({ where, create, update }) => {
				const key = entitlementKey(where.userId_publicationId_sku);
				const existing = state.entitlements.get(key);
				if (existing) existing.quantity += update.quantity.increment; else state.entitlements.set(key, { quantity: create.quantity });
			}
		}
	};
	return {
		state,
		tx,
		/** Runs `fn` as a transaction: whatever it changed is undone if it throws. */
		async transaction(fn) {
			const saved = clone();
			try { return await fn(tx); } catch (err) { state.accounts = saved.accounts; state.transactions = saved.transactions; state.entitlements = saved.entitlements; throw err; }
		}
	};
}
