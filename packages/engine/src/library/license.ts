import type { License } from './types.ts';

export const UNKNOWN_LICENSE: License = { name: 'Unknown', commercialUse: 'unknown', attributionRequired: 'unknown' };
export const CC0: License = { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', commercialUse: true, attributionRequired: false };

/** Only an explicit yes counts: a license that does not say is treated as not allowing commercial use. */
export const allowsCommercialUse = (license: License | undefined): boolean => license?.commercialUse === true;

/** What a person should see on a card: the name, and a note when credit is owed or the terms are not known. */
export function describeLicense(license: License): string {
	const notes = [license.attributionRequired === true ? 'credit required' : '', license.commercialUse === false ? 'no commercial use' : '', license.commercialUse === 'unknown' ? 'terms unknown' : ''].filter(Boolean);
	return notes.length ? `${license.name} · ${notes.join(', ')}` : license.name;
}
