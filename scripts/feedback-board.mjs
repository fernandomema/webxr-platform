// The feedback screens of Pulse: what each is made of (its UI slots) and what it does (its codeBlock script).
//   - a voting board: ranked entries with an up and a down vote button each (ideas, bugs);
//   - the suggestion box: a category, a line of text and a Send button that adds an entry to a board;
//   - the mood wall: four buttons and a live tally of how players feel;
//   - the roadmap: a read-only list of what is planned, in progress and shipped.
//
// The entries of a board live in its `scriptState` component (`{ items: [{ id, title, detail, votes }] }`) and its
// script only draws them. That keeps one place to feed from later (a server, the world's saved data): whatever writes
// `items` there is what the screen shows. For now the entries are samples, and votes and suggestions live in the world
// only (there is no per-player vote limit and nothing is sent anywhere).
//
// Every builder takes the `slot` function of `createWorld()` (see world-kit.mjs) and adds its slots to that world.

/** Design size of a panel in UI pixels; the panel's width in the world follows from `worldWidth`. */
const BOARD_PIXELS = { width: 1200, height: 900 };
const BOARD_ROWS = 5;

const PALETTE = {
	panel: '#0b1224',
	row: '#172036',
	text: '#f8fafc',
	muted: '#94a3b8',
	up: '#10b981',
	down: '#f43f5e',
	neutral: '#475569',
	active: '#0d9488'
};

const IDENTITY = [0, 0, 0, 1];

/** A UI control: a slot with a `uiElement` component. */
const control = (slot, id, name, parentId, element, margin = 0) =>
	slot(id, name, parentId, { components: [{ type: 'uiElement', ...element, ...(margin ? { margin } : {}) }] });

/** The slot of a panel: a screen that faces +Z (the side the player arrives from) at `position`, with its script and data. */
function panelSlot(slot, { id, name, parentId = null, position, rotation = IDENTITY, pixels, worldWidth, components = [] }) {
	return slot(id, name, parentId, {
		position,
		rotation,
		components: [{ type: 'uiPanel', width: pixels.width, height: pixels.height, worldWidth, background: PALETTE.panel, mirrorX: true }, ...components]
	});
}

// --- voting board ------------------------------------------------------------------------------------------------------

/**
 * A board that ranks `items` by votes and shows the top few, each with an up and a down button.
 * `noun` names one entry in the status line ("idea", "bug").
 */
export function votingBoardSlots(slot, { id, name, title, subtitle, noun, accent, items, position, rotation, worldWidth, parentId = null }) {
	panelSlot(slot, {
		id,
		name,
		parentId,
		position,
		rotation,
		pixels: BOARD_PIXELS,
		worldWidth,
		components: [{ type: 'scriptState', data: { items } }, { type: 'codeBlock', code: boardScript({ prefix: `${id}-`, rows: BOARD_ROWS, noun }) }]
	});
	control(slot, `${id}-title`, `${name} Title`, id, { kind: 'text', text: title, width: 1090, height: 64, fontSize: 42, fontWeight: 'bold', color: PALETTE.text });
	control(slot, `${id}-subtitle`, `${name} Subtitle`, id, { kind: 'text', text: subtitle, width: 1090, height: 50, fontSize: 24, color: accent });
	for (let i = 0; i < BOARD_ROWS; i++) {
		const row = control(slot, `${id}-row-${i}`, `${name} Row ${i + 1}`, id, { kind: 'container', flexDirection: 'row', gap: 12, width: 1090, height: 104, background: PALETTE.row, visible: false }, 6);
		control(slot, `${id}-up-${i}`, 'Vote Up', row, { kind: 'button', width: 90, height: 104, text: '▲', fontSize: 40, background: PALETTE.up });
		control(slot, `${id}-score-${i}`, 'Score', row, { kind: 'text', width: 110, height: 104, text: '0', fontSize: 38, fontWeight: 'bold', color: PALETTE.text });
		control(slot, `${id}-down-${i}`, 'Vote Down', row, { kind: 'button', width: 90, height: 104, text: '▼', fontSize: 40, background: PALETTE.down });
		control(slot, `${id}-text-${i}`, 'Entry', row, { kind: 'text', width: 760, height: 104, text: '', fontSize: 28, color: PALETTE.text });
	}
	control(slot, `${id}-status`, `${name} Status`, id, { kind: 'text', text: '', width: 1090, height: 50, fontSize: 22, color: PALETTE.muted });
}

/** The script of a voting board: draws its `scriptState` items ranked by votes, and turns button presses into votes. Host only. */
export function boardScript({ prefix, rows, noun }) {
	return String.raw`
const SELF = ctx.self.id;
const PREFIX = ${JSON.stringify(prefix)};
const ROWS = ${rows};
const NOUN = ${JSON.stringify(noun)};
const SETTLE_MS = 2000;
let drawn = null;
let order = [];
let view = [];
let lastVote = 0;
let unsorted = false;
let wait = 0;

function set(id, field, value, broadcast = false) { ctx.world.setComponentField(PREFIX + id, 'uiElement', field, value, broadcast); }
function state() { const s = ctx.self.getComponent('scriptState'); return s && s.data ? s.data : {}; }
function items() { const list = state().items; return Array.isArray(list) ? list : []; }
function ranked(list) { return list.map((item, i) => ({ item, i })).sort((a, b) => b.item.votes - a.item.votes || a.i - b.i).map((e) => e.item); }

// Right after a vote the rows keep their places (so a second click lands on the same entry); they re-rank once votes stop.
function draw() {
  const list = items();
  const signature = JSON.stringify(list);
  const settling = Date.now() - lastVote < SETTLE_MS;
  if (signature === drawn && (settling || !unsorted)) return;
  drawn = signature;
  const byId = new Map(list.map((item) => [item.id, item]));
  const keep = settling && order.length > 0 && order.every((id) => byId.has(id));
  if (!keep) order = ranked(list).slice(0, ROWS).map((item) => item.id);
  unsorted = keep;
  view = order.map((id) => byId.get(id));
  for (let i = 0; i < ROWS; i++) {
    const entry = view[i];
    set('row-' + i, 'visible', !!entry);
    if (!entry) continue;
    set('score-' + i, 'text', String(entry.votes));
    set('text-' + i, 'text', entry.title + (entry.detail ? '\n' + entry.detail : ''));
  }
  const top = Math.min(list.length, ROWS);
  set('status', 'text', list.length ? 'Top ' + top + ' of ' + list.length + ' ' + NOUN + (list.length === 1 ? '' : 's') + '  ·  vote to push the best to the top' : 'No ' + NOUN + 's yet. Be the first to send one!', true);
}

function vote(rank, delta) {
  const entry = view[rank];
  if (!entry) return;
  const next = items().map((item) => (item.id === entry.id ? { ...item, votes: item.votes + delta } : item));
  ctx.world.setComponentField(SELF, 'scriptState', 'data', { ...state(), items: next });
  lastVote = Date.now();
  draw();
}

return {
  tick(dt) {
    if (!ctx.world.isHost()) return;
    wait -= dt;
    if (wait > 0) return;
    wait = 0.25;
    draw();
  },
  onUIEvent(event) {
    if (event.type !== 'press' || !event.slotId.startsWith(PREFIX)) return;
    const match = event.slotId.slice(PREFIX.length).match(/^(up|down)-(\d+)$/);
    if (match) vote(Number(match[2]), match[1] === 'up' ? 1 : -1);
  }
};
`;
}

// --- suggestion box ----------------------------------------------------------------------------------------------------

export const SUGGESTION_CATEGORIES = [
	{ key: 'idea', label: 'Idea' },
	{ key: 'bug', label: 'Bug' },
	{ key: 'other', label: 'Other' }
];

/** A kiosk to send an idea or a bug: `boards` maps each category key to the id of the voting board that receives it. */
export function suggestionBoxSlots(slot, { id, name, boards, position, rotation, worldWidth, parentId = null }) {
	const pixels = { width: 1000, height: 640 };
	panelSlot(slot, { id, name, parentId, position, rotation, pixels, worldWidth, components: [{ type: 'codeBlock', code: suggestionScript({ prefix: `${id}-`, boards }) }] });
	control(slot, `${id}-title`, `${name} Title`, id, { kind: 'text', text: 'SUGGESTION BOX', width: 900, height: 64, fontSize: 40, fontWeight: 'bold', color: PALETTE.text });
	control(slot, `${id}-hint`, `${name} Hint`, id, { kind: 'text', text: 'Pick a category, write it in a line and send it to the boards.', width: 900, height: 56, fontSize: 24, color: '#fcd34d' });
	const row = control(slot, `${id}-categories`, `${name} Categories`, id, { kind: 'container', flexDirection: 'row', gap: 14, width: 900, height: 70 }, 6);
	for (const category of SUGGESTION_CATEGORIES) {
		control(slot, `${id}-category-${category.key}`, `${category.label} Category`, row, {
			kind: 'button',
			width: 280,
			height: 66,
			text: category.label,
			fontSize: 28,
			background: category.key === SUGGESTION_CATEGORIES[0].key ? PALETTE.active : PALETTE.neutral
		});
	}
	control(slot, `${id}-input`, `${name} Text`, id, { kind: 'input', width: 900, height: 70, placeholder: 'What should we build or fix?', fontSize: 26, background: PALETTE.row, color: PALETTE.text }, 6);
	control(slot, `${id}-send`, `${name} Send`, id, { kind: 'button', width: 900, height: 76, text: 'Send', fontSize: 32, background: PALETTE.up }, 6);
	control(slot, `${id}-status`, `${name} Status`, id, { kind: 'text', text: 'Sending an idea.', width: 900, height: 60, fontSize: 24, color: PALETTE.muted });
}

/** The script of the suggestion box: a sent line becomes an entry (with one vote) on the board of its category. Host only. */
export function suggestionScript({ prefix, boards }) {
	return String.raw`
const PREFIX = ${JSON.stringify(prefix)};
const BOARDS = ${JSON.stringify(boards)};
const LABELS = ${JSON.stringify(Object.fromEntries(SUGGESTION_CATEGORIES.map((c) => [c.key, c.label])))};
const ACTIVE = ${JSON.stringify(PALETTE.active)};
const IDLE = ${JSON.stringify(PALETTE.neutral)};
const MIN_LENGTH = 4;
const MAX_LENGTH = 80;
const MAX_ENTRIES = 40;
const COOLDOWN_MS = 2000;
let category = ${JSON.stringify(SUGGESTION_CATEGORIES[0].key)};
let typed = '';
let lastSent = 0;

function set(id, field, value, broadcast = false) { ctx.world.setComponentField(PREFIX + id, 'uiElement', field, value, broadcast); }
function status(message) { set('status', 'text', message, true); }

function choose(key) {
  category = key;
  for (const other of Object.keys(LABELS)) set('category-' + other, 'background', other === key ? ACTIVE : IDLE);
  status('Sending ' + (key === 'idea' ? 'an idea' : key === 'bug' ? 'a bug report' : 'something else') + '.');
}

function send() {
  if (Date.now() - lastSent < COOLDOWN_MS) return;
  const text = (typed || ctx.ui.getInputText(PREFIX + 'input') || '').trim().replace(/\s+/g, ' ');
  if (text.length < MIN_LENGTH) return status('Write a few more words first.');
  const board = ctx.hierarchy.getSlot(BOARDS[category]);
  const data = board && board.components.find((c) => c.type === 'scriptState');
  if (!data) return status('That board is not here right now.');
  lastSent = Date.now();
  const title = text.slice(0, MAX_LENGTH);
  const list = Array.isArray(data.data.items) ? data.data.items : [];
  const same = list.find((item) => item.title.toLowerCase() === title.toLowerCase());
  let next;
  if (same) {
    next = list.map((item) => (item === same ? { ...item, votes: item.votes + 1 } : item));
    status('That is already on the board, so it got your vote.');
  } else {
    next = [...list, { id: crypto.randomUUID(), title, detail: LABELS[category] + '  ·  new', votes: 1 }];
    // A full board drops its least-voted (and oldest) entry.
    if (next.length > MAX_ENTRIES) {
      const lowest = Math.min(...next.map((item) => item.votes));
      next.splice(next.findIndex((item) => item.votes === lowest), 1);
    }
    status('Thanks! Your ' + LABELS[category].toLowerCase() + ' is on the board.');
  }
  ctx.world.setComponentField(BOARDS[category], 'scriptState', 'data', { ...data.data, items: next });
  typed = '';
  set('input', 'text', '');
}

return {
  onUIEvent(event) {
    if (!event.slotId.startsWith(PREFIX)) return;
    const id = event.slotId.slice(PREFIX.length);
    if (id === 'input' && (event.type === 'change' || event.type === 'submit')) {
      typed = event.text || '';
      if (event.type === 'submit') send();
      return;
    }
    if (event.type !== 'press') return;
    if (id === 'send') send();
    else if (id.startsWith('category-') && LABELS[id.slice(9)]) choose(id.slice(9));
  }
};
`;
}

// --- mood wall ---------------------------------------------------------------------------------------------------------

export const MOODS = [
	{ key: 'loving', label: 'Loving it', color: '#16a34a' },
	{ key: 'good', label: 'Good', color: '#65a30d' },
	{ key: 'meh', label: 'Meh', color: '#d97706' },
	{ key: 'needs-work', label: 'Needs work', color: '#dc2626' }
];
const MOOD_BAR_WIDTH = 500;

/** Four buttons to say how you feel about the platform, and a bar for each showing how many felt so. */
export function moodWallSlots(slot, { id, name, counts, position, rotation, worldWidth, parentId = null }) {
	const pixels = { width: 1000, height: 700 };
	panelSlot(slot, {
		id,
		name,
		parentId,
		position,
		rotation,
		pixels,
		worldWidth,
		components: [{ type: 'scriptState', data: { counts } }, { type: 'codeBlock', code: moodScript({ prefix: `${id}-`, moods: MOODS, barWidth: MOOD_BAR_WIDTH }) }]
	});
	control(slot, `${id}-title`, `${name} Title`, id, { kind: 'text', text: 'MOOD WALL', width: 900, height: 64, fontSize: 40, fontWeight: 'bold', color: PALETTE.text });
	control(slot, `${id}-hint`, `${name} Hint`, id, { kind: 'text', text: 'How are you feeling about the platform?', width: 900, height: 56, fontSize: 26, color: '#fcd34d' });
	const buttons = control(slot, `${id}-buttons`, `${name} Buttons`, id, { kind: 'container', flexDirection: 'row', gap: 12, width: 900, height: 76 }, 8);
	for (const [i, mood] of MOODS.entries()) {
		control(slot, `${id}-button-${i}`, `${mood.label} Button`, buttons, { kind: 'button', width: 213, height: 72, text: mood.label, fontSize: 25, background: mood.color });
	}
	for (const [i, mood] of MOODS.entries()) {
		const row = control(slot, `${id}-row-${i}`, `${mood.label} Tally`, id, { kind: 'container', flexDirection: 'row', gap: 12, width: 900, height: 56 }, 6);
		control(slot, `${id}-label-${i}`, `${mood.label} Label`, row, { kind: 'text', width: 190, height: 56, text: mood.label, fontSize: 26, color: PALETTE.text });
		const track = control(slot, `${id}-track-${i}`, `${mood.label} Track`, row, { kind: 'container', flexDirection: 'row', width: MOOD_BAR_WIDTH, height: 40, background: PALETTE.row });
		control(slot, `${id}-fill-${i}`, `${mood.label} Bar`, track, { kind: 'container', width: 8, height: 40, background: mood.color });
		control(slot, `${id}-count-${i}`, `${mood.label} Count`, row, { kind: 'text', width: 170, height: 56, text: '0', fontSize: 24, color: PALETTE.muted });
	}
	control(slot, `${id}-status`, `${name} Status`, id, { kind: 'text', text: '', width: 900, height: 50, fontSize: 22, color: PALETTE.muted });
}

/** The script of the mood wall: each press adds one to that mood, and the bars show each mood's share of the votes. Host only. */
export function moodScript({ prefix, moods, barWidth }) {
	return String.raw`
const SELF = ctx.self.id;
const PREFIX = ${JSON.stringify(prefix)};
const MOODS = ${moods.length};
const BAR = ${barWidth};
let drawn = null;
let wait = 0;

function set(id, field, value, broadcast = false) { ctx.world.setComponentField(PREFIX + id, 'uiElement', field, value, broadcast); }
function counts() {
  const s = ctx.self.getComponent('scriptState');
  const list = s && s.data && Array.isArray(s.data.counts) ? s.data.counts : [];
  return Array.from({ length: MOODS }, (_, i) => Number(list[i]) || 0);
}

function draw() {
  const list = counts();
  const signature = list.join(',');
  if (signature === drawn) return;
  drawn = signature;
  const total = list.reduce((sum, n) => sum + n, 0);
  const most = Math.max(1, ...list);
  list.forEach((n, i) => {
    set('fill-' + i, 'width', Math.max(8, Math.round((BAR * n) / most)));
    set('count-' + i, 'text', n + (total ? '  (' + Math.round((100 * n) / total) + '%)' : ''));
  });
  set('status', 'text', total ? total + ' votes so far  ·  thanks for telling us' : 'No votes yet.', true);
}

return {
  tick(dt) {
    if (!ctx.world.isHost()) return;
    wait -= dt;
    if (wait > 0) return;
    wait = 0.25;
    draw();
  },
  onUIEvent(event) {
    if (event.type !== 'press' || !event.slotId.startsWith(PREFIX)) return;
    const match = event.slotId.slice(PREFIX.length).match(/^button-(\d+)$/);
    if (!match) return;
    const next = counts();
    next[Number(match[1])] += 1;
    ctx.world.setComponentField(SELF, 'scriptState', 'data', { counts: next });
    draw();
  }
};
`;
}

// --- roadmap -----------------------------------------------------------------------------------------------------------

export const ROADMAP_STATUSES = {
	shipped: { label: 'SHIPPED', color: '#15803d' },
	progress: { label: 'IN PROGRESS', color: '#b45309' },
	planned: { label: 'PLANNED', color: '#475569' }
};

/** A read-only list of what is planned, in progress and shipped. `entries` are `{ status, title }`. */
export function roadmapSlots(slot, { id, name, subtitle, entries, position, rotation, worldWidth, parentId = null }) {
	panelSlot(slot, { id, name, parentId, position, rotation, pixels: BOARD_PIXELS, worldWidth });
	control(slot, `${id}-title`, `${name} Title`, id, { kind: 'text', text: 'ROADMAP', width: 1090, height: 64, fontSize: 42, fontWeight: 'bold', color: PALETTE.text });
	control(slot, `${id}-subtitle`, `${name} Subtitle`, id, { kind: 'text', text: subtitle, width: 1090, height: 50, fontSize: 24, color: '#5eead4' });
	for (const [i, entry] of entries.entries()) {
		const status = ROADMAP_STATUSES[entry.status];
		const row = control(slot, `${id}-row-${i}`, `${name} Row ${i + 1}`, id, { kind: 'container', flexDirection: 'row', gap: 12, width: 1090, height: 84, background: PALETTE.row }, 6);
		const chip = control(slot, `${id}-status-${i}`, 'Status', row, { kind: 'container', width: 250, height: 84, background: status.color });
		control(slot, `${id}-status-label-${i}`, 'Status Label', chip, { kind: 'text', width: 230, height: 84, text: status.label, fontSize: 26, fontWeight: 'bold', color: PALETTE.text });
		control(slot, `${id}-text-${i}`, 'Entry', row, { kind: 'text', width: 810, height: 84, text: entry.title, fontSize: 28, color: PALETTE.text });
	}
}
