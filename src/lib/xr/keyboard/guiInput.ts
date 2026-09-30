import type { TransformNode } from '@babylonjs/core';
import type { InputText } from '@babylonjs/gui';
import { requestTextInput, type TextInputRequest } from './service';

/**
 * Makes a GUI text field type with the in-world keyboard: focusing it in a headset brings the keyboard up next to
 * `near`, and what is typed there shows in the field as it is typed. Outside a headset nothing changes (the field takes
 * a real keyboard as before).
 */
export function typeWithKeyboard(
	input: InputText,
	options: { near: () => TransformNode | null; title?: string; secret?: boolean; onSubmit?(text: string): void }
): void {
	input.disableMobilePrompt = true;
	input.onFocusObservable.add(() => {
		const request: TextInputRequest = {
			title: options.title,
			initial: input.text,
			placeholder: input.placeholderText,
			secret: options.secret,
			near: options.near()
		};
		requestTextInput(request, {
			onChange: (text) => {
				input.text = text;
			},
			onSubmit: (text) => {
				input.text = text;
				input.blur();
				options.onSubmit?.(text);
			},
			onClose: () => input.blur()
		});
	});
}
