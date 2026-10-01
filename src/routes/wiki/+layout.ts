import { wikiPages, wikiSections } from '$lib/wiki/content';

export const load = ({ data }) => {
	const sections = wikiSections(wikiPages(data.locale));
	// Flat list in sidebar order, so prev/next follow what the reader sees.
	return { sections, pages: sections.flatMap((s) => s.pages) };
};
