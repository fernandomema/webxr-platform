import { ASSET_KINDS, FILE_ROLES, type AssetSource } from './types.ts';
import { parseAssetRef } from './ref.ts';

/**
 * Problems found in what a source returned (empty when it is fine). Used by the contract tests, and by the server to refuse a
 * source's answer that does not follow the contract instead of passing it on to the browser.
 */
const isHttps = (value: unknown): boolean => {
	try { return new URL(String(value)).protocol === 'https:'; } catch { return false; }
};

export function checkSummary(value: unknown, where = 'item'): string[] {
	const problems: string[] = [];
	const item = (value ?? {}) as Record<string, unknown>;
	if (!parseAssetRef(item.ref)) problems.push(`${where}.ref is not a valid reference`);
	if (!ASSET_KINDS.includes(item.kind as never)) problems.push(`${where}.kind is not a known kind`);
	if (typeof item.title !== 'string' || !item.title.trim()) problems.push(`${where}.title is empty`);
	if (item.thumbnailUrl !== undefined && !isHttps(item.thumbnailUrl)) problems.push(`${where}.thumbnailUrl is not https`);
	if (!isHttps(item.sourceUrl)) problems.push(`${where}.sourceUrl is not https`);
	if (typeof item.downloadable !== 'boolean') problems.push(`${where}.downloadable is not a boolean`);
	if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string')) problems.push(`${where}.tags is not a list of strings`);
	const license = (item.license ?? {}) as Record<string, unknown>;
	if (typeof license.name !== 'string' || !license.name) problems.push(`${where}.license.name is empty`);
	for (const key of ['commercialUse', 'attributionRequired']) if (typeof license[key] !== 'boolean' && license[key] !== 'unknown') problems.push(`${where}.license.${key} is neither true, false nor "unknown"`);
	return problems;
}

export function checkDetail(value: unknown): string[] {
	const problems = checkSummary(value, 'detail');
	const variants = (value as { variants?: unknown } | null)?.variants;
	if (!Array.isArray(variants)) return [...problems, 'detail.variants is not a list'];
	variants.forEach((variant: Record<string, unknown>, index) => {
		const at = `variants[${index}]`;
		if (typeof variant.id !== 'string' || !variant.id) problems.push(`${at}.id is empty`);
		if (typeof variant.label !== 'string' || !variant.label) problems.push(`${at}.label is empty`);
		if (!Array.isArray(variant.files) || !variant.files.length) problems.push(`${at}.files is empty`);
		else (variant.files as Record<string, unknown>[]).forEach((file, f) => {
			if (!FILE_ROLES.includes(file.role as never)) problems.push(`${at}.files[${f}].role is not a known role`);
			if (typeof file.url !== 'string' || !file.url) problems.push(`${at}.files[${f}].url is empty`);
			if (typeof file.format !== 'string' || !file.format) problems.push(`${at}.files[${f}].format is empty`);
		});
	});
	return problems;
}

export function checkSourceInfo(source: AssetSource): string[] {
	const { info } = source;
	const problems: string[] = [];
	if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(info.id)) problems.push('info.id is not a valid source id');
	if (!info.name) problems.push('info.name is empty');
	if (!isHttps(info.homepage)) problems.push('info.homepage is not https');
	if (!info.kinds.length || info.kinds.some((kind) => !ASSET_KINDS.includes(kind))) problems.push('info.kinds is empty or has an unknown kind');
	if (info.access === 'api' && !info.allowedHosts.length) problems.push('an api source needs allowedHosts');
	return problems;
}
