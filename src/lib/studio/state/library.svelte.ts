import { getInventoryAdapter } from '$lib/inventory/registry';
import type { InventoryAdapter, InventoryContext, InventoryFolder, InventoryItem } from '$lib/inventory/types';

/** Browses one inventory adapter: current folder, breadcrumb path, items and search. */
export class Library {
	adapterId = $state('local');
	path = $state<InventoryFolder[]>([]);
	folders = $state<InventoryFolder[]>([]);
	items = $state<InventoryItem[]>([]);
	query = $state('');
	loading = $state(false);
	error = $state<string | null>(null);

	constructor(private readonly context: InventoryContext, adapterId = 'local') {
		this.adapterId = adapterId;
	}

	get adapter(): InventoryAdapter | undefined {
		return getInventoryAdapter(this.adapterId);
	}

	get folderId(): string | null {
		return this.path.at(-1)?.id ?? null;
	}

	visibleItems = $derived(this.items.filter((item) => item.name.toLowerCase().includes(this.query.trim().toLowerCase())));
	visibleFolders = $derived(this.folders.filter((folder) => folder.name.toLowerCase().includes(this.query.trim().toLowerCase())));

	async load(): Promise<void> {
		const adapter = this.adapter;
		if (!adapter) return;
		this.loading = true;
		this.error = null;
		try {
			const [folders, items] = await Promise.all([
				adapter.listFolders(this.context, this.folderId),
				adapter.listItems(this.context, this.folderId)
			]);
			this.folders = folders;
			this.items = items;
		} catch (error) {
			this.folders = [];
			this.items = [];
			this.error = error instanceof Error ? error.message : 'Could not load the library';
		} finally {
			this.loading = false;
		}
	}

	async switchAdapter(id: string): Promise<void> {
		this.adapterId = id;
		this.path = [];
		this.query = '';
		await this.load();
	}

	async openFolder(folder: InventoryFolder): Promise<void> {
		this.path = [...this.path, folder];
		await this.load();
	}

	/** Jumps to a breadcrumb: `-1` is the root, otherwise an index into `path`. */
	async goTo(index: number): Promise<void> {
		this.path = this.path.slice(0, index + 1);
		await this.load();
	}

	async createFolder(name: string): Promise<void> {
		if (!this.adapter?.createFolder) throw new Error('This inventory is read-only.');
		await this.adapter.createFolder(this.context, this.folderId, name);
		await this.load();
	}

	async deleteFolder(folder: InventoryFolder): Promise<void> {
		if (!this.adapter?.deleteFolder) throw new Error('This inventory is read-only.');
		await this.adapter.deleteFolder(this.context, folder.id);
		await this.load();
	}

	async deleteItem(item: InventoryItem): Promise<void> {
		if (!this.adapter?.deleteItem) throw new Error('This inventory is read-only.');
		await this.adapter.connect?.();
		await this.adapter.deleteItem(this.context, item.id);
		await this.load();
	}
}
