/** True in a standalone headset's browser (Quest), whose audio thread is much weaker than a desktop's. */
export const HEADSET_BROWSER = typeof navigator !== 'undefined' && /OculusBrowser|Quest/i.test(navigator.userAgent);

/**
 * How a sound placed in the world is panned. HRTF is the better 3D sound but costly: a headset's browser cannot keep up with a few
 * of them and the sound crackles and cuts, so there it pans left and right only.
 */
export function preferredPanningModel(): PanningModelType {
	return HEADSET_BROWSER ? 'equalpower' : 'HRTF';
}
