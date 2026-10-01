// @wc-ignore-file
// Dialog defaults run outside a Svelte component and cannot use Wuchale runtime bindings.
export interface ConfirmRequest {
	kind: 'confirm';
	title: string;
	message?: string;
	confirmLabel: string;
	danger: boolean;
	resolve: (value: boolean) => void;
}

export interface PromptRequest {
	kind: 'prompt';
	title: string;
	message?: string;
	value: string;
	confirmLabel: string;
	resolve: (value: string | null) => void;
}

export interface ChoiceRequest {
	kind: 'choice';
	title: string;
	message?: string;
	choices: { id: string; label: string; danger?: boolean }[];
	resolve: (value: string | null) => void;
}

export type DialogRequest = ConfirmRequest | PromptRequest | ChoiceRequest;

class Dialogs {
	current = $state<DialogRequest | null>(null);

	confirm(options: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
		return new Promise((resolve) => {
			this.current = { kind: 'confirm', confirmLabel: 'Confirm', danger: false, ...options, resolve };
		});
	}

	prompt(options: { title: string; message?: string; value?: string; confirmLabel?: string }): Promise<string | null> {
		return new Promise((resolve) => {
			this.current = { kind: 'prompt', title: options.title, message: options.message, value: options.value ?? '', confirmLabel: options.confirmLabel ?? 'OK', resolve };
		});
	}

	/** Resolves with the chosen id, or null when dismissed. */
	choose(options: { title: string; message?: string; choices: ChoiceRequest['choices'] }): Promise<string | null> {
		return new Promise((resolve) => {
			this.current = { kind: 'choice', ...options, resolve };
		});
	}

	close(): void {
		this.current = null;
	}
}

export const dialogs = new Dialogs();
