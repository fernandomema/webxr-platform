import { authClient } from '$lib/auth-client';
import { availableInventoryFolders } from '@kithin/engine/inventory/registry';
import { isAdminUser } from '@kithin/engine/xr/platform/auth';
import type { InventoryAdapter, InventoryContext } from '@kithin/engine/inventory/types';

/** Who is using the Studio and which inventories they can save to. */
class StudioSession {
	userId = $state<string | null>(null);
	userName = $state<string | null>(null);
	isAdmin = $state(false);
	ready = $state(false);
	/** Read by inventory adapters, so it is kept in sync with the reactive fields above. */
	readonly context: InventoryContext = { worldId: null, userId: null, isAdmin: false };

	adapters = $derived<InventoryAdapter[]>(this.ready ? availableInventoryFolders({ worldId: null, userId: this.userId, isAdmin: this.isAdmin }) : []);

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
			this.isAdmin = isAdminUser(session.data?.user);
		} catch {
			this.userId = null;
			this.userName = null;
			this.isAdmin = false;
		}
		this.context.userId = this.userId;
		this.context.isAdmin = this.isAdmin;
		this.ready = true;
	}
}

export const studioSession = new StudioSession();
