import { error } from '@sveltejs/kit';
import { loadWikiPage } from '$lib/wiki/content';

export const load = async ({ params, parent }) => {
	const { pages } = await parent();
	const slug = (params.slug ?? '').replace(/\/+$/, '');
	const index = pages.findIndex((p) => p.slug === slug);
	if (index < 0) error(404, 'Wiki page not found');
	return {
		page: pages[index],
		prev: pages[index - 1] ?? null,
		next: pages[index + 1] ?? null,
		content: await loadWikiPage(pages[index])
	};
};
