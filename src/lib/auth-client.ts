import { createAuthClient } from 'better-auth/svelte';
import { adminClient, deviceAuthorizationClient, usernameClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	plugins: [usernameClient(), adminClient(), deviceAuthorizationClient()]
});
