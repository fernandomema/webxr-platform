/**
 * The rules for who owns a model, what it costs them, and when it can be
 * deleted. Pure, so they can be tested without a database: the server feeds in
 * rows and applies the plan that comes back.
 */

/**
 * Every owner is charged the full size of a model, even though only one copy
 * exists. Becoming an owner of something already owned is charged too (that is
 * what makes the number a fair "space used"), but keeping what you already own is free.
 */
export function wouldExceedQuota(input: { used: number; adding: number; alreadyOwner: boolean; quota: number }): boolean {
	if (input.quota <= 0 || input.alreadyOwner) return false;
	return input.used + input.adding > input.quota;
}

/** An owner can let go of a model only when none of the things they own still uses it. */
export function canReleaseOwnership(referencesOwnedByUser: number): boolean {
	return referencesOwnedByUser === 0;
}

export interface AssetRow {
	id: string;
	status: 'pending' | 'ready';
	createdAt: Date;
	orphanedAt: Date | null;
	owners: number;
	references: number;
}

export interface GcPlan {
	/** Nothing owns or uses these any more: start the grace period. */
	markOrphan: string[];
	/** Someone owns or uses these again: cancel the grace period. */
	clearOrphan: string[];
	/** Orphaned for longer than the grace period: delete from storage and the database. */
	delete: string[];
	/** Uploads that never completed. */
	purgePending: string[];
}

export function planAssetGc(rows: AssetRow[], now: Date, options: { graceDays: number; pendingHours?: number }): GcPlan {
	const graceMs = options.graceDays * 86_400_000;
	const pendingMs = (options.pendingHours ?? 24) * 3_600_000;
	const plan: GcPlan = { markOrphan: [], clearOrphan: [], delete: [], purgePending: [] };
	for (const row of rows) {
		if (row.status === 'pending') {
			if (row.owners === 0 && row.references === 0 && now.getTime() - row.createdAt.getTime() > pendingMs) plan.purgePending.push(row.id);
			continue;
		}
		const unused = row.owners === 0 && row.references === 0;
		if (!unused) {
			if (row.orphanedAt) plan.clearOrphan.push(row.id);
		} else if (!row.orphanedAt) {
			plan.markOrphan.push(row.id);
		} else if (now.getTime() - row.orphanedAt.getTime() >= graceMs) {
			plan.delete.push(row.id);
		}
	}
	return plan;
}
