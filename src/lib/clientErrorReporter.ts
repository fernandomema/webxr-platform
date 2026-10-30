/**
 * Production counterpart of devConsoleRelay.ts: sends the errors a player's browser hits (console.error, uncaught errors and rejections)
 * and the engine's connection warnings (`[net]`) to /api/client-errors, where the admin can read them. Nothing is sent when the player
 * has switched "Share error reports" off (Settings), which is read on every send so that a change applies at once. Only text the page
 * itself wrote goes out: no page content, and the URL is cut to its path on the server.
 */

const SETTINGS_KEY = 'webxr-platform-settings';
/** Per page load: a page stuck in a loop sends a few reports, not thousands. */
const MAX_REPORTS = 25;
const MAX_FIELD = 4_000;

const enabled = (): boolean => {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		return !raw || (JSON.parse(raw) as { shareErrorReports?: unknown }).shareErrorReports !== false;
	} catch {
		return true;
	}
};

function describe(arg: unknown): { message: string; stack?: string } {
	if (arg instanceof Error) return { message: `${arg.name}: ${arg.message}`, stack: arg.stack };
	if (typeof arg === 'object' && arg !== null) {
		try { return { message: JSON.stringify(arg) }; } catch { return { message: String(arg) }; }
	}
	return { message: String(arg) };
}

/** The device model the browser is willing to name (Chromium's client hints; the Quest browser may), once known. */
let hintedModel: string | undefined;
function learnModel(): void {
	const data = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(hints: string[]): Promise<{ model?: string }> } }).userAgentData;
	void data?.getHighEntropyValues(['model']).then((values) => { hintedModel = values.model || undefined; }).catch(() => {});
}

export function initClientErrorReporter(): void {
	learnModel();
	let sent = 0;
	const seen = new Set<string>();
	let reporting = false;

	function report(level: 'error' | 'warn', args: unknown[]): void {
		if (reporting || sent >= MAX_REPORTS || !enabled()) return;
		const parts = args.map(describe);
		const message = parts.map((part) => part.message).join(' ').slice(0, MAX_FIELD);
		const key = level + message.slice(0, 200);
		if (!message.trim() || seen.has(key)) return;
		seen.add(key);
		sent++;
		reporting = true;
		try {
			void fetch('/api/client-errors', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ level, message, stack: parts.find((part) => part.stack)?.stack?.slice(0, MAX_FIELD), url: location.href, model: hintedModel }),
				keepalive: true
			}).catch(() => {});
		} finally {
			reporting = false;
		}
	}

	const originalError = console.error.bind(console);
	const originalWarn = console.warn.bind(console);
	console.error = (...args: unknown[]) => {
		originalError(...args);
		report('error', args);
	};
	console.warn = (...args: unknown[]) => {
		originalWarn(...args);
		// Only the engine's connection warnings: other warnings are too noisy to be worth a row.
		if (typeof args[0] === 'string' && args[0].startsWith('[net]')) report('warn', args);
	};
	window.addEventListener('error', (event) => report('error', [event.error ?? event.message]));
	window.addEventListener('unhandledrejection', (event) => report('error', [event.reason]));
}
