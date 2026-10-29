export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}
export class BadRequestError extends Error {}
export class PayloadTooLargeError extends Error {}
export class UnsupportedMediaError extends Error {}
/** A scene references models that are not (fully) uploaded; `missing` lists their ids. */
export class MissingAssetsError extends Error {
	constructor(readonly missing: string[]) {
		super(`This scene uses ${missing.length} model${missing.length === 1 ? '' : 's'} that ${missing.length === 1 ? 'is' : 'are'} not in the cloud yet.`);
	}
}
export class QuotaExceededError extends Error {}
/** A rule on the stored data did not hold (stale version, not enough to spend). */
export class ConflictError extends Error {}
export class TooManyRequestsError extends Error {}
/** A credits rule stopped a charge. `code` lets the client say why: 'insufficient' | 'owned' | 'limit' | 'balance-cap' | 'price-changed'. */
export class CreditError extends ConflictError {
	constructor(readonly code: 'insufficient' | 'owned' | 'limit' | 'balance-cap' | 'price-changed', message: string) {
		super(message);
	}
}
/** A platform AI run used up its fixed budget (calls or tokens). */
export class AiBudgetError extends Error {}
