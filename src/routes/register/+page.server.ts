import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ discordEnabled: Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) });
