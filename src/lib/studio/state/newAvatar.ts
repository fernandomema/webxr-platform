import type { SlotTree } from '$lib/ecs/types';

const key = (draft: string) => `studio:new-avatar:${draft}`;

/** Hands an avatar made by the wizard to the editor page that is about to open. */
export function handOverNewAvatar(draft: string, tree: SlotTree, name: string): void {
	sessionStorage.setItem(key(draft), JSON.stringify({ tree, name }));
}

/** Picks up (and forgets) what `handOverNewAvatar` left for this draft, if anything. */
export function takeNewAvatar(draft: string): { tree: SlotTree; name: string } | null {
	try {
		const raw = sessionStorage.getItem(key(draft));
		sessionStorage.removeItem(key(draft));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { tree?: SlotTree; name?: string };
		return Array.isArray(parsed.tree) && parsed.tree.length ? { tree: parsed.tree, name: parsed.name || 'Avatar' } : null;
	} catch {
		return null;
	}
}
