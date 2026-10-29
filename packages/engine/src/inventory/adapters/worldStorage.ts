import type { InventoryAdapter, InventoryFolder, InventoryItem } from '../types.ts';
import { getWorldItemStore } from '../../worldStorage/registry.ts';
import { WorldItemError, type WorldItem } from '../../worldStorage/items.ts';

const asItem = (item: WorldItem): InventoryItem => ({
	id: item.id,
	folderId: null,
	name: item.name,
	slotData: item.slotData,
	kind: 'object',
	thumbnailAssetId: item.thumbnailAssetId,
	createdAt: item.createdAt
});

const store = () => {
	const found = getWorldItemStore();
	if (!found) throw new WorldItemError('unavailable', 'World storage is not available here');
	return found;
};

/**
 * What this world has saved for the person hosting it (see `worldStorage/items.ts`): a flat list of objects, kept on this device or in
 * the cloud as the host chose. Only there while a published world is hosted, and only for its host, since the objects are theirs.
 */
export const worldStorageInventoryAdapter: InventoryAdapter = {
	id: 'worldStorage',
	label: 'World Storage',

	isAvailable(ctx) {
		return Boolean(ctx.publicationId) && getWorldItemStore() !== null;
	},

	async listFolders() {
		return [] as InventoryFolder[];
	},

	async listItems(_ctx, folderId) {
		return folderId === null ? (await store().list()).map(asItem) : [];
	},

	async saveItem(_ctx, _folderId, name, slotData, kind = 'object', _lineage, thumbnailAssetId) {
		if (kind !== 'object') throw new WorldItemError('invalid', 'Only objects can be kept in world storage');
		return asItem(await store().save({ name, slotData, thumbnailAssetId }));
	},

	async updateItem(_ctx, itemId, _folderId, name, slotData, thumbnailAssetId) {
		return asItem(await store().save({ id: itemId, name, slotData, ...(thumbnailAssetId === undefined ? {} : { thumbnailAssetId }) }));
	},

	async updateItemInfo(_ctx, itemId, changes) {
		const current = await store().find({ id: itemId });
		if (!current) throw new WorldItemError('not-found', 'That object is no longer saved');
		return asItem(await store().save({ id: itemId, key: current.key, name: changes.name ?? current.name, slotData: current.slotData }));
	},

	async deleteItem(_ctx, itemId) {
		await store().remove({ id: itemId });
	}
};
