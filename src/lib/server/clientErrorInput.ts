import { createHash } from 'node:crypto';

export interface ClientErrorReport {
	level: 'error' | 'warn';
	message: string;
	stack: string | null;
	path: string;
	fingerprint: string;
	/** The device model the browser's client hints named, if it sent one. */
	model: string | null;
}

const MESSAGE_MAX = 1_500;
const STACK_MAX = 4_000;

/** Numbers, ids and hashes vary between occurrences of the same failure; without them the same failure groups together. */
const normalize = (text: string) =>
	text
		.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
		.replace(/\b[0-9a-f]{16,}\b/gi, '<hash>')
		.replace(/\d+/g, '<n>');

/** Drops what could identify a person from text the browser wrote: emails, and tokens in URLs. */
function scrub(text: string): string {
	return text
		.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
		.replace(/([?&#](?:token|ticket|key|code|secret|password)=)[^&\s)]+/gi, '$1<removed>');
}

/** The path of a page URL, with nothing after it (the query and hash can hold room codes and tokens). Null for anything else. */
function pathOf(url: unknown): string {
	if (typeof url !== 'string') return '/';
	try {
		const path = new URL(url, 'http://localhost').pathname;
		// Room codes and ids in a path are not needed to find a bug.
		return path.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '/<id>').replace(/^\/w\/[^/]+/, '/w/<room>').slice(0, 200);
	} catch {
		return '/';
	}
}

/** Reads what a browser sent; null if it is not a usable report. */
export function parseClientError(body: unknown): ClientErrorReport | null {
	if (!body || typeof body !== 'object') return null;
	const { level, message, stack, url, model } = body as Record<string, unknown>;
	if ((level !== 'error' && level !== 'warn') || typeof message !== 'string' || !message.trim()) return null;
	const cleanMessage = scrub(message).slice(0, MESSAGE_MAX);
	const cleanStack = typeof stack === 'string' && stack.trim() ? scrub(stack).slice(0, STACK_MAX) : null;
	const firstFrame = cleanStack?.split('\n').find((line) => /\bat\b|@/.test(line)) ?? '';
	const fingerprint = createHash('sha256')
		.update(`${level}\n${normalize(cleanMessage.split('\n')[0])}\n${normalize(firstFrame.replace(/\?[^\s)]*/g, ''))}`)
		.digest('hex')
		.slice(0, 32);
	return { level, message: cleanMessage, stack: cleanStack, path: pathOf(url), fingerprint, model: typeof model === 'string' && model.trim() ? model.trim().slice(0, 40) : null };
}
