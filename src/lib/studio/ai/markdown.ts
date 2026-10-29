/**
 * A tiny, safe subset of Markdown for the assistant's replies: paragraphs, bullet lists, **bold** and `code`. It produces
 * plain data for the template to render, never HTML, so a reply can not inject markup.
 */
export type Inline = { kind: 'text' | 'bold' | 'code'; value: string };
export type Block = { type: 'p'; inline: Inline[] } | { type: 'ul'; items: Inline[][] };

export function parseInline(text: string): Inline[] {
	const result: Inline[] = [];
	const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index > last) result.push({ kind: 'text', value: text.slice(last, match.index) });
		result.push(match[1] !== undefined ? { kind: 'bold', value: match[1] } : { kind: 'code', value: match[2] });
		last = match.index + match[0].length;
	}
	if (last < text.length) result.push({ kind: 'text', value: text.slice(last) });
	return result;
}

export function parseBlocks(text: string): Block[] {
	const blocks: Block[] = [];
	let paragraph: string[] = [];
	let list: Inline[][] | null = null;
	const flushParagraph = () => { if (paragraph.length) blocks.push({ type: 'p', inline: parseInline(paragraph.join(' ')) }); paragraph = []; };
	const flushList = () => { if (list) blocks.push({ type: 'ul', items: list }); list = null; };
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		const bullet = /^[-*•]\s+(.*)$/.exec(line);
		if (bullet) { flushParagraph(); (list ??= []).push(parseInline(bullet[1])); }
		else if (!line) { flushParagraph(); flushList(); }
		else { flushList(); paragraph.push(line); }
	}
	flushParagraph(); flushList();
	return blocks;
}
