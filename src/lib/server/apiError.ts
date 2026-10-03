import { error } from '@sveltejs/kit';
import { UnauthorizedError, ForbiddenError, NotFoundError, BadRequestError, PayloadTooLargeError, UnsupportedMediaError, MissingAssetsError, QuotaExceededError, ConflictError, TooManyRequestsError } from './errors';

/** Translates a service-layer error into the matching SvelteKit HTTP error. Rethrows anything else. */
export function toHttpError(err: unknown): never {
	if (err instanceof BadRequestError) error(400, err.message);
	if (err instanceof MissingAssetsError) error(409, { message: err.message, missing: err.missing });
	if (err instanceof QuotaExceededError) error(413, err.message || 'Your storage quota is full.');
	if (err instanceof PayloadTooLargeError) error(413, err.message || 'The file is too large.');
	if (err instanceof UnsupportedMediaError) error(415, err.message || 'Unsupported file type.');
	if (err instanceof ConflictError) error(409, err.message);
	if (err instanceof TooManyRequestsError) error(429, 'Too many requests');
	if (err instanceof UnauthorizedError) error(401, 'Unauthorized');
	if (err instanceof ForbiddenError) error(403, 'Forbidden');
	if (err instanceof NotFoundError) error(404, 'Not found');
	throw err;
}
