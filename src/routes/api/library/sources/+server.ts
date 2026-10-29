import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLibrary } from '$lib/server/library/registry';

export const GET: RequestHandler = () => json({ sources: getLibrary().sources() }, { headers: { 'cache-control': 'private, max-age=300' } });
