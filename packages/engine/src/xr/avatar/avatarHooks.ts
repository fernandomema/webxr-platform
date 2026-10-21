import type { AvatarSystem } from './avatarSystem.ts';
import type { PlayerAvatars } from './playerAvatars.ts';

/** What the network layer needs from the avatar system: poses in, and (on the host) who owns which avatar. */
export interface AvatarHooks {
	system: AvatarSystem;
	/** Only the host (or a solo player) manages avatar slots; guests receive them in snapshots. */
	players?: PlayerAvatars;
}
