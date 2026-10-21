/**
 * Names of the controls, for texts that tell someone what to press. A text written `Press {dash} → Worlds` shows the key that opens the
 * menu on a computer and the button of the controller in a headset: the same words, with the control of the device in hand.
 * Controls are pictures (`[[name]]`, see richText.ts), drawn from the Kenney Input Prompts pack (static/assets/inputs, CC0), with a
 * word to say in places that cannot draw them. An unknown `{name}` is left as it is.
 */
export type InputDevice = 'desktop' | 'xr';
type Languages = Record<string, string>;

const key = (name: string) => `[[keyboard_${name}]]`;

const HINTS: Record<string, Record<InputDevice, Languages>> = {
	/** Open the Dash. */
	dash: { desktop: { en: key('tab'), es: key('tab') }, xr: { en: '[[quest_button_menu]]', es: '[[quest_button_menu]]' } },
	/** Walk. */
	move: { desktop: { en: `${key('w')}${key('a')}${key('s')}${key('d')}`, es: `${key('w')}${key('a')}${key('s')}${key('d')}` }, xr: { en: '[[quest_stick_l]]', es: '[[quest_stick_l]]' } },
	/** Look around. */
	turn: { desktop: { en: '[[mouse_move]]', es: '[[mouse_move]]' }, xr: { en: '[[quest_stick_r]]', es: '[[quest_stick_r]]' } },
	/** Use what you point at (a verb phrase: "point at it and {use}"). */
	use: { desktop: { en: 'click [[mouse_left]]', es: 'haz clic [[mouse_left]]' }, xr: { en: 'pull [[quest_trigger_right]]', es: 'aprieta [[quest_trigger_right]]' } },
	/** Pick something up. */
	grab: { desktop: { en: `press ${key('e')}`, es: `pulsa ${key('e')}` }, xr: { en: 'squeeze [[quest_grip_right]]', es: 'aprieta [[quest_grip_right]]' } },
	/** Let go of what you hold. */
	drop: { desktop: { en: `press ${key('q')}`, es: `pulsa ${key('q')}` }, xr: { en: 'let go of [[quest_grip_right]]', es: 'suelta [[quest_grip_right]]' } }
};

/** What a picture is called in words, for a place that cannot show it (a button's label). */
const ICON_WORDS: Record<string, string> = {
	keyboard_tab: 'Tab', keyboard_e: 'E', keyboard_q: 'Q', keyboard_w: 'W', keyboard_a: 'A', keyboard_s: 'S', keyboard_d: 'D', keyboard_shift: 'Shift', keyboard_space: 'Space',
	mouse_left: 'left click', mouse_move: 'mouse', quest_button_menu: 'menu button', quest_trigger_right: 'trigger', quest_grip_right: 'grip', quest_stick_l: 'left stick', quest_stick_r: 'right stick'
};

/** The names of every picture a hint can draw: each is a file in static/assets/inputs. */
export const INPUT_ICON_NAMES: readonly string[] = Object.keys(ICON_WORDS);
export const inputIconUrl = (name: string): string => `/assets/inputs/${name}.png`;

/** A text with its pictures written as words, for elements that cannot draw them. */
export function iconsAsWords(text: string): string {
	return text.replace(/\[\[([a-z0-9_]+)\]\]/g, (whole, name: string) => (ICON_WORDS[name] ? `[${ICON_WORDS[name]}]` : whole));
}

export const INPUT_HINT_NAMES: readonly string[] = Object.keys(HINTS);

/** The text of a hint for a device and language: English when the language has none. */
export function inputHint(name: string, device: InputDevice, locale: string): string | undefined {
	const languages = HINTS[name]?.[device];
	return languages?.[locale] ?? languages?.en;
}

export function resolveInputHints(text: string, locale: string, device: InputDevice): string {
	if (!text.includes('{')) return text;
	return text.replace(/\{([a-z]+)\}/g, (whole, name: string) => inputHint(name, device, locale) ?? whole);
}
