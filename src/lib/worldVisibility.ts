export const WORLD_VISIBILITIES = ['solo', 'private', 'friends', 'friends-plus', 'public'] as const;
export type WorldVisibility = (typeof WORLD_VISIBILITIES)[number];
export type HostedWorldVisibility = Exclude<WorldVisibility, 'solo'>;

export const WORLD_VISIBILITY_INFO: Record<WorldVisibility, { label: string; description: string }> = {
	solo: {
		label: 'Only me',
		description: 'Local world. Nobody can join.'
	},
	private: {
		label: 'Private',
		description: 'Join with a room code.'
	},
	friends: {
		label: 'Friends only',
		description: 'Unavailable until friend relationships and access checks exist.'
	},
	'friends-plus': {
		label: 'Friends+',
		description: 'Unavailable until friend relationships and access checks exist.'
	},
	public: {
		label: 'Public',
		description: 'Hosted session. Anyone can find and join it.'
	}
};

export function isHostedWorldVisibility(value: unknown): value is HostedWorldVisibility {
	return value === 'private' || value === 'friends' || value === 'friends-plus' || value === 'public';
}
