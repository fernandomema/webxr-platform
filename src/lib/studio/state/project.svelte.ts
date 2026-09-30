import type { SlotTree } from '$lib/ecs/types';
import { getInventoryAdapter } from '$lib/inventory/registry';
import type { InventoryContext, InventoryItem } from '$lib/inventory/types';
import { validateWorldScene } from '$lib/worlds/package';
import { ensureCloudAssets, type CloudSyncProgress } from '$lib/assets/cloudSync';
import { getLocalAssetStore } from '$lib/assets/store';
import { getTemplate } from '../templates';
import { cloneTree } from '../tree/ops';
import { deleteDraft, loadDraft, saveDraft, type Draft } from './autosave';
import { StudioDocument } from './document.svelte';

export interface SaveTarget {
	adapterId: string;
	folderId: string | null;
	name: string;
}

export interface PublicationSummary {
	id: string;
	name: string;
	ownerId: string;
	latestRevision: number;
}

export interface PublishResult {
	id: string;
	revision: number;
	name: string;
}

export type ProjectStatus = 'loading' | 'ready' | 'error';

/**
 * One open editing session: the document plus where it lives (inventory
 * adapter/folder/item), its autosaved draft and its published-world link.
 */
export class StudioProject {
	readonly doc = new StudioDocument();
	status = $state<ProjectStatus>('loading');
	error = $state('');
	saving = $state(false);
	/** Set while models are being sent to the cloud before a save or publish. */
	assetProgress = $state<CloudSyncProgress | null>(null);
	adapterId = $state<string | null>(null);
	folderId = $state<string | null>(null);
	item = $state.raw<InventoryItem | null>(null);
	/** A draft newer than what was opened, waiting for the person to restore or discard it. */
	pendingDraft = $state.raw<Draft | null>(null);

	private newDraftId: string = crypto.randomUUID();

	constructor(private readonly context: InventoryContext) {}

	get isSaved(): boolean {
		return this.item !== null;
	}

	/** Stable across saves of the same lineage, so a world's revisions share one draft and one publication. */
	get key(): string {
		if (this.item) {
			if (this.item.kind === 'world' && this.item.worldLineageId) return `lineage:${this.item.worldLineageId}`;
			return `item:${this.adapterId}:${this.item.id}`;
		}
		return `new:${this.newDraftId}`;
	}

	async open(params: URLSearchParams): Promise<void> {
		this.status = 'loading';
		try {
			const templateId = params.get('template');
			const itemId = params.get('item');
			if (itemId) await this.openItem(params.get('source') ?? 'local', params.get('folder'), itemId);
			else {
				const template = getTemplate(templateId) ?? getTemplate('blank-world')!;
				this.newDraftId = params.get('draft') ?? this.newDraftId;
				this.doc.load(template.build(), template.defaultName, template.kind);
			}
			await this.checkDraft();
			this.status = 'ready';
		} catch (error) {
			this.error = error instanceof Error ? error.message : 'Could not open this project';
			this.status = 'error';
		}
	}

	private async openItem(adapterId: string, folder: string | null, itemId: string): Promise<void> {
		const adapter = getInventoryAdapter(adapterId);
		if (!adapter) throw new Error('Unknown storage location.');
		const folderId = folder && folder !== 'root' ? folder : null;
		const found = (await adapter.listItems(this.context, folderId)).find((candidate) => candidate.id === itemId);
		if (!found) throw new Error('This project no longer exists, or it was moved.');
		this.adapterId = adapterId;
		this.folderId = found.folderId;
		this.item = found;
		this.doc.load(found.slotData, found.name, found.kind === 'world' ? 'world' : 'object');
	}

	private async checkDraft(): Promise<void> {
		const draft = await loadDraft(this.key);
		if (draft && JSON.stringify(draft.tree) !== JSON.stringify(this.doc.tree)) this.pendingDraft = draft;
	}

	restoreDraft(): void {
		const draft = this.pendingDraft;
		if (!draft) return;
		this.doc.replaceTree(draft.tree);
		this.doc.rename(draft.name);
		this.pendingDraft = null;
	}

	async discardDraft(): Promise<void> {
		this.pendingDraft = null;
		await deleteDraft(this.key);
	}

	/** Called (debounced) while the document has unsaved edits. */
	async writeDraft(): Promise<void> {
		if (this.status !== 'ready' || this.pendingDraft) return;
		await saveDraft({ key: this.key, name: this.doc.name, kind: this.doc.kind, tree: cloneTree(this.doc.tree), savedAt: Date.now() });
	}

	async save(target?: SaveTarget): Promise<InventoryItem> {
		const adapterId = target?.adapterId ?? (this.adapterId === 'purchased' ? 'local' : this.adapterId);
		const adapter = adapterId ? getInventoryAdapter(adapterId) : undefined;
		if (!adapter || !adapterId) throw new Error('Choose where to save this project.');
		const name = (target?.name ?? this.doc.name).trim();
		if (!name) throw new Error('Give the project a name first.');
		const folderId = target ? target.folderId : this.folderId;
		const previousKey = this.key;
		const tree: SlotTree = cloneTree(this.doc.tree);
		if (this.doc.kind === 'world') validateWorldScene(tree);

		this.saving = true;
		try {
			if (adapterId === 'cloud') await this.sendModels(tree);
			const sameLocation = this.item !== null && adapterId === this.adapterId;
			const saved =
				this.doc.kind === 'object' && sameLocation && adapter.updateItem
					? await adapter.updateItem(this.context, this.item!.id, folderId, name, tree)
					: await (adapter.saveItem
						? adapter.saveItem(this.context, folderId, name, tree, this.doc.kind, this.doc.kind === 'world' && sameLocation ? (this.item?.worldLineageId ?? undefined) : undefined)
						: Promise.reject(new Error('This inventory is read-only.')));
			this.adapterId = adapterId;
			this.folderId = saved.folderId;
			this.item = saved;
			this.doc.rename(saved.name);
			this.doc.markSaved();
			await deleteDraft(previousKey);
			await deleteDraft(this.key);
			return saved;
		} finally {
			this.saving = false;
		}
	}

	async deleteFromLibrary(): Promise<void> {
		if (!this.item || !this.adapterId) return;
		await getInventoryAdapter(this.adapterId)?.deleteItem?.(this.context, this.item.id);
		await deleteDraft(this.key);
	}

	async publishMarketplaceItem(name: string, description: string, thumbnailUrl?: string): Promise<{ id: string; revision: number }> {
		if (this.doc.kind !== 'object') throw new Error('Only objects can be published to the marketplace.');
		if (!this.item || this.adapterId === 'purchased') throw new Error('Save this object to a writable inventory before publishing it.');
		const scene = cloneTree(this.doc.tree);
		validateWorldScene(scene);
		await this.sendModels(scene);
		const body: Record<string, unknown> = { name, description, thumbnailUrl: thumbnailUrl || null };
		if (this.item?.marketplaceItemId) {
			body.slotData = scene;
			const response = await fetch(`/api/marketplace/items/${this.item.marketplaceItemId}`, jsonPut(body));
			if (!response.ok) throw new Error(await errorMessage(response, 'Could not update marketplace item'));
			const result = await response.json() as { id: string; latestRevision: number };
			return { id: result.id, revision: result.latestRevision };
		}
		if (this.item && this.adapterId === 'cloud') body.source = { adapterId: 'cloud', itemId: this.item.id };
		else if (this.item && this.adapterId === 'world') body.source = { adapterId: 'world', itemId: this.item.id, worldId: this.context.worldId };
		else body.slotData = scene;
		const response = await fetch('/api/marketplace/items', jsonPost(body));
		if (!response.ok) throw new Error(await errorMessage(response, 'Could not publish marketplace item'));
		const result = await response.json() as { id: string; latestRevision: number };
		if (this.item && this.adapterId === 'local') await getInventoryAdapter('local')?.setMarketplaceItemId?.(this.context, this.item.id, result.id);
		if (this.item) this.item = { ...this.item, marketplaceItemId: result.id };
		return { id: result.id, revision: result.latestRevision };
	}

	/** Hides or re-shows an already-published marketplace listing without touching its content. */
	async setMarketplaceVisibility(status: 'published' | 'hidden'): Promise<void> {
		const id = this.item?.marketplaceItemId;
		if (!id) throw new Error('This object is not published yet.');
		const response = await fetch(`/api/marketplace/items/${id}`, jsonPut({ status }));
		if (!response.ok) throw new Error(await errorMessage(response, 'Could not change the listing visibility'));
	}

	// --- Publishing ------------------------------------------------------------

	private get publicationStorageKey(): string {
		return `studio:publication:${this.key}`;
	}

	get lastPublicationId(): string | null {
		try {
			return localStorage.getItem(this.publicationStorageKey);
		} catch {
			return null;
		}
	}

	async listMyPublications(userId: string): Promise<PublicationSummary[]> {
		const response = await fetch('/api/published-worlds');
		if (!response.ok) throw new Error(await errorMessage(response, 'Could not load your published worlds'));
		return ((await response.json()) as PublicationSummary[]).filter((publication) => publication.ownerId === userId);
	}

	/** Sends the models a scene uses to the cloud, reporting progress. Models already there cost nothing. */
	private async sendModels(scene: SlotTree): Promise<void> {
		try {
			await ensureCloudAssets(scene, getLocalAssetStore(), { onProgress: (progress) => (this.assetProgress = progress.done < progress.total ? progress : null) });
		} finally {
			this.assetProgress = null;
		}
	}

	/** Publishes the current tree. With `publicationId` it adds a new revision to that world. */
	async publish(publicationId?: string): Promise<PublishResult> {
		const scene = cloneTree(this.doc.tree);
		validateWorldScene(scene);
		await this.sendModels(scene);
		const response = publicationId
			? await fetch(`/api/published-worlds/${publicationId}/revisions`, jsonPost({ scene }))
			: await fetch('/api/published-worlds', jsonPost({ name: this.doc.name.trim(), scene }));
		if (!response.ok) throw new Error(await errorMessage(response, 'Could not publish this world'));
		const body = (await response.json()) as { id: string; latestRevision?: number; number?: number; name?: string };
		const id = publicationId ?? body.id;
		try {
			localStorage.setItem(this.publicationStorageKey, id);
		} catch {
			// Remembering the link is a convenience only.
		}
		return { id, revision: body.number ?? body.latestRevision ?? 1, name: body.name ?? this.doc.name };
	}
}

function jsonPut(body: unknown): RequestInit {
	return { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function jsonPost(body: unknown): RequestInit {
	return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
	try {
		const body = (await response.json()) as { message?: string };
		if (body.message) return body.message;
	} catch {
		// Not JSON; fall through.
	}
	return response.status === 401 ? 'Sign in to publish worlds.' : fallback;
}
