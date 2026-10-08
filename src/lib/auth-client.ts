import { createAuthClient } from 'better-auth/svelte';
import { adminClient, usernameClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	plugins: [usernameClient(), adminClient()]
});
