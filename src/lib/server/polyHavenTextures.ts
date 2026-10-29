/**
 * The pure rules for taking a texture from Poly Haven: which of its files stands for each map and which addresses may be
 * downloaded. Kept apart from the code that talks to the network so they can be tested.
 */
export const TEXTURE_MAPS = ['albedo', 'normal', 'arm'] as const;
export type TextureMap = (typeof TEXTURE_MAPS)[number];

/** The names a texture's files go by in Poly Haven's file list, best first (the same choice the in-world material shop makes). */
const FILE_NAMES: Record<TextureMap, string[]> = {
	albedo: ['Diffuse', 'diff', 'col_1', 'col_01', 'col_2'],
	normal: ['nor_gl'],
	arm: ['arm']
};
/** 1k is plenty for a surface at arm's length and light on a headset; larger ones only when 1k is missing. */
const RESOLUTIONS = ['1k', '2k'];
/** The sizes offered as variants: more than 2k is more than a surface seen at arm's length can use. */
export const VARIANT_RESOLUTIONS = ['1k', '2k'] as const;
const FORMATS = ['jpg', 'png'];

export const MAX_TEXTURE_BYTES = 8 * 1024 * 1024;

export interface TextureFile { url: string; size: number }

/** The file for a map, or null when the texture does not have it. With `only`, just that size; otherwise the smallest that exists. */
export function textureFileFor(files: unknown, map: TextureMap, only?: string): TextureFile | null {
	const list = files && typeof files === 'object' ? files as Record<string, unknown> : {};
	for (const name of FILE_NAMES[map]) {
		const sizes = list[name] as Record<string, Record<string, TextureFile> | undefined> | undefined;
		if (!sizes || typeof sizes !== 'object') continue;
		for (const resolution of only ? [only] : RESOLUTIONS) for (const format of FORMATS) {
			const file = sizes[resolution]?.[format];
			if (file && typeof file.url === 'string' && Number.isFinite(file.size) && file.size > 0) return file;
		}
	}
	return null;
}

/** Only Poly Haven's own download host and texture folder, over https: a file list can not send the server elsewhere. */
export function isTextureUrl(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname === 'dl.polyhaven.org' && url.pathname.startsWith('/file/ph-assets/Textures/') && !url.username && !url.password;
	} catch {
		return false;
	}
}

export const isTextureId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_]{1,90}$/.test(value);

/** What a map is called in the library contract's roles. */
export const MAP_ROLES: Record<TextureMap, 'albedo' | 'normal' | 'arm'> = { albedo: 'albedo', normal: 'normal', arm: 'arm' };

/** One variant per size that has at least a colour or a normal map, with the maps it has as files. */
export function textureVariants(files: unknown): { resolution: string; maps: { role: 'albedo' | 'normal' | 'arm'; file: TextureFile }[] }[] {
	const result = [];
	for (const resolution of VARIANT_RESOLUTIONS) {
		const maps = TEXTURE_MAPS.flatMap((map) => {
			const file = textureFileFor(files, map, resolution);
			return file && isTextureUrl(file.url) && file.size <= MAX_TEXTURE_BYTES ? [{ role: MAP_ROLES[map], file }] : [];
		});
		if (maps.some((entry) => entry.role === 'albedo' || entry.role === 'normal')) result.push({ resolution, maps });
	}
	return result;
}
