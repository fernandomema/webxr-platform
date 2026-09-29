import { authClient } from '$lib/auth-client';
import { availableInventoryFolders } from '$lib/inventory/registry';
import type { InventoryAdapter, InventoryContext } from '$lib/inventory/types';

/** Who is using the Studio and which inventories they can save to. */
class StudioSession {
	userId = $state<string | null>(null);
	userName = $state<string | null>(null);
	ready = $state(false);
	/** Read by inventory adapters, so it is kept in sync with the reactive fields above. */
	readonly context: InventoryContext = { worldId: null, userId: null };

	adapters = $derived<InventoryAdapter[]>(this.ready ? availableInventoryFolders({ worldId: null, userId: this.userId }) : []);

	private loading: Promise<void> | null = null;

	init(): Promise<void> {
		this.loading ??= this.refresh();
		return this.loading;
	}

	async refresh(): Promise<void> {
		try {
			const session = await authClient.getSession();
			this.userId = session.data?.user.id ?? null;
			this.userName = session.data?.user.name ?? null;
		} catch {
			this.userId = null;
			this.userName = null;
		}
		this.context.userId = this.userId;
		this.ready = true;
	}
}

export const studioSession = new StudioSession();
