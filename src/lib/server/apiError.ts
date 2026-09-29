import { error } from '@sveltejs/kit';
import { UnauthorizedError, ForbiddenError, NotFoundError, BadRequestError } from './errors';

/** Translates a service-layer error into the matching SvelteKit HTTP error. Rethrows anything else. */
export function toHttpError(err: unknown): never {
	if (err instanceof BadRequestError) error(400, err.message);
	if (err instanceof UnauthorizedError) error(401, 'Unauthorized');
	if (err instanceof ForbiddenError) error(403, 'Forbidden');
	if (err instanceof NotFoundError) error(404, 'Not found');
	throw err;
}
