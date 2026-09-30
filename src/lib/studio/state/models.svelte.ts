import { AssetImportError } from '$lib/assets/kinds';
import { acceptedExtensions, assetKindForFileName } from '$lib/assets/kinds';
import { importAssetFile } from '$lib/assets/importAsset';
import type { AssetId } from '$lib/assets/ref';
import { getLocalAssetStore, type AssetListing } from '$lib/assets/store';
import { toasts } from './toasts.svelte';

/** The assets imported on this device, as the Studio shows them. Works for every registered asset kind. */
class StudioAssets {
	items = $state<AssetListing[]>([]);
	loaded = $state(false);
	importing = $state(false);

	async refresh(): Promise<void> {
		try {
			this.items = (await getLocalAssetStore().list()).sort((a, b) => b.importedAt - a.importedAt);
		} catch (error) {
			toasts.error(error, 'Could not read the assets on this device');
		} finally {
			this.loaded = true;
		}
	}

	/** The imported assets of one kind (`model`, `audio`, …). */
	ofType<T extends AssetListing['type']>(type: T): Array<Extract<AssetListing, { type: T }>> {
		return this.items.filter((item): item is Extract<AssetListing, { type: T }> => item.type === type);
	}

	byId(id: AssetId): AssetListing | undefined {
		return this.items.find((item) => item.assetId === id);
	}

	/** Imports each file independently; a bad file reports its own reason and never blocks the others. */
	async importFiles(files: Iterable<File>, type?: string): Promise<AssetListing[]> {
		this.importing = true;
		const imported: AssetListing[] = [];
		try {
			for (const file of files) {
				const kind = assetKindForFileName(file.name);
				if (!kind || (type && kind.type !== type)) {
					toasts.push('error', `“${file.name}” is not a supported file.`);
					continue;
				}
				try {
					const result = await importAssetFile(file, getLocalAssetStore());
					await this.refresh();
					const listing = this.byId(result.manifest.assetId);
					if (listing) imported.push(listing);
					toasts.success(result.alreadyStored ? `“${result.manifest.name}” was already imported.` : `Imported “${result.manifest.name}”.`);
				} catch (error) {
					toasts.push('error', error instanceof AssetImportError ? `“${file.name}”: ${error.message}` : `“${file.name}” could not be imported.`);
				}
			}
		} finally {
			this.importing = false;
		}
		return imported;
	}

	/** Opens the system file picker (restricted to one kind when given) and imports what is chosen. */
	pickAndImport(type?: string): Promise<AssetListing[]> {
		return new Promise((resolve) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = acceptedExtensions(type).join(',');
			input.multiple = true;
			input.onchange = () => void this.importFiles([...(input.files ?? [])], type).then(resolve);
			input.oncancel = () => resolve([]);
			input.click();
		});
	}

	async remove(id: AssetId): Promise<void> {
		try {
			await getLocalAssetStore().delete(id);
			await this.refresh();
		} catch (error) {
			toasts.error(error, 'Could not remove the asset');
		}
	}
}

export const studioAssets = new StudioAssets();
/** Kept for the callers written before assets had kinds; models are one kind among several. */
export const studioModels = {
	get items() { return studioAssets.ofType('model'); },
	get loaded() { return studioAssets.loaded; },
	get importing() { return studioAssets.importing; },
	refresh: () => studioAssets.refresh(),
	byId: (id: AssetId) => studioAssets.byId(id),
	importFiles: (files: Iterable<File>) => studioAssets.importFiles(files, 'model'),
	pickAndImport: () => studioAssets.pickAndImport('model'),
	remove: (id: AssetId) => studioAssets.remove(id)
};

export function formatBytes(bytes: number): string {
	return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
