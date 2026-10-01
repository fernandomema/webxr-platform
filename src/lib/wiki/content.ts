import type { Component } from 'svelte';

export type WikiMeta = {
	title?: string;
	description?: string;
	/** Sort position inside its section (lower first). */
	order?: number;
	draft?: boolean;
};

type WikiModule = { default: Component; metadata?: WikiMeta };

const ROOT = '/src/content/wiki/';
const FALLBACK = 'en';

// Metadata is loaded eagerly (sidebar needs it); page bodies stay lazy.
const metas = import.meta.glob<WikiMeta | undefined>('/src/content/wiki/**/*.{md,mdx}', {
	eager: true,
	import: 'metadata'
});
const loaders = import.meta.glob<WikiModule>('/src/content/wiki/**/*.{md,mdx}');

const REPO_EDIT_URL = 'https://github.com/fernandomema/webxr-platform/edit/main';

/** GitHub edit URL for the page's source file (the English one when the locale falls back). */
export function editUrl(page: WikiPage): string {
	return `${REPO_EDIT_URL}${page.path}`;
}

export type WikiPage = { slug: string; section: string; meta: WikiMeta; path: string };

// Files live at src/content/wiki/<locale>/<slug>.md
function parse(path: string): { locale: string; slug: string } {
	const [locale, ...rest] = path.slice(ROOT.length).replace(/\.(md|mdx)$/, '').split('/');
	return { locale, slug: rest.join('/').replace(/(^|\/)index$/, '') };
}

/** Pages for a locale; slugs missing in it fall back to English. */
export function wikiPages(locale: string): WikiPage[] {
	const bySlug = new Map<string, WikiPage>();
	for (const wanted of [FALLBACK, locale]) {
		for (const [path, meta] of Object.entries(metas)) {
			const parsed = parse(path);
			if (parsed.locale !== wanted) continue;
			bySlug.set(parsed.slug, {
				slug: parsed.slug,
				section: parsed.slug.split('/').slice(0, -1).join('/'),
				meta: meta ?? {},
				path
			});
		}
	}
	return [...bySlug.values()]
		.filter((p) => !p.meta.draft)
		.sort((a, b) => (a.meta.order ?? 100) - (b.meta.order ?? 100) || a.slug.localeCompare(b.slug));
}

export function pageTitle(page: WikiPage): string {
	return page.meta.title ?? (page.slug.split('/').pop() || 'Home');
}

/** Sidebar order of the folders; any folder not listed goes after these, in page order. The root section ('') always comes first. */
const SECTION_ORDER = ['', 'getting-started', 'avatars', 'inspector', 'contributing'];

export type WikiSection = { name: string; pages: WikiPage[] };

/** Top-level pages first (section ''), then one group per folder. */
export function wikiSections(pages: WikiPage[]): WikiSection[] {
	const groups = new Map<string, WikiPage[]>();
	for (const page of pages) {
		const key = page.slug.includes('/') ? page.slug.split('/')[0] : '';
		groups.set(key, [...(groups.get(key) ?? []), page]);
	}
	const rank = (name: string) => (SECTION_ORDER.includes(name) ? SECTION_ORDER.indexOf(name) : SECTION_ORDER.length);
	return [...groups]
		.map(([name, list]) => ({ name, pages: list }))
		.sort((a, b) => rank(a.name) - rank(b.name));
}

export async function loadWikiPage(page: WikiPage): Promise<Component> {
	return (await loaders[page.path]()).default;
}
