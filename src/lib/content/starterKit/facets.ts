/**
 * Facets: small pieces of UI made to be kept on the Home grid of the personal menu. Grab one, let go of it over the Home tab and
 * it stays there in every world: a frame-rate counter, a clock, who is in the session, a volume slider, shortcuts. Each is a UI
 * panel whose script runs in the player's own menu (see `ctx.dash` and `ctx.system`), so it reads the game itself, not the world
 * it was picked up in.
 *
 * Some add a tab to the menu (`ctx.dash.addTab`), and a tab's page may hold a `grid` element, a place for the player to put more pieces of UI.
 *
 * A panel's elements flow top to bottom in 92% of its width and 88% of its height (see `uiLayout.ts`), so each facet's heights
 * add up to less than that. The size of a panel decides how many cells it asks for: about half its pixels, 104 px a cell.
 */
import type { Component, Slot, SlotTree } from '@kithin/engine/ecs/types';
import type { StarterKitEntry } from '@kithin/engine/xr/content/registry';

const INK = '#0d0d16';
const SURFACE = '#13131f';
const RAISED = '#26263a';
const TEXT = '#f4f1ea';
const MUTED = '#9b9aa3';
const EMBER = '#ff7a45';
const MINT = '#8ff0cf';
const GLOW = '#ffcf7a';

type Props = Record<string, unknown>;

const slot = (id: string, parentId: string | null, name: string, components: Component[]): Slot => ({
	id, parentId, name, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], components
});

/** A panel and what is on it. `code` is the script of the panel, which runs in the player's menu. */
function panel(id: string, name: string, size: { width: number; height: number }, code: string, build: (add: (name: string, kind: string, props: Props, parent?: string) => void) => void): SlotTree {
	const slots: Slot[] = [slot(id, null, name, [{ type: 'uiPanel', width: size.width, height: size.height, worldWidth: size.width / 500, background: INK } as Component, { type: 'codeBlock', code } as Component])];
	build((elementName, kind, props, parent) => {
		slots.push(slot(`${id}-${slots.length}`, parent ? (slots.find((candidate) => candidate.name === parent)?.id ?? id) : id, elementName, [{ type: 'uiElement', kind, ...props } as Component]));
	});
	return slots;
}

const text = (add: Parameters<Parameters<typeof panel>[4]>[0], name: string, value: string, height: number, fontSize: number, extra: Props = {}) =>
	add(name, 'text', { text: value, height, fontSize, textAlign: 'center', color: TEXT, ...extra });

/**
 * What every facet's script starts with: `set(name, field, value)` writes a field of the element of the panel with that name.
 * Elements are found by name under the panel, never by id (the copy kept on the grid has ids of its own) or by name in the whole
 * scene (another facet of the same kind has the same names).
 */
const PRELUDE = `
const find = (root, name) => { for (const child of ctx.hierarchy.getChildren(root)) { if (child.name === name) return child.id; const deep = find(child.id, name); if (deep) return deep; } return null; };
const ids = {};
const idOf = (name) => (ids[name] = ids[name] || find(ctx.self.id, name));
const set = (name, field, value) => { const id = idOf(name); if (id) ctx.world.setComponentField(id, 'uiElement', field, value); };
const pad = (n) => (n < 10 ? '0' : '') + n;
`;

const fpsColor = (fps: string) => `${fps} >= 60 ? '${MINT}' : ${fps} >= 30 ? '${GLOW}' : '#ff7b6b'`;

const FPS = panel('facet-fps', 'FPS Counter', { width: 400, height: 200 }, `${PRELUDE}
let every = 0;
return {
  tick(dt) {
    every -= dt; if (every > 0) return; every = 0.5;
    const s = ctx.system.stats(); if (!s) return;
    set('Value', 'text', String(s.fps));
    set('Value', 'color', ${fpsColor('s.fps')});
    set('Detail', 'text', s.frameMs + ' ms · ' + s.drawCalls + ' draw calls');
  }
};`, (add) => {
	text(add, 'Value', '--', 104, 84, { fontWeight: 'bold' });
	text(add, 'Detail', 'frames per second', 40, 24, { color: MUTED });
});

const CLOCK = panel('facet-clock', 'Clock', { width: 400, height: 200 }, `${PRELUDE}
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let every = 0;
return {
  tick(dt) {
    every -= dt; if (every > 0) return; every = 1;
    const now = new Date();
    set('Time', 'text', pad(now.getHours()) + ':' + pad(now.getMinutes()));
    set('Date', 'text', days[now.getDay()] + ', ' + now.getDate() + ' ' + months[now.getMonth()]);
  }
};`, (add) => {
	text(add, 'Time', '--:--', 104, 84, { fontWeight: 'bold', color: EMBER });
	text(add, 'Date', '', 40, 26, { color: MUTED });
});

const STAT_LINES = ['FPS', 'Frame time', 'Draw calls', 'Meshes drawn', 'Triangles'] as const;
const PERFORMANCE = panel('facet-performance', 'Performance', { width: 400, height: 400 }, `${PRELUDE}
let every = 0;
return {
  tick(dt) {
    every -= dt; if (every > 0) return; every = 0.5;
    const s = ctx.system.stats(); if (!s) return;
    set('FPS', 'text', 'FPS            ' + s.fps);
    set('Frame time', 'text', 'Frame time     ' + s.frameMs + ' ms');
    set('Draw calls', 'text', 'Draw calls     ' + s.drawCalls);
    set('Meshes drawn', 'text', 'Meshes drawn   ' + s.meshes);
    set('Triangles', 'text', 'Triangles      ' + s.kilotriangles + 'k');
  }
};`, (add) => {
	text(add, 'Title', 'PERFORMANCE', 56, 28, { fontWeight: 'bold', color: EMBER });
	for (const line of STAT_LINES) text(add, line, line, 52, 26, { textAlign: 'left' });
});

const SESSION = panel('facet-session', 'Session', { width: 400, height: 200 }, `${PRELUDE}
let every = 0;
return {
  tick(dt) {
    every -= dt; if (every > 0) return; every = 1;
    const info = ctx.system.session(); if (!info) return;
    set('Status', 'text', info.role === 'host' ? 'Hosting' : info.role === 'guest' ? 'Visiting' : 'Playing solo');
    set('Status', 'color', info.role === 'solo' ? '${MUTED}' : '${MINT}');
    set('World', 'text', info.worldName || 'No world');
    set('Room', 'text', info.roomCode ? 'Room code ' + info.roomCode : 'Not shared');
    set('Players', 'text', ctx.world.getPlayers().length + ' in the world');
  }
};`, (add) => {
	text(add, 'Status', 'Session', 44, 30, { fontWeight: 'bold' });
	text(add, 'World', '', 36, 22, { color: MUTED });
	text(add, 'Room', '', 36, 22, { color: GLOW });
	text(add, 'Players', '', 36, 22, { color: MUTED });
});

const PLAYER_LINES = 7;
const PLAYERS = panel('facet-players', 'Players', { width: 400, height: 400 }, `${PRELUDE}
let every = 0;
return {
  tick(dt) {
    every -= dt; if (every > 0) return; every = 1;
    const players = ctx.world.getPlayers();
    set('Title', 'text', 'PLAYERS · ' + players.length);
    for (let i = 0; i < ${PLAYER_LINES}; i++) {
      const last = i === ${PLAYER_LINES} - 1 && players.length > ${PLAYER_LINES};
      const player = players[i];
      set('Player ' + i, 'text', last ? '+ ' + (players.length - ${PLAYER_LINES - 1}) + ' more' : player ? (player.role === 'host' ? '★ ' : '') + player.name : '');
    }
  }
};`, (add) => {
	text(add, 'Title', 'PLAYERS', 52, 28, { fontWeight: 'bold', color: EMBER });
	for (let index = 0; index < PLAYER_LINES; index++) text(add, `Player ${index}`, '', 38, 24, { textAlign: 'left' });
});

const VOLUME = panel('facet-volume', 'Volume', { width: 400, height: 200 }, `${PRELUDE}
let every = 0;
let touched = -10;
const percent = (v) => 'Volume  ' + Math.round(v * 100) + '%';
return {
  tick(dt) {
    every -= dt; touched += dt; if (every > 0) return; every = 0.5;
    const v = ctx.dash.settings.get('masterVolume'); if (v === null) return;
    set('Title', 'text', percent(v));
    if (touched > 2) set('Level', 'value', v);
  },
  onUIEvent(event) {
    if (event.slotId !== idOf('Level') || typeof event.value !== 'number') return;
    touched = 0;
    ctx.dash.settings.set('masterVolume', event.value);
    set('Title', 'text', percent(event.value));
  }
};`, (add) => {
	text(add, 'Title', 'Volume', 60, 32, { fontWeight: 'bold' });
	add('Level', 'slider', { height: 48, minValue: 0, maxValue: 1, step: 0.05, value: 1, background: SURFACE, color: EMBER });
});

const LAUNCH_TABS: Record<string, string> = { Worlds: 'worlds', Inventory: 'inventory', Settings: 'settings' };
const LAUNCHER = panel('facet-launcher', 'Quick Launch', { width: 400, height: 200 }, `${PRELUDE}
const tabs = ${JSON.stringify(LAUNCH_TABS)};
return {
  onUIEvent(event) {
    if (event.type !== 'press') return;
    const pressed = ctx.hierarchy.getSlot(event.slotId);
    if (pressed && tabs[pressed.name]) ctx.ui.openDash(tabs[pressed.name]);
  }
};`, (add) => {
	text(add, 'Title', 'QUICK LAUNCH', 52, 26, { fontWeight: 'bold', color: EMBER });
	add('Row', 'container', { width: 356, height: 84, flexDirection: 'row', gap: 10 });
	for (const name of Object.keys(LAUNCH_TABS)) add(name, 'button', { width: 112, height: 80, text: name, fontSize: 22, fontWeight: 'bold', textAlign: 'center', cornerRadius: 14, color: TEXT, background: RAISED }, 'Row');
});

const STOPWATCH = panel('facet-stopwatch', 'Stopwatch', { width: 400, height: 200 }, `${PRELUDE}
let running = false;
let elapsed = 0;
const show = () => {
  const total = Math.floor(elapsed * 10);
  set('Time', 'text', pad(Math.floor(total / 600)) + ':' + pad(Math.floor(total / 10) % 60) + '.' + (total % 10));
  set('Start', 'text', running ? 'Pause' : 'Start');
  set('Start', 'background', running ? '#b4332b' : '#1f8f78');
};
return {
  tick(dt) { if (running) { elapsed += dt; show(); } },
  onUIEvent(event) {
    if (event.type !== 'press') return;
    const pressed = ctx.hierarchy.getSlot(event.slotId);
    if (!pressed) return;
    if (pressed.name === 'Start') running = !running;
    if (pressed.name === 'Reset') { running = false; elapsed = 0; }
    show();
  }
};`, (add) => {
	text(add, 'Time', '00:00.0', 84, 64, { fontWeight: 'bold', color: MINT });
	add('Row', 'container', { width: 356, height: 64, flexDirection: 'row', gap: 10 });
	add('Start', 'button', { width: 220, height: 60, text: 'Start', fontSize: 24, fontWeight: 'bold', textAlign: 'center', cornerRadius: 14, color: TEXT, background: '#1f8f78' }, 'Row');
	add('Reset', 'button', { width: 126, height: 60, text: 'Reset', fontSize: 24, textAlign: 'center', cornerRadius: 14, color: TEXT, background: RAISED }, 'Row');
});

const SOUND = panel('facet-sound', 'Sound Toggle', { width: 200, height: 200 }, `${PRELUDE}
let before = 1;
let every = 0;
const show = (v) => { set('Toggle', 'text', v > 0 ? 'Sound\\nOn' : 'Sound\\nOff'); set('Toggle', 'background', v > 0 ? '#1f8f78' : '#b4332b'); };
return {
  tick(dt) { every -= dt; if (every > 0) return; every = 0.5; const v = ctx.dash.settings.get('masterVolume'); if (v !== null) show(v); },
  onUIEvent(event) {
    if (event.type !== 'press') return;
    const v = ctx.dash.settings.get('masterVolume');
    if (v === null) return;
    if (v > 0) { before = v; ctx.dash.settings.set('masterVolume', 0); } else ctx.dash.settings.set('masterVolume', before || 1);
    show(ctx.dash.settings.get('masterVolume'));
  }
};`, (add) => {
	add('Toggle', 'button', { height: 150, text: 'Sound', fontSize: 34, fontWeight: 'bold', textAlign: 'center', cornerRadius: 18, color: TEXT, background: '#1f8f78' });
});

const DICE = panel('facet-dice', 'Dice', { width: 200, height: 200 }, `${PRELUDE}
return {
  onUIEvent(event) {
    if (event.type !== 'press') return;
    set('Roll', 'text', String(1 + Math.floor(Math.random() * 6)));
    ctx.audio.play({ frequency: 520, pitchDrop: 200, durationMs: 90, volume: 0.3 });
  }
};`, (add) => {
	add('Roll', 'button', { height: 150, text: 'Roll', fontSize: 72, fontWeight: 'bold', textAlign: 'center', cornerRadius: 18, color: TEXT, background: RAISED });
});

// A tab of its own, added by a facet: the page is made of UI nodes like any panel (see `ctx.dash.addTab`).
const STATS_TAB_ROWS = [['fps', 'FPS'], ['frame', 'Frame time'], ['draws', 'Draw calls'], ['meshes', 'Meshes drawn'], ['tris', 'Triangles'], ['world', 'World'], ['players', 'Players']] as const;
const STATS_TAB = panel('facet-stats-tab', 'Stats Tab', { width: 400, height: 200 }, `${PRELUDE}
const rows = ${JSON.stringify(STATS_TAB_ROWS)};
const element = (id, parent, name, kind, props) => ({ id, parentId: parent, name, components: [{ type: 'uiElement', kind, ...props }] });
const made = ctx.dash.addTab({
  id: 'stats', label: 'Stats', icon: 'box', order: 60,
  ui: [
    { id: 'page', name: 'Stats Page', components: [{ type: 'uiPanel', width: 1280, height: 520, worldWidth: 2.4, background: '${INK}' }] },
    element('title', 'page', 'Title', 'text', { text: 'STATS', height: 70, fontSize: 44, fontWeight: 'bold', textAlign: 'left', color: '${EMBER}' }),
    ...rows.map(([id, label]) => element(id, 'page', label, 'text', { text: label, height: 52, fontSize: 32, textAlign: 'left', color: '${TEXT}' }))
  ]
});
let every = 0;
return {
  tick(dt) {
    every -= dt; if (every > 0 || !made) return; every = 0.5;
    const s = ctx.system.stats(); const info = ctx.system.session(); if (!s || !info) return;
    const write = (id, value) => ctx.world.setComponentField(made.slots[id], 'uiElement', 'text', value);
    write('fps', 'FPS            ' + s.fps);
    write('frame', 'Frame time     ' + s.frameMs + ' ms');
    write('draws', 'Draw calls     ' + s.drawCalls);
    write('meshes', 'Meshes drawn   ' + s.meshes);
    write('tris', 'Triangles      ' + s.kilotriangles + 'k');
    write('world', 'World          ' + (info.worldName || 'none'));
    write('players', 'Players        ' + ctx.world.getPlayers().length);
  },
  onUIEvent(event) { if (event.type === 'press') ctx.dash.showTab('stats'); }
};`, (add) => {
	text(add, 'Title', 'STATS TAB', 52, 26, { fontWeight: 'bold', color: EMBER });
	add('Open', 'button', { height: 64, text: 'Open the Stats tab', fontSize: 24, fontWeight: 'bold', textAlign: 'center', cornerRadius: 14, color: TEXT, background: RAISED });
});

// A tab of the player's own: its page is a grid they fill with pieces of UI, kept under this piece's own name (`ctx.dash.instanceId()`),
// so each copy of the facet has a tab and a grid of its own.
const EXTRA_TAB = panel('facet-extra-tab', 'Extra Tab', { width: 400, height: 200 }, `${PRELUDE}
const instance = ctx.dash.instanceId();
if (instance) ctx.dash.addTab({
  id: 'extra', label: 'Extra', icon: 'folder', order: 70,
  ui: [
    { id: 'page', name: 'Extra Page', components: [{ type: 'uiPanel', width: 1280, height: 520, worldWidth: 2.4, background: '${INK}' }] },
    { id: 'grid', parentId: 'page', name: 'Extra Grid', components: [{ type: 'uiElement', kind: 'grid', gridId: 'extra-tab:' + instance, width: 1170, height: 450, text: 'Extra' }] }
  ]
});
return {
  onUIEvent(event) { if (event.type === 'press') ctx.dash.showTab('extra'); }
};`, (add) => {
	text(add, 'Title', 'EXTRA TAB', 52, 26, { fontWeight: 'bold', color: EMBER });
	add('Open', 'button', { height: 64, text: 'Open the Extra tab', fontSize: 24, fontWeight: 'bold', textAlign: 'center', cornerRadius: 14, color: TEXT, background: RAISED });
});

export const FACETS_FOLDER = { id: 'facets', name: 'Facets' };

/** The facets, as starter kit entries (they are picked up like any object, and kept on the Home grid when let go over it). */
export const FACET_ENTRIES: StarterKitEntry[] = [
	{ id: 'facet-fps', name: 'FPS Counter', build: () => FPS },
	{ id: 'facet-clock', name: 'Clock', build: () => CLOCK },
	{ id: 'facet-performance', name: 'Performance', build: () => PERFORMANCE },
	{ id: 'facet-session', name: 'Session', build: () => SESSION },
	{ id: 'facet-players', name: 'Players', build: () => PLAYERS },
	{ id: 'facet-volume', name: 'Volume', build: () => VOLUME },
	{ id: 'facet-sound', name: 'Sound Toggle', build: () => SOUND },
	{ id: 'facet-launcher', name: 'Quick Launch', build: () => LAUNCHER },
	{ id: 'facet-stopwatch', name: 'Stopwatch', build: () => STOPWATCH },
	{ id: 'facet-dice', name: 'Dice', build: () => DICE },
	{ id: 'facet-stats-tab', name: 'Stats Tab', build: () => STATS_TAB },
	{ id: 'facet-extra-tab', name: 'Extra Tab', build: () => EXTRA_TAB }
].map((entry) => ({ ...entry, folderId: FACETS_FOLDER.id, build: () => JSON.parse(JSON.stringify(entry.build())) as SlotTree }));
