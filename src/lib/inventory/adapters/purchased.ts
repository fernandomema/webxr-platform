import { platformFetch } from '../../xr/platform/config.ts';
import type { InventoryAdapter, InventoryItem } from '../types';

/** Read-only inventory backed by acquisitions from the marketplace. */
export const purchasedInventoryAdapter: InventoryAdapter = {
  id: 'purchased',
  label: 'Purchased Objects',
  isAvailable: (ctx) => ctx.userId !== null,
  async listFolders() { return []; },
  async listItems() {
    const response = await platformFetch('/api/marketplace/purchases');
    if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to view purchased objects.' : 'Could not load purchased objects.');
    return await response.json() as InventoryItem[];
  }
};
