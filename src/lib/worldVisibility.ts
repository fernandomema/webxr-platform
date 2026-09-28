export const WORLD_VISIBILITIES = ['solo', 'friends', 'friends-plus', 'public'] as const;
export type WorldVisibility = (typeof WORLD_VISIBILITIES)[number];
export type HostedWorldVisibility = Exclude<WorldVisibility, 'solo'>;

export const WORLD_VISIBILITY_INFO: Record<WorldVisibility, { label: string; description: string }> = {
	solo: {
		label: 'Only me',
		description: 'Local world. Nobody can join.'
	},
	friends: {
		label: 'Friends only',
		description: 'Hosted session. Only your friends can join.'
	},
	'friends-plus': {
		label: 'Friends+',
		description: 'Hosted session. Friends of your friends can also join.'
	},
	public: {
		label: 'Public',
		description: 'Hosted session. Anyone can find and join it.'
	}
};

export function isHostedWorldVisibility(value: unknown): value is HostedWorldVisibility {
	return value === 'friends' || value === 'friends-plus' || value === 'public';
}
