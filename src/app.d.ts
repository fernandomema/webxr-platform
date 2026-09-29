// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { auth } from '$lib/auth';

type Session = typeof auth.$Infer.Session;

declare global {
	namespace App {
		interface Error {
			message: string;
			/** Set on 409 when a scene references models that are not uploaded yet. */
			missing?: string[];
		}
		interface Locals {
			user: Session['user'] | null;
			session: Session['session'] | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
