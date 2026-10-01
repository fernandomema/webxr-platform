import { getLocale } from '$lib/server/locale';

export const load = ({ request }) => ({ locale: getLocale(request) });
