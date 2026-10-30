import type { TransformNode } from '@babylonjs/core';
import { Button, Control, InputText, Rectangle, TextBlock } from '@babylonjs/gui';
import { createFriendsApi, formatFriendCode, FriendsError, looksLikeFriendCode, type FriendPerson, type FriendsOverview } from '../platform/friends.ts';
import { typeWithKeyboard } from '../keyboard/guiInput.ts';
import type { DashTab } from './dashPanel.ts';
import { createCard, createScrollColumn, placeText, spacer } from './layout.ts';
import { THEME } from './theme.ts';

/** How often the lists are asked for again while the tab is open: friends come and go, and there is no push channel. */
export const FRIENDS_POLL_MS = 15_000;

export interface FriendsTabOptions {
	/** The node the in-world keyboard appears next to. */
	near: () => TransformNode | null;
	onJoinWorld(roomCode: string): Promise<void>;
	api?: ReturnType<typeof createFriendsApi>;
}

/** The dash's Friends tab: add people, answer requests, see who is playing and join them. */
export function createFriendsTab(options: FriendsTabOptions): DashTab {
	const api = options.api ?? createFriendsApi();
	let page: Rectangle;
	let column: ReturnType<typeof createScrollColumn>;
	let overview: FriendsOverview | null = null;
	let signedOut = false;
	let myCode: string | null = null;
	let suggestions: FriendPerson[] | null = null;
	let notice = { text: '', tone: 'info' as 'info' | 'error' };
	let busy = false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let draft = '';
	let removing: string | null = null;
	let input: InputText | null = null;

	function button(name: string, label: string, background: string, width: number, run: () => void): Button {
		const control = Button.CreateSimpleButton(name, label);
		control.width = `${width}px`; control.height = '46px';
		control.color = THEME.text; control.fontSize = 18; control.background = background;
		control.cornerRadius = 10; control.thickness = 0;
		control.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
		control.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
		control.onPointerClickObservable.add(run);
		return control;
	}

	function label(parent: Rectangle, name: string, value: string, left: number, top: number, width: number, height: number, size: number, color: string): TextBlock {
		const block = new TextBlock(name, value);
		block.fontSize = size; block.color = color;
		placeText(parent, block, left, top, width, height);
		return block;
	}

	function heading(title: string): TextBlock {
		const block = new TextBlock(`friends-heading-${title}`, title);
		block.width = `${column.width}px`; block.height = '52px'; block.paddingTop = '14px';
		block.fontSize = 22; block.fontWeight = 'bold'; block.color = THEME.text;
		block.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		return block;
	}

	function say(text: string, tone: 'info' | 'error' = 'info') {
		notice = { text, tone };
		render();
	}

	/** Runs one action, then refreshes what it changed; its failure becomes the notice. */
	async function act(run: () => Promise<unknown>, done = '') {
		if (busy) return;
		busy = true;
		try {
			const result = await run();
			notice = { text: typeof result === 'string' ? result : done, tone: 'info' };
		} catch (error) {
			notice = { text: error instanceof Error ? error.message : 'Something went wrong', tone: 'error' };
		} finally {
			busy = false;
		}
		await refresh();
	}

	async function add(value: string) {
		const text = value.trim().replace(/^@/, '');
		if (!text) return;
		await act(async () => {
			let result;
			try {
				result = await (looksLikeFriendCode(text) ? api.sendRequest({ code: text }) : api.sendRequest({ username: text }));
			} catch (error) {
				// A code that is not one may be a username that happens to look like it.
				if (!(looksLikeFriendCode(text) && error instanceof FriendsError && error.status === 404)) throw error;
				result = await api.sendRequest({ username: text });
			}
			draft = '';
			if (input) input.text = '';
			return result.status === 'friends' ? 'You are friends now' : 'Request sent';
		});
	}

	function personCard(name: string, person: FriendPerson, subtitle: string, subtitleColor: string, actions: Array<{ label: string; color: string; width: number; run: () => void }>): Rectangle {
		const card = createCard(name, column.width, 82);
		label(card, `${name}-name`, person.name, 22, 10, 380, 30, 22, THEME.text).fontWeight = 'bold';
		label(card, `${name}-sub`, subtitle, 22, 44, 380, 26, 16, subtitleColor);
		let right = 14;
		for (const action of actions) {
			const control = button(`${name}-${action.label}`, action.label, action.color, action.width, action.run);
			control.left = `-${right}px`;
			card.addControl(control);
			right += action.width + 10;
		}
		return card;
	}

	function render() {
		if (!page) return;
		const list = column.list;
		list.clearControls();
		if (signedOut) {
			list.addControl(heading('Friends'));
			const card = createCard('friends-signed-out', column.width, 90);
			label(card, 'friends-signed-out-text', 'Sign in (Account tab) to add friends and see who is playing.', 24, 28, column.width - 48, 40, 20, THEME.muted);
			list.addControl(card);
			return;
		}

		if (notice.text) {
			const line = new TextBlock('friends-notice', notice.text);
			line.width = `${column.width}px`; line.height = '36px'; line.fontSize = 18;
			line.color = notice.tone === 'error' ? THEME.error : THEME.glow;
			line.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			list.addControl(line);
		}

		list.addControl(heading('Add a friend'));
		const addCard = createCard('friends-add', column.width, 130);
		input = new InputText('friends-add-input');
		input.width = `${column.width - 200}px`; input.height = '48px'; input.fontSize = 20;
		input.color = THEME.text; input.background = THEME.ink; input.focusedBackground = THEME.accentSoft; input.thickness = 1;
		input.placeholderText = 'Username or friend code'; input.placeholderColor = THEME.muted;
		input.text = draft;
		input.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
		input.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		input.left = '18px'; input.top = '14px';
		input.onTextChangedObservable.add(() => { draft = input?.text ?? ''; });
		typeWithKeyboard(input, { near: options.near, title: 'Username or friend code', onSubmit: (text) => void add(text) });
		addCard.addControl(input);
		const send = button('friends-add-send', 'Send request', THEME.accentSoft, 150, () => void add(draft));
		send.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP; send.top = '13px'; send.left = '-16px';
		addCard.addControl(send);
		label(addCard, 'friends-code', myCode ? `Your friend code: ${formatFriendCode(myCode)}` : 'Your friend code…', 22, 82, column.width - 250, 28, 18, THEME.muted);
		const renew = button('friends-code-new', 'New code', THEME.surfaceHover, 150, () => void act(async () => { myCode = (await api.newCode()).code; }, 'Your old code no longer works'));
		renew.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP; renew.top = '75px'; renew.left = '-16px';
		addCard.addControl(renew);
		list.addControl(addCard);

		if (api.canFindPlatformFriends()) {
			const find = createCard('friends-meta', column.width, 82);
			label(find, 'friends-meta-title', 'Meta Quest friends', 22, 10, 420, 30, 22, THEME.text).fontWeight = 'bold';
			label(find, 'friends-meta-sub', 'Find friends from your headset who also play here.', 22, 44, 520, 26, 16, THEME.muted);
			const search = button('friends-meta-find', suggestions ? 'Search again' : 'Find friends', THEME.accentSoft, 190, () => void act(async () => { suggestions = await api.findQuestFriends(); }));
			search.left = '-14px';
			find.addControl(search);
			list.addControl(find);
			for (const suggestion of suggestions ?? []) {
				list.addControl(personCard(`friends-suggestion-${suggestion.id}`, suggestion, `@${suggestion.username}`, THEME.muted, [
					{ label: 'Add', color: THEME.accentSoft, width: 110, run: () => void act(async () => { await api.sendRequest({ username: suggestion.username! }); suggestions = (suggestions ?? []).filter((other) => other.id !== suggestion.id); }, 'Request sent') }
				]));
			}
			if (suggestions && suggestions.length === 0) {
				const none = new TextBlock('friends-meta-none', 'None of your Meta friends are here yet.');
				none.width = `${column.width}px`; none.height = '34px'; none.fontSize = 17; none.color = THEME.muted;
				none.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
				list.addControl(none);
			}
		}

		const data = overview;
		if (!data) {
			const loading = new TextBlock('friends-loading', 'Loading…');
			loading.height = '40px'; loading.fontSize = 18; loading.color = THEME.muted;
			list.addControl(loading);
			return;
		}

		if (data.incoming.length > 0) {
			list.addControl(heading(`Requests (${data.incoming.length})`));
			for (const request of data.incoming) {
				list.addControl(personCard(`friends-request-${request.id}`, request.from, request.from.username ? `@${request.from.username}` : '', THEME.muted, [
					{ label: 'Accept', color: THEME.go, width: 120, run: () => void act(() => api.accept(request.id), `You and ${request.from.name} are friends`) },
					{ label: 'Decline', color: THEME.surfaceHover, width: 120, run: () => void act(() => api.decline(request.id)) }
				]));
			}
		}

		list.addControl(heading(`Friends (${data.friends.length})`));
		if (data.friends.length === 0) {
			const empty = createCard('friends-empty', column.width, 70);
			label(empty, 'friends-empty-text', 'No friends yet. Send a request with a username or share your code.', 22, 22, column.width - 44, 30, 18, THEME.muted);
			list.addControl(empty);
		}
		for (const friend of data.friends) {
			const actions: Array<{ label: string; color: string; width: number; run: () => void }> = [];
			if (friend.session) {
				const roomCode = friend.session.roomCode;
				actions.push({ label: 'Join', color: THEME.go, width: 100, run: () => void act(() => options.onJoinWorld(roomCode)) });
			}
			const confirming = removing === friend.id;
			actions.push({
				label: confirming ? 'Sure?' : 'Remove', color: confirming ? THEME.error : THEME.surfaceHover, width: 110,
				run: () => {
					if (!confirming) { removing = friend.id; render(); return; }
					removing = null;
					void act(() => api.remove(friend.id), `${friend.name} was removed`);
				}
			});
			list.addControl(personCard(`friends-friend-${friend.id}`, friend, friend.session ? `Playing ${friend.session.worldName}` : 'Not in a session', friend.session ? THEME.mint : THEME.muted, actions));
		}

		if (data.outgoing.length > 0) {
			list.addControl(heading('Sent requests'));
			for (const request of data.outgoing) {
				list.addControl(personCard(`friends-sent-${request.id}`, request.to, 'Waiting for an answer', THEME.muted, [
					{ label: 'Cancel', color: THEME.surfaceHover, width: 110, run: () => void act(() => api.cancel(request.id)) }
				]));
			}
		}
		list.addControl(spacer('friends-end', 20));
	}

	async function refresh() {
		try {
			overview = await api.overview();
			signedOut = false;
			myCode ??= (await api.myCode().catch(() => null))?.code ?? null;
		} catch (error) {
			if (error instanceof FriendsError && error.status === 401) signedOut = true;
			else if (!overview) notice = { text: error instanceof Error ? error.message : 'Could not load friends', tone: 'error' };
		}
		render();
	}

	return {
		id: 'friends',
		label: 'Friends',
		icon: 'users',
		order: 15,
		build(content) {
			page = content;
			column = createScrollColumn('friends');
			page.addControl(column.scroll);
			render();
		},
		onShow() {
			removing = null;
			void refresh();
			timer ??= setInterval(() => void refresh(), FRIENDS_POLL_MS);
		},
		onHide() {
			if (timer) clearInterval(timer);
			timer = null;
		}
	};
}
