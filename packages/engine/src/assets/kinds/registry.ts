import type { AssetManifestBase } from '../manifest.ts';
import type { AssetFormat, AssetKindDef } from './types.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kinds = new Map<string, AssetKindDef<any>>();

export function registerAssetKind<M extends AssetManifestBase>(def: AssetKindDef<M>): void {
	kinds.set(def.type, def);
}

export function getAssetKind(type: string): AssetKindDef | undefined {
	return kinds.get(type);
}

export function allAssetKinds(): AssetKindDef[] {
	return [...kinds.values()];
}

export function formatOf(kind: AssetKindDef, format: string): AssetFormat | undefined {
	return kind.formats.find((entry) => entry.format === format);
}

/** Finds the kind whose format matches the leading bytes of a file. */
export function sniffAssetKind(head: Uint8Array): { kind: AssetKindDef; format: string } | null {
	for (const kind of kinds.values()) {
		const format = kind.sniff(head);
		if (format) return { kind, format };
	}
	return null;
}

/** Every file extension any registered kind can import, for `<input accept>`. */
export function acceptedExtensions(type?: string): string[] {
	return allAssetKinds()
		.filter((kind) => !type || kind.type === type)
		.flatMap((kind) => kind.formats.flatMap((format) => format.extensions));
}

/** Which kind a file name belongs to by extension (used only to route a drop; the bytes are still sniffed). */
export function assetKindForFileName(name: string): AssetKindDef | undefined {
	const lower = name.toLowerCase();
	return allAssetKinds().find((kind) => kind.formats.some((format) => format.extensions.some((ext) => lower.endsWith(ext))));
}
