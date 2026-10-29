import type { License } from './types.ts';

/** Where an imported asset came from. It is metadata beside the bytes: it never changes the asset's content address. */
export interface AssetProvenance {
	/** The source's id (`polyhaven`). */
	source: string;
	/** The asset in that source (`polyhaven:brick_wall_002`). */
	ref: string;
	/** The asset's own page. */
	sourceUrl: string;
	author?: string;
	license: License;
	/** When it was imported, in milliseconds. */
	importedAt: number;
}

const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);
const tristate = (value: unknown): boolean | 'unknown' => (value === true || value === false ? value : 'unknown');

function httpsUrl(value: unknown): string | undefined {
	const raw = text(value, 500);
	if (!raw) return undefined;
	try { return new URL(raw).protocol === 'https:' ? raw : undefined; } catch { return undefined; }
}

/**
 * Provenance arrives from a client, so it is rebuilt from known fields with bounded text rather than stored as received.
 * Returns null when there is not enough to say where the asset came from.
 */
export function sanitizeProvenance(value: unknown): AssetProvenance | null {
	const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	const license = (input.license && typeof input.license === 'object' ? input.license : {}) as Record<string, unknown>;
	const source = text(input.source, 32);
	const ref = text(input.ref, 220);
	const sourceUrl = httpsUrl(input.sourceUrl);
	const licenseName = text(license.name, 80);
	if (!source || !ref || !sourceUrl || !licenseName) return null;
	const importedAt = typeof input.importedAt === 'number' && Number.isFinite(input.importedAt) ? Math.max(0, Math.floor(input.importedAt)) : 0;
	return {
		source, ref, sourceUrl,
		...(text(input.author, 120) ? { author: text(input.author, 120) } : {}),
		license: { name: licenseName, ...(httpsUrl(license.url) ? { url: httpsUrl(license.url) } : {}), commercialUse: tristate(license.commercialUse), attributionRequired: tristate(license.attributionRequired) },
		importedAt
	};
}

export interface CreditEntry { title: string; author?: string; license: string; sourceUrl: string; ref: string }

/** The credits a set of assets owes: one line per distinct source asset whose license asks for attribution, without repeats. */
export function creditsFor(assets: readonly { name: string; provenance?: AssetProvenance }[]): CreditEntry[] {
	const seen = new Set<string>();
	const entries: CreditEntry[] = [];
	for (const { name, provenance } of assets) {
		if (!provenance || provenance.license.attributionRequired !== true || seen.has(provenance.ref)) continue;
		seen.add(provenance.ref);
		entries.push({ title: name, ...(provenance.author ? { author: provenance.author } : {}), license: provenance.license.name, sourceUrl: provenance.sourceUrl, ref: provenance.ref });
	}
	return entries.sort((a, b) => a.title.localeCompare(b.title));
}

/** The credits as plain text, one line each, ready to paste into a description or a credits screen. */
export function creditsText(entries: readonly CreditEntry[]): string {
	return entries.map((entry) => `${entry.title}${entry.author ? ` by ${entry.author}` : ''} — ${entry.license} (${entry.sourceUrl})`).join('\n');
}
