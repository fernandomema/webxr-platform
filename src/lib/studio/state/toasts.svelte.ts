export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
}

class Toasts {
	items = $state<Toast[]>([]);
	private next = 1;

	push(kind: ToastKind, message: string, ms = kind === 'error' ? 7000 : 3500): void {
		const id = this.next++;
		this.items = [...this.items, { id, kind, message }];
		setTimeout(() => this.dismiss(id), ms);
	}

	info(message: string): void {
		this.push('info', message);
	}

	success(message: string): void {
		this.push('success', message);
	}

	error(error: unknown, fallback = 'Something went wrong'): void {
		this.push('error', error instanceof Error && error.message ? error.message : fallback);
	}

	dismiss(id: number): void {
		this.items = this.items.filter((toast) => toast.id !== id);
	}
}

export const toasts = new Toasts();
