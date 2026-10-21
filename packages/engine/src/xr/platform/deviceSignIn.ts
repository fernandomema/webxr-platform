import { getPlatformConfig, platformFetch } from './config.ts';

/** A sign-in with a code in progress (RFC 8628): the player types `userCode` on the platform's own site, on any device. */
export interface DeviceSignIn {
	userCode: string;
	/** Where to type it, without the code (`https://kithin.example/device`). */
	verificationUri: string;
	/** The same page with the code filled in, for a link or a QR code. */
	verificationUriComplete: string;
	/** Settles when the player approved (the token is stored), refused, or ran out of time, or `cancel` was called. */
	done: Promise<'approved' | 'denied' | 'expired' | 'cancelled'>;
	cancel(): void;
}

interface CodeAnswer {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	expires_in: number;
	interval: number;
}

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const json = { 'content-type': 'application/json' };

/** Asks the platform for a code and waits, in the background, for someone to approve it. Needs `setToken` (see `useStoredToken`). */
export async function startDeviceSignIn(): Promise<DeviceSignIn> {
	const { setToken, appId } = getPlatformConfig();
	const clientId = appId ?? 'kithin-engine';
	if (!setToken) throw new Error('This game is not set up to keep a sign-in token');
	const response = await platformFetch('/api/auth/device/code', { method: 'POST', headers: json, body: JSON.stringify({ client_id: clientId }) });
	if (!response.ok) throw new Error('Could not ask for a code');
	const code = (await response.json()) as CodeAnswer;

	let cancelled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let wake: (() => void) | undefined;
	const wait = (ms: number) => new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, ms); });

	const done = (async (): Promise<'approved' | 'denied' | 'expired' | 'cancelled'> => {
		let interval = Math.max(code.interval, 1) * 1000;
		const deadline = Date.now() + code.expires_in * 1000;
		while (!cancelled && Date.now() < deadline) {
			await wait(interval);
			if (cancelled) break;
			const answer = await platformFetch('/api/auth/device/token', {
				method: 'POST',
				headers: json,
				body: JSON.stringify({ grant_type: GRANT, device_code: code.device_code, client_id: clientId })
			}).catch(() => null);
			if (!answer) continue; // offline for a moment: keep trying until the code expires
			const body = (await answer.json().catch(() => ({}))) as { access_token?: string; error?: string };
			if (answer.ok && body.access_token) {
				setToken(body.access_token);
				return 'approved';
			}
			if (body.error === 'slow_down') interval += 5000;
			else if (body.error === 'access_denied') return 'denied';
			else if (body.error === 'expired_token') return 'expired';
			// 'authorization_pending' (and anything unexpected): ask again.
		}
		return cancelled ? 'cancelled' : 'expired';
	})();

	return {
		userCode: code.user_code,
		verificationUri: code.verification_uri,
		verificationUriComplete: code.verification_uri_complete,
		done,
		cancel() {
			cancelled = true;
			clearTimeout(timer);
			wake?.();
		}
	};
}
