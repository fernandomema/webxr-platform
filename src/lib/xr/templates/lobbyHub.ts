import type { Component, Slot, SlotTree } from '../../ecs/types.ts';
import { createSlot } from '../../ecs/types.ts';

/**
 * The lobby's welcome hub, on the wall that players face when they arrive: a guide board and a card on each side for the places
 * to go next. A card is a doorway: pressing it offers to go there, nothing is loaded until the visitor chooses.
 *
 * The board answers "what do I want to do?". Six big pictures (explore, create, play with friends, credits, controls, account) each
 * open a short walk-through, one step at a time with Back and Next, in big letters. Every text is written in English and Spanish and
 * each player reads their own language (`UIElementComponent.translations`), and the names of controls are written as `{dash}`, `{use}`…
 * so each reads as the controls of their device (inputHints.ts). Sequences are arrows. What the steps say is what the game does today,
 * down to the names on its buttons. Everything here is data and one small script; the game itself only knows what a UI panel and a world
 * link are. The pictures are drawn by scripts/generate-lobby-art.py.
 */

export interface Say {
	en: string;
	es: string;
}

const GUIDE = 'lobby-guide';
/**
 * A panel draws its controls inside a margin: a control as wide as the panel is cut off at its edges. Everything on the board
 * is at most `SAFE_WIDTH` wide, and the whole of it at most `SAFE_HEIGHT` tall, for a panel of `PX_WIDTH` by `PX_HEIGHT`.
 */
const PX_WIDTH = 1200;
const PX_HEIGHT = 720;
export const SAFE_WIDTH = 1090;
export const SAFE_HEIGHT = 640;
const GUIDE_WIDTH = 2.2;
const GUIDE_HEIGHT = (GUIDE_WIDTH * PX_HEIGHT) / PX_WIDTH;
const GUIDE_CENTER_Y = 1.75;
/** The wall the old welcome sign stood on. Players arrive facing it, so the hub turns half way round to face them. */
const WALL_Z = -3.25;
const FACING_PLAYERS: Slot['rotation'] = [0, 1, 0, 0];

const INK = '#0d0d16';
const SURFACE = '#13131f';
const RAISED = '#26263a';
const BONE = '#f4f1ea';
const MUTED = '#9b9aa3';

export const GUIDE_TITLE: Say = { en: 'Welcome to Kithin', es: 'Bienvenido a Kithin' };
export const GUIDE_QUESTION: Say = { en: 'What do you want to do?', es: '¿Qué quieres hacer?' };
export const GUIDE_BACK_HOME: Say = { en: '‹ Home', es: '‹ Inicio' };
export const GUIDE_PREVIOUS: Say = { en: '‹ Back', es: '‹ Atrás' };
export const GUIDE_NEXT: Say = { en: 'Next ›', es: 'Siguiente ›' };
export const GUIDE_DONE: Say = { en: 'Done', es: 'Listo' };

export interface GuideTopic {
	key: string;
	label: Say;
	accent: string;
	steps: readonly Say[];
}

/** What each topic walks through. The names of buttons and tabs (Dash, Session, Worlds, Inventory, Starter Kit, Spawn, Host…) are the ones the game shows. */
export const GUIDE_TOPICS: readonly GuideTopic[] = [
	{
		key: 'explore', label: { en: 'Explore worlds', es: 'Explorar mundos' }, accent: '#6ec3ff',
		steps: [
			{ en: 'Look at the cards on each side of this board: Create, Workshop, Feedback and Store.', es: 'Mira las tarjetas a los lados de este panel: Crear, Taller, Opiniones y Tienda.' },
			{ en: 'Point at a card and {use}. Pick the first option to travel there.', es: 'Apunta a una tarjeta y {use}. Elige la primera opción para viajar.' },
			{ en: 'More worlds: press {dash} → Worlds.', es: 'Más mundos: pulsa {dash} → Worlds.' },
			{ en: 'To come back here: press {dash} → Worlds → Official → Lobby.', es: 'Para volver aquí: pulsa {dash} → Worlds → Official → Lobby.' }
		]
	},
	{
		key: 'create', label: { en: 'Create a world', es: 'Crear un mundo' }, accent: '#8ff0cf',
		steps: [
			{ en: 'Point at the Create card and {use}. Pick the first option: an empty world.', es: 'Apunta a la tarjeta Crear y {use}. Elige la primera opción: un mundo vacío.' },
			{ en: 'Press {dash} → Inventory → Starter Kit. Pick an object and press Spawn.', es: 'Pulsa {dash} → Inventory → Starter Kit. Elige un objeto y pulsa Spawn.' },
			{ en: 'To pick an object up, {grab}. To let it go, {drop}.', es: 'Para coger un objeto, {grab}. Para soltarlo, {drop}.' },
			{ en: 'Press {dash} → Session → Save world. It is kept in your Inventory.', es: 'Pulsa {dash} → Session → Save world. Se guarda en tu Inventory.' },
			{ en: 'Want code, shops or to publish your world? Use the Studio on the website.', es: '¿Código, tiendas o publicar tu mundo? Usa el Studio en la web.' }
		]
	},
	{
		key: 'friends', label: { en: 'Play with friends', es: 'Jugar con amigos' }, accent: '#ff7a45',
		steps: [
			{ en: 'You need an account: press {dash} → Account.', es: 'Necesitas una cuenta: pulsa {dash} → Account.' },
			{ en: 'Press {dash} → Session. Under Who can join?, press Host on an option.', es: 'Pulsa {dash} → Session. En Who can join?, pulsa Host en una opción.' },
			{ en: 'Press Invite people and share the room code.', es: 'Pulsa Invite people y comparte el código de sala.' },
			{ en: 'Your friends press {dash} → Worlds → Join by code, type the code and press Join room.', es: 'Tus amigos pulsan {dash} → Worlds → Join by code, escriben el código y pulsan Join room.' }
		]
	},
	{
		key: 'credits', label: { en: 'Credits', es: 'Créditos' }, accent: '#ffcf7a',
		steps: [
			{ en: 'Credits pay for things inside worlds. Every purchase asks you first.', es: 'Los créditos pagan cosas dentro de los mundos. Cada compra te pregunta antes.' },
			{ en: 'The ATM is behind you. Point at it and {use} to see your balance.', es: 'El cajero está detrás de ti. Apúntalo y {use} para ver tu saldo.' },
			{ en: 'Add credits at the ATM on Meta Quest, or on the website: Settings → Credits.', es: 'Añade créditos en el cajero con Meta Quest, o en la web: Settings → Credits.' },
			{ en: 'You need an account to use credits.', es: 'Necesitas una cuenta para usar créditos.' }
		]
	},
	{
		key: 'controls', label: { en: 'Controls', es: 'Controles' }, accent: '#9b8cff',
		steps: [
			{ en: 'Move with {move}. Turn with {turn}.', es: 'Muévete con {move}. Gira con {turn}.' },
			{ en: 'To use something, point at it and {use}.', es: 'Para usar algo, apúntalo y {use}.' },
			{ en: 'To pick something up, {grab}. To let it go, {drop}.', es: 'Para coger algo, {grab}. Para soltarlo, {drop}.' },
			{ en: 'To open the Dash, press {dash}.', es: 'Para abrir el Dash, pulsa {dash}.' }
		]
	},
	{
		key: 'account', label: { en: 'Your account', es: 'Tu cuenta' }, accent: '#ff8aaa',
		steps: [
			{ en: 'An account lets you save your worlds in the cloud, publish your worlds and use credits.', es: 'Una cuenta te deja guardar tus mundos en la nube, publicar tus mundos y usar créditos.' },
			{ en: 'Press {dash} → Account → Sign in or Create account.', es: 'Pulsa {dash} → Account → Sign in o Create account.' }
		]
	}
];

const tileImage = (key: string) => `/assets/lobby/tile-${key}.png`;
const iconImage = (key: string) => `/assets/lobby/icon-${key}.png`;

interface Card {
	id: string;
	title: Say;
	accent: string;
	image: string;
	link: { kind: 'builtin'; id: string } | { kind: 'new' };
	label?: string;
	position: [number, number];
}

/** Two columns beside the board, clear of the mirror on one side and the record player on the other. */
const CARD_X = 1.75;
const CARD_ROWS = [2.3, 1.2] as const;

export const GUIDE_CARDS: readonly Card[] = [
	{ id: 'create', title: { en: 'Create', es: 'Crear' }, accent: '#8ff0cf', image: '/assets/lobby/card-create.png', link: { kind: 'new' }, position: [-CARD_X, CARD_ROWS[0]] },
	{ id: 'workshop', title: { en: 'Workshop', es: 'Taller' }, accent: '#ffcf7a', image: '/assets/lobby/card-workshop.png', link: { kind: 'builtin', id: 'workshop' }, label: 'Workshop', position: [-CARD_X, CARD_ROWS[1]] },
	{ id: 'feedback', title: { en: 'Feedback', es: 'Opiniones' }, accent: '#9b8cff', image: '/assets/lobby/card-feedback.png', link: { kind: 'builtin', id: 'pulse' }, label: 'Feedback Center', position: [CARD_X, CARD_ROWS[0]] },
	{ id: 'store', title: { en: 'Store', es: 'Tienda' }, accent: '#6ec3ff', image: '/assets/lobby/card-store.png', link: { kind: 'builtin', id: 'pop-up-store' }, label: 'Pop-up Store', position: [CARD_X, CARD_ROWS[1]] }
];

const CARD_PX_WIDTH = 360;
const CARD_PX_HEIGHT = 460;
export const CARD_SAFE_WIDTH = 300;
const CARD_WIDTH = 0.75;
const CARD_HEIGHT = (CARD_WIDTH * CARD_PX_HEIGHT) / CARD_PX_WIDTH;

// The sizes of the board's parts, in panel pixels.
// Every container is at least as big as what is in it, gaps included: what does not fit is cut off, not shrunk.
const SCREEN_WIDTH = SAFE_WIDTH - 10;
const SCREEN_HEIGHT = SAFE_HEIGHT - 40;
const TILE_WIDTH = 340;
const TILE_IMAGE_HEIGHT = 120;
const TILE_BUTTON_HEIGHT = 64;
/** Room under a button, so it does not sit on the edge of its tile. */
const TILE_FOOT = 16;
const TILE_HEIGHT = TILE_IMAGE_HEIGHT + TILE_BUTTON_HEIGHT + TILE_FOOT;
const GRID_GAP = 20;
const SCREEN_GAP = 16;
const TOPIC_BAR_HEIGHT = 90;
const STEP_HEIGHT = 340;
const NAV_HEIGHT = 100;
export const STEP_TEXT_WIDTH = 860;
export const STEP_TEXT_SIZE = 46;

const tileId = (key: string) => `${GUIDE}-tile-${key}`;
const say = (text: Say) => ({ text: text.en, translations: { es: { text: text.es } } });

/** Moves the guide between its home and the steps of a topic. Only the host (or a solo player) receives the presses, and it writes for everyone. */
function guideCode(): string {
	return `
const TOPICS = ${JSON.stringify(Object.fromEntries(GUIDE_TOPICS.map((topic) => [topic.key, { label: topic.label, accent: topic.accent, icon: iconImage(topic.key), steps: topic.steps }])))};
const WORDS = ${JSON.stringify({ next: GUIDE_NEXT, done: GUIDE_DONE })};
const IDLE = '${RAISED}';
// Only the last write of a change is sent to the guests, and it carries all the others: a click is one update, not ten.
const set = (id, field, value, send) => ctx.world.setComponentField('${GUIDE}-' + id, 'uiElement', field, value, send === true);
const put = (id, say) => { set(id, 'text', say.en); set(id, 'translations', { es: { text: say.es } }); };
let topic = null;
let step = 0;
function home() {
	topic = null;
	set('topic', 'visible', false);
	set('home', 'visible', true, true);
}
function render() {
	const t = TOPICS[topic];
	const last = step === t.steps.length - 1;
	set('home', 'visible', false);
	set('topic', 'visible', true);
	put('topic-title', t.label);
	set('topic-icon', 'src', t.icon);
	set('number', 'text', String(step + 1));
	set('number', 'color', t.accent);
	put('step-text', t.steps[step]);
	set('counter', 'text', (step + 1) + ' / ' + t.steps.length);
	set('previous', 'visible', step > 0);
	put('next', last ? WORDS.done : WORDS.next);
	set('next', 'background', t.accent, true);
}
function open(key) { if (!TOPICS[key]) return; topic = key; step = 0; render(); }
return {
	onUIEvent(event) {
		if (event.type !== 'press') return;
		const id = event.slotId;
		if (id.startsWith('${GUIDE}-tile-')) return open(id.slice('${GUIDE}-tile-'.length));
		if (id === '${GUIDE}-back') return home();
		if (topic === null) return;
		if (id === '${GUIDE}-previous' && step > 0) { step -= 1; return render(); }
		if (id === '${GUIDE}-next') {
			if (step >= TOPICS[topic].steps.length - 1) return home();
			step += 1;
			render();
		}
	}
};`;
}

export function buildLobbyHub(): SlotTree {
	const dark = { type: 'meshRenderer', color: '#0f172a', meshRef: { kind: 'builtin', id: 'box' } } as const;
	const slots: Slot[] = [];
	const add = (slot: Slot) => slots.push(slot);
	/** A piece of a panel's interface, in the order it appears. */
	const ui = (id: string, parentId: string, name: string, element: Omit<Extract<Component, { type: 'uiElement' }>, 'type'>) =>
		add(createSlot({ id, parentId, name, components: [{ type: 'uiElement', ...element }] }));
	/** A piece of the interface with a text in both languages. */
	const words = (id: string, parentId: string, name: string, text: Say, element: Omit<Extract<Component, { type: 'uiElement' }>, 'type' | 'text' | 'translations'>) =>
		ui(id, parentId, name, { ...element, ...say(text) });

	// --- the guide board ---
	add(createSlot({ id: GUIDE, name: 'Welcome Guide', position: [0, 0, WALL_Z], rotation: FACING_PLAYERS }));
	add(createSlot({
		id: `${GUIDE}-frame`, parentId: GUIDE, name: 'Guide Frame',
		position: [0, GUIDE_CENTER_Y, 0.06], scale: [GUIDE_WIDTH + 0.14, GUIDE_HEIGHT + 0.14, 0.06],
		components: [dark, { type: 'collider', shape: 'box' }]
	}));
	for (const side of [-1, 1]) {
		add(createSlot({
			id: `${GUIDE}-leg-${side < 0 ? 'L' : 'R'}`, parentId: GUIDE, name: `Guide Leg ${side < 0 ? 'L' : 'R'}`,
			position: [side * (GUIDE_WIDTH / 2 - 0.1), (GUIDE_CENTER_Y - GUIDE_HEIGHT / 2) / 2, 0.06], scale: [0.08, GUIDE_CENTER_Y - GUIDE_HEIGHT / 2, 0.08],
			components: [dark, { type: 'collider', shape: 'box' }]
		}));
	}
	add(createSlot({
		id: `${GUIDE}-panel`, parentId: GUIDE, name: 'Guide Panel', position: [0, GUIDE_CENTER_Y, 0],
		components: [{ type: 'uiPanel', width: PX_WIDTH, height: PX_HEIGHT, worldWidth: GUIDE_WIDTH, background: INK }, { type: 'codeBlock', code: guideCode() }]
	}));
	const inner = SCREEN_WIDTH;

	// The home: what do you want to do?
	const home = `${GUIDE}-home`;
	ui(home, `${GUIDE}-panel`, 'Guide Home', { kind: 'container', flexDirection: 'column', gap: SCREEN_GAP, width: inner, height: SCREEN_HEIGHT, background: INK, visible: true });
	words(`${GUIDE}-title`, home, 'Guide Title', GUIDE_TITLE, { kind: 'text', width: inner, height: 80, fontSize: 60, fontWeight: 'bold', color: BONE, textAlign: 'center' });
	words(`${GUIDE}-question`, home, 'Guide Question', GUIDE_QUESTION, { kind: 'text', width: inner, height: 56, fontSize: 38, color: MUTED, textAlign: 'center' });
	for (let rowIndex = 0; rowIndex < 2; rowIndex++) {
		const row = `${GUIDE}-row-${rowIndex}`;
		ui(row, home, `Guide Row ${rowIndex + 1}`, { kind: 'container', flexDirection: 'row', gap: GRID_GAP, width: inner, height: TILE_HEIGHT, background: INK });
		for (const topic of GUIDE_TOPICS.slice(rowIndex * 3, rowIndex * 3 + 3)) {
			const column = `${GUIDE}-column-${topic.key}`;
			ui(column, row, `Guide Choice: ${topic.label.en}`, { kind: 'container', flexDirection: 'column', width: TILE_WIDTH, height: TILE_HEIGHT, background: SURFACE, cornerRadius: 18 });
			ui(`${GUIDE}-image-${topic.key}`, column, `Guide Picture: ${topic.label.en}`, { kind: 'image', src: tileImage(topic.key), width: TILE_WIDTH, height: TILE_IMAGE_HEIGHT });
			words(tileId(topic.key), column, `Guide Button: ${topic.label.en}`, topic.label, { kind: 'button', width: TILE_WIDTH - 24, height: TILE_BUTTON_HEIGHT, fontSize: 32, fontWeight: 'bold', cornerRadius: 16, color: '#ffffff', background: RAISED, textAlign: 'center' });
			ui(`${GUIDE}-foot-${topic.key}`, column, `Guide Tile Foot: ${topic.label.en}`, { kind: 'container', width: TILE_WIDTH, height: TILE_FOOT, background: SURFACE });
		}
	}

	// A topic, one step at a time.
	const topicScreen = `${GUIDE}-topic`;
	ui(topicScreen, `${GUIDE}-panel`, 'Guide Topic', { kind: 'container', flexDirection: 'column', gap: SCREEN_GAP, width: inner, height: SCREEN_HEIGHT, background: INK, visible: false });
	const bar = `${GUIDE}-bar`;
	ui(bar, topicScreen, 'Guide Topic Bar', { kind: 'container', flexDirection: 'row', gap: GRID_GAP, width: inner, height: TOPIC_BAR_HEIGHT, background: INK });
	words(`${GUIDE}-back`, bar, 'Guide Back', GUIDE_BACK_HOME, { kind: 'button', width: 230, height: 70, fontSize: 32, fontWeight: 'bold', cornerRadius: 16, color: '#ffffff', background: RAISED, textAlign: 'center' });
	ui(`${GUIDE}-topic-icon`, bar, 'Guide Topic Picture', { kind: 'image', src: iconImage(GUIDE_TOPICS[0].key), width: 90, height: 90 });
	words(`${GUIDE}-topic-title`, bar, 'Guide Topic Title', GUIDE_TOPICS[0].label, { kind: 'text', width: 700, height: 90, fontSize: 52, fontWeight: 'bold', color: BONE });
	const step = `${GUIDE}-step`;
	ui(step, topicScreen, 'Guide Step', { kind: 'container', flexDirection: 'row', gap: 10, width: inner, height: STEP_HEIGHT, background: SURFACE, cornerRadius: 18 });
	ui(`${GUIDE}-number`, step, 'Guide Step Number', { kind: 'text', text: '1', width: 170, height: STEP_HEIGHT, fontSize: 140, fontWeight: 'bold', color: GUIDE_TOPICS[0].accent, textAlign: 'center' });
	words(`${GUIDE}-step-text`, step, 'Guide Step Text', GUIDE_TOPICS[0].steps[0], { kind: 'text', width: STEP_TEXT_WIDTH, height: STEP_HEIGHT, fontSize: STEP_TEXT_SIZE, color: BONE });
	const nav = `${GUIDE}-nav`;
	ui(nav, topicScreen, 'Guide Navigation', { kind: 'container', flexDirection: 'row', gap: GRID_GAP, width: inner, height: NAV_HEIGHT, background: INK });
	words(`${GUIDE}-previous`, nav, 'Guide Previous', GUIDE_PREVIOUS, { kind: 'button', width: 280, height: 80, fontSize: 34, fontWeight: 'bold', cornerRadius: 16, color: '#ffffff', background: RAISED, textAlign: 'center', visible: false });
	ui(`${GUIDE}-counter`, nav, 'Guide Step Counter', { kind: 'text', text: `1 / ${GUIDE_TOPICS[0].steps.length}`, width: 380, height: 80, fontSize: 40, color: MUTED, textAlign: 'center' });
	words(`${GUIDE}-next`, nav, 'Guide Next', GUIDE_NEXT, { kind: 'button', width: 280, height: 80, fontSize: 34, fontWeight: 'bold', cornerRadius: 16, color: '#0d0d16', background: GUIDE_TOPICS[0].accent, textAlign: 'center' });

	// --- the cards ---
	for (const card of GUIDE_CARDS) {
		const id = `lobby-card-${card.id}`;
		add(createSlot({ id, name: `Card: ${card.title.en}`, position: [card.position[0], 0, WALL_Z], rotation: FACING_PLAYERS }));
		add(createSlot({
			id: `${id}-frame`, parentId: id, name: `Card Frame: ${card.title.en}`,
			position: [0, card.position[1], 0.05], scale: [CARD_WIDTH + 0.1, CARD_HEIGHT + 0.1, 0.05],
			components: [{ ...dark, color: card.accent }, { type: 'collider', shape: 'box' }]
		}));
		add(createSlot({
			id: `${id}-panel`, parentId: id, name: `Card Panel: ${card.title.en}`, position: [0, card.position[1], 0],
			components: [
				{ type: 'uiPanel', width: CARD_PX_WIDTH, height: CARD_PX_HEIGHT, worldWidth: CARD_WIDTH, background: INK },
				{ type: 'worldLink', target: card.link, ...(card.label ? { label: card.label } : {}) }
			]
		}));
		const column = `${id}-column`;
		ui(column, `${id}-panel`, 'Card Content', { kind: 'container', flexDirection: 'column', width: CARD_SAFE_WIDTH, height: 390, background: INK });
		ui(`${id}-image`, column, 'Card Picture', { kind: 'image', src: card.image, width: CARD_SAFE_WIDTH, height: 281 });
		words(`${id}-title`, column, 'Card Title', card.title, { kind: 'text', width: CARD_SAFE_WIDTH, height: 100, fontSize: 48, fontWeight: 'bold', color: BONE, textAlign: 'center' });
	}
	return slots;
}
