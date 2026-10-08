/** Only same-site paths are valid post-login destinations (blocks open redirects). */
export function safeNext(value: string | null | undefined, fallback = '/home'): string {
	return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : fallback;
}
