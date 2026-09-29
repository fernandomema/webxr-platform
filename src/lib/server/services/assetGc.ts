import { env } from '$env/dynamic/private';
import { planAssetGc, type AssetRow } from '$lib/assets/accounting';
import { prisma } from '../db';
import { assetStorageConfigured, deleteObject, listKeys } from '../assetStorage';


export interface GcReport {
	applied: boolean;
	graceDays: number;
	marked: string[];
	cleared: string[];
	deleted: string[];
	purgedPending: string[];
	/** Objects in storage that have no database row (a crash between upload and record). */
	strayObjects: string[];
	freedBytes: number;
}

/**
 * Cleans up models. An asset is only ever deleted when it has no owner and no
 * reference, has been unused for the whole grace period, and is still unused
 * when re-checked right before deleting. Without `apply` it only reports.
 */
export async function runAssetGc(apply: boolean): Promise<GcReport> {
	const graceDays = Number(env.ASSET_GC_GRACE_DAYS ?? 7);
	const rows = await prisma.asset.findMany({
		select: {
			id: true, status: true, createdAt: true, orphanedAt: true, byteSize: true, storageKey: true,
			_count: { select: { owners: true, cloudItems: true, worldItems: true, revisions: true, worlds: true } }
		}
	});
	const byId = new Map(rows.map((row) => [row.id, row]));
	const plan = planAssetGc(
		rows.map((row): AssetRow => ({
			id: row.id,
			status: row.status === 'ready' ? 'ready' : 'pending',
			createdAt: row.createdAt,
			orphanedAt: row.orphanedAt,
			owners: row._count.owners,
			references: row._count.cloudItems + row._count.worldItems + row._count.revisions + row._count.worlds
		})),
		new Date(),
		{ graceDays }
	);

	const report: GcReport = { applied: apply, graceDays, marked: plan.markOrphan, cleared: plan.clearOrphan, deleted: [], purgedPending: [], strayObjects: [], freedBytes: 0 };

	const stillUnused = async (id: string) => {
		const fresh = await prisma.asset.findUnique({
			where: { id },
			select: { _count: { select: { owners: true, cloudItems: true, worldItems: true, revisions: true, worlds: true } } }
		});
		if (!fresh) return false;
		const c = fresh._count;
		return c.owners + c.cloudItems + c.worldItems + c.revisions + c.worlds === 0;
	};

	if (apply) {
		if (plan.markOrphan.length) await prisma.asset.updateMany({ where: { id: { in: plan.markOrphan } }, data: { orphanedAt: new Date() } });
		if (plan.clearOrphan.length) await prisma.asset.updateMany({ where: { id: { in: plan.clearOrphan } }, data: { orphanedAt: null } });
	}
	for (const [ids, bucket] of [[plan.delete, report.deleted], [plan.purgePending, report.purgedPending]] as const) {
		for (const id of ids) {
			const row = byId.get(id)!;
			if (apply) {
				if (!(await stillUnused(id))) continue; // claimed again while we were working
				if (assetStorageConfigured()) await deleteObject(row.storageKey);
				await prisma.asset.delete({ where: { id } });
			}
			bucket.push(id);
			report.freedBytes += row.byteSize;
		}
	}

	// Objects with no row at all (older than the grace period, so an upload in flight is never touched).
	if (assetStorageConfigured()) {
		const known = new Set(rows.map((row) => row.storageKey));
		const cutoff = Date.now() - graceDays * 86_400_000;
		for await (const object of listKeys('assets/sha256/')) {
			if (known.has(object.key) || (object.lastModified?.getTime() ?? 0) > cutoff) continue;
			report.strayObjects.push(object.key);
			if (apply) await deleteObject(object.key);
		}
	}
	return report;
}


