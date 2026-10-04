import type { MaterialComponent } from '../ecs/types';
import type { SourceRef } from '../assets/ref';

/** The maps of a material, in the order they are loaded. */
export const MATERIAL_MAPS = ['albedo', 'normal', 'arm'] as const;
export type MaterialMap = (typeof MATERIAL_MAPS)[number];

const MAX_URL_LENGTH = 2048;

/** A picture address a material may use: https, from any host (a texture library's CDN, for instance), of a sane length. */
export function isMaterialUrl(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false;
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}

/** Whether a stored map is one the renderer can use: an asset, or an https address. */
export function isMaterialSource(source: SourceRef | undefined): boolean {
	return !!source && (source.kind === 'asset' || (source.kind === 'url' && isMaterialUrl(source.url)));
}

/** Whether a stored map is well formed: an asset id of the right shape, or an https address. For validating a world that is read from outside. */
export function isValidMaterialMap(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const source = value as { kind?: unknown; url?: unknown; assetId?: unknown };
	return (source.kind === 'asset' && typeof source.assetId === 'string' && /^sha256:[0-9a-f]{64}$/.test(source.assetId)) || (source.kind === 'url' && isMaterialUrl(source.url));
}

/** What identifies a map's texture: two slots with the same key share one texture. `null` for a map that cannot be used. */
export function materialSourceKey(source: SourceRef | undefined): string | null {
	if (!source || !isMaterialSource(source)) return null;
	return source.kind === 'asset' ? `asset:${source.assetId}` : `url:${source.url}`;
}

/** The maps a material actually has and can load, by name. */
export function materialSources(material: MaterialComponent): Partial<Record<MaterialMap, SourceRef>> {
	const found: Partial<Record<MaterialMap, SourceRef>> = {};
	for (const name of MATERIAL_MAPS) if (isMaterialSource(material[name])) found[name] = material[name];
	return found;
}
