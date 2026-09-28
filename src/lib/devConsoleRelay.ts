/**
 * Forwards console.warn/error and uncaught errors/rejections to the dev
 * server (/api/debug/log) so they can be read in the terminal — reading a
 * real devtools console on a VR headset is impractical. Dev-only; never
 * imported from production code paths (see +layout.svelte's DEV guard).
 */

function serialize(arg: unknown): string {
	if (arg instanceof Error) return `${arg.message}\n${arg.stack ?? ''}`;
	if (typeof arg === 'object' && arg !== null) {
		try {
			return JSON.stringify(arg);
		} catch {
			return String(arg);
		}
	}
	return String(arg);
}

function send(level: 'warn' | 'error', args: unknown[]): void {
	fetch('/api/debug/log', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			level,
			message: args.map(serialize).join(' '),
			url: location.href
		}),
		keepalive: true
	}).catch(() => {});
}

export function initDevConsoleRelay(): void {
	const originalWarn = console.warn.bind(console);
	const originalError = console.error.bind(console);

	console.warn = (...args: unknown[]) => {
		originalWarn(...args);
		send('warn', args);
	};
	console.error = (...args: unknown[]) => {
		originalError(...args);
		send('error', args);
	};

	window.addEventListener('error', (e) => send('error', [e.error ?? e.message]));
	window.addEventListener('unhandledrejection', (e) => send('error', [e.reason]));
}
