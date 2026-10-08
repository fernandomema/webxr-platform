import type { RequestHandler } from './$types';
import { exportAccountData } from '$lib/server/services/accountExport';
import { toHttpError } from '$lib/server/apiError';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		const data = await exportAccountData(locals.user);
		return new Response(JSON.stringify(data, null, 2), {
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="kithin-data-${new Date().toISOString().slice(0, 10)}.json"`,
				'cache-control': 'no-store'
			}
		});
	} catch (err) {
		toHttpError(err);
	}
};
