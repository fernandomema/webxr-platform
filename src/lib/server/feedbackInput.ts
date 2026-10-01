export const FEEDBACK_MOODS = ['loving', 'good', 'meh', 'needs-work'] as const;
export const FEEDBACK_STATUSES = ['pending', 'planned', 'progress', 'shipped'] as const;
export type FeedbackAction =
	| { action: 'suggest'; category: string; title: string; titleKey: string }
	| { action: 'vote'; id: string; delta: number }
	| { action: 'mood'; key: string };

export function parseFeedbackAction(body: unknown): FeedbackAction {
	if (!body || typeof body !== 'object') throw new Error('Invalid feedback request');
	const value = body as Record<string, unknown>;
	if (value.action === 'suggest' && ['idea', 'bug', 'other'].includes(String(value.category)) && typeof value.title === 'string') {
		const title = value.title.trim().replace(/\s+/g, ' ');
		if (title.length < 4 || title.length > 80) throw new Error('Feedback must contain between 4 and 80 characters');
		return { action: 'suggest', category: String(value.category), title, titleKey: title.toLowerCase() };
	}
	if (value.action === 'vote' && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 100 && (value.delta === 1 || value.delta === -1)) {
		return { action: 'vote', id: value.id, delta: value.delta };
	}
	if (value.action === 'mood' && FEEDBACK_MOODS.includes(value.key as typeof FEEDBACK_MOODS[number])) return { action: 'mood', key: String(value.key) };
	throw new Error('Invalid feedback request');
}
