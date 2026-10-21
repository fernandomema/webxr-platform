import type { PageServerLoad } from './$types';
import { listApps } from '$lib/server/services/apps';

export const load: PageServerLoad = async ({ locals }) => ({ apps: await listApps(locals.user) });
