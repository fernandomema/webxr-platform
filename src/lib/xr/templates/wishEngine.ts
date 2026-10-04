import { createSlot, type Component, type Slot, type SlotTree, type Vec3 } from '../../ecs/types.ts';
import type { BuiltinMeshId } from '../../assets/ref';
import { eulerToQuat } from '../../math/euler.ts';
import { WISH, WISH_INITIAL, wishObjects } from './wishEngineConfig.ts';
import { wishAnimation, wishPress } from './wishEngineAnimation.ts';
import { WISH_ENGINE_SCRIPT } from './wishEngineLogic.ts';

export { WISH, WISH_ENGINE_SCRIPT };

/** A complete, self-contained observatory: all geometry is authored here, all score files ship with the app. */
export function buildWishEngine(): SlotTree {
	const slots: Slot[] = [];
	const gold = WISH.gold, pale = WISH.pale, violet = WISH.violet, teal = WISH.teal;
	const ink = '#181323', stone = '#292336', brass = '#846442', wood = '#30202d';
	const add = (partial: Partial<Slot> & { name: string }) => {
		const slot = createSlot({ parentId: WISH.director, ...partial });
		if (partial.disabled) slot.disabled = true;
		slots.push(slot);
		return slot;
	};
	const group = (id: string, name: string, position: Vec3, extra: Partial<Slot> = {}) => add({ id, name, position, ...extra });
	const shape = (id: string, name: string, mesh: BuiltinMeshId, position: Vec3, scale: Vec3, color: string, extra: Partial<Slot> = {}, opacity?: number) => add({
		id, name, position, scale, ...extra,
		components: [{ type: 'meshRenderer', meshRef: { kind: 'builtin', id: mesh }, color, ...(opacity === undefined ? {} : { opacity }) }, ...(extra.components ?? [])]
	});
	const box = (id: string, position: Vec3, scale: Vec3, color: string, extra: Partial<Slot> = {}) => shape(id, 'Carved Stone', 'box', position, scale, color, extra);
	const sphere = (id: string, position: Vec3, scale: Vec3, color: string, extra: Partial<Slot> = {}) => shape(id, 'Celestial Ornament', 'sphere', position, scale, color, extra);
	const cylinder = (id: string, position: Vec3, scale: Vec3, color: string, extra: Partial<Slot> = {}) => shape(id, 'Brass Fitting', 'cylinder', position, scale, color, extra);
	const line = (id: string, points: Vec3[], color: string, width: number, extra: Partial<Slot> = {}) => add({
		id, name: 'Luminous Inlay', ...extra, components: [{ type: 'stroke', points: points.flat(), width, color }, ...(extra.components ?? [])]
	});
	const ring = (id: string, center: Vec3, radius: number, color: string, width = 0.025, plane: 'xy' | 'xz' = 'xz', extra: Partial<Slot> = {}) => {
		const points: Vec3[] = Array.from({ length: 65 }, (_, i) => {
			const a = i / 64 * Math.PI * 2;
			return plane === 'xy' ? [Math.cos(a) * radius, Math.sin(a) * radius, 0] : [Math.cos(a) * radius, 0, Math.sin(a) * radius];
		});
		return line(id, points, color, width, { position: center, ...extra });
	};
	const script = (code: string): Component => ({ type: 'codeBlock', code });
	const panel = (id: string, name: string, position: Vec3, width: number, height: number, worldWidth: number, background = '#00000000', parentId = WISH.director) => add({
		id, name, parentId, position, components: [{ type: 'uiPanel', width, height, worldWidth, background }]
	});
	const text = (id: string, parentId: string, value: string, height: number, fontSize: number, color: string = pale) => add({
		id, name: 'Inscription', parentId, components: [{ type: 'uiElement', kind: 'text', text: value, height, fontSize, color, textAlign: 'center' }]
	});
	const button = (id: string, parentId: string, value: string, width = 220, color: string = gold) => add({
		id, name: value, parentId, components: [{ type: 'uiElement', kind: 'button', text: value, width, height: 56, fontSize: 24, color, background: '#282031', cornerRadius: 14 }]
	});
	const row = (id: string, parentId: string, width: number) => add({ id, name: 'Controls', parentId, components: [{ type: 'uiElement', kind: 'container', flexDirection: 'row', width, gap: 12, margin: 8 }] });
	const press = (id: string, position: Vec3, action: string, color: string, parentId = WISH.director) => cylinder(id, position, [0.18, 0.08, 0.18], color, {
		parentId, components: [{ type: 'collider', shape: 'sphere' }, { type: 'pressableButton', axis: [0, -1, 0], travel: 0.025, radius: 0.12 }, script(wishPress(action))]
	});

	// Logical root stays at the identity. Every GUI beneath it reaches the same host-authoritative director.
	add({ id: WISH.director, parentId: null, name: 'The Wish Engine', components: [{ type: 'scriptState', data: structuredClone(WISH_INITIAL) }, script(WISH_ENGINE_SCRIPT)] });
	add({ id: 'we-sky', name: 'The Folded Sky', components: [{ type: 'skybox', topColor: '#050711', horizonColor: '#181421', bottomColor: '#070a13', stars: 0.15, ambientIntensity: 0.65 }] });
	add({ id: 'we-preview', name: 'Preview Camera', position: [0, 2.3, 0], components: [{ type: 'previewCamera', fov: 65 }] });

	// A continuous real floor remains beneath every transformation.
	shape('we-floor', 'Observatory Floor', 'disc', [0, 0, 6], [23, 1, 23], ink, { components: [{ type: 'collider', shape: 'box' }] });
	cylinder('we-foundation', [0, -0.24, 6], [23, 0.45, 23], '#0f1020');
	for (const [i, r] of [2.5, 4.4, 7.7, 8.1, 10.5, 11.3].entries()) ring('we-floor-ring-' + i, [0, 0.012, 6], r, i < 2 ? brass : '#51405d', i === 4 ? 0.06 : 0.025);
	for (let i = 0; i < 24; i++) {
		const a = i * Math.PI / 12;
		line(`we-floor-mark-${i}`, [[Math.sin(a) * 7.8, 0.015, 6 + Math.cos(a) * 7.8], [Math.sin(a) * 8.35, 0.015, 6 + Math.cos(a) * 8.35]], gold, 0.035);
	}
	// A compass rose beneath the machine.
	for (let i = 0; i < 8; i++) {
		const a = i * Math.PI / 4;
		line(`we-compass-${i}`, [[Math.sin(a - 0.09) * 1.05, 0.017, 6 + Math.cos(a - 0.09) * 1.05], [Math.sin(a) * 2.3, 0.017, 6 + Math.cos(a) * 2.3], [Math.sin(a + 0.09) * 1.05, 0.017, 6 + Math.cos(a + 0.09) * 1.05]], brass, 0.025);
	}

	// Twelve carved bays. Their walls and columns move together when time returns.
	for (let i = 0; i < 12; i++) {
		const a = i * Math.PI / 6, at: Vec3 = [Math.sin(a) * 9, 0, 6 + Math.cos(a) * 9], id = `we-bay-${i}`;
		group(id, 'Observatory Bay', at, { rotation: eulerToQuat([0, a * 180 / Math.PI, 0]), components: [script(wishAnimation('wall', at, i, [1, 1, 1], a))] });
		box(`${id}-wall`, [0, 3.15, 0.45], [4.72, 6.3, 0.32], i % 2 ? '#201c2d' : '#282131', { parentId: id });
		box(`${id}-inset`, [0, 3.2, 0.23], [2.65, 4.6, 0.09], '#111421', { parentId: id });
		for (const side of [-1, 1]) {
			cylinder(`${id}-column-${side}`, [side * 2.05, 2.8, 0], [0.33, 5.6, 0.33], '#443449', { parentId: id });
			cylinder(`${id}-foot-${side}`, [side * 2.05, 0.24, 0], [0.57, 0.48, 0.57], brass, { parentId: id });
			cylinder(`${id}-capital-${side}`, [side * 2.05, 5.65, 0], [0.64, 0.28, 0.64], brass, { parentId: id });
			line(`${id}-fillet-${side}`, [[side * 2.05, 0.5, -0.18], [side * 2.05, 5.5, -0.18]], '#937054', 0.018, { parentId: id });
		}
		const arch: Vec3[] = [[-1.35, 1, 0.12], [-1.35, 3.8, 0.12]];
		for (let k = 0; k <= 24; k++) { const t = Math.PI - k / 24 * Math.PI; arch.push([Math.cos(t) * 1.35, 3.8 + Math.sin(t) * 1.8, 0.12]); }
		arch.push([1.35, 1, 0.12]);
		line(`${id}-arch`, arch, brass, 0.06, { parentId: id });
		ring(`${id}-sigil`, [0, 3.7, 0.05], 0.45, '#756085', 0.025, 'xy', { parentId: id });
		line(`${id}-sigil-axis`, [[0, 3.1, 0.03], [0, 4.3, 0.03]], gold, 0.025, { parentId: id });
	}
	for (let i = 0; i < 8; i++) {
		const a = i * Math.PI / 4, at: Vec3 = [Math.sin(a) * 4.8, 6.7, 6 + Math.cos(a) * 4.8], id = `we-roof-${i}`;
		group(id, 'Opening Ceiling Petal', at, { components: [script(wishAnimation('roof', at, i, [1, 1, 1], a))] });
		box(`${id}-panel`, [0, 0, 0], [4.15, 0.18, 9.2], '#1a182c', { parentId: id });
		line(`${id}-inlay`, [[-1.9, -0.11, 4.2], [-1.9, -0.11, -3.2], [0, -0.11, -4.2], [1.9, -0.11, -3.2], [1.9, -0.11, 4.2]], brass, 0.035, { parentId: id });
	}
	ring('we-roof-oculus', [0, 6.55, 6], 1.25, gold, 0.06);
	ring('we-roof-inner', [0, 6.55, 6], 0.8, violet, 0.02);

	// The cabinet: a real silhouette, carved base, inset panels, four columns and a crown.
	const machine = 'we-cabinet';
	group(machine, 'The Brass Cabinet', [0, 0, 6.5]);
	box('we-cabinet-plinth', [0, 0.12, 0], [1.85, 0.24, 1.2], brass, { parentId: machine, components: [{ type: 'collider', shape: 'box' }] });
	box('we-cabinet-base', [0, 0.66, 0], [1.5, 0.92, 0.94], wood, { parentId: machine, components: [{ type: 'collider', shape: 'box' }] });
	box('we-cabinet-panel', [0, 0.68, -0.483], [1.25, 0.65, 0.025], '#181925', { parentId: machine });
	box('we-cabinet-sill', [0, 1.16, -0.02], [1.72, 0.14, 1.1], gold, { parentId: machine });
	box('we-cabinet-back', [0, 1.96, 0.45], [1.43, 1.5, 0.07], '#1f1a30', { parentId: machine });
	for (const x of [-0.69, 0.69]) for (const z of [-0.43, 0.43]) {
		const id = `we-cabinet-post-${x}-${z}`;
		cylinder(id, [x, 1.93, z], [0.105, 1.58, 0.105], gold, { parentId: machine });
		for (const y of [1.25, 2.59]) cylinder(`${id}-${y}`, [x, y, z], [0.17, 0.1, 0.17], brass, { parentId: machine });
	}
	shape('we-cabinet-glass', 'Smoked Glass', 'box', [0, 1.95, -0.445], [1.24, 1.41, 0.014], '#837597', { parentId: machine }, 0.1);
	box('we-cabinet-cornice', [0, 2.73, 0], [1.8, 0.22, 1.16], brass, { parentId: machine });
	box('we-cabinet-crown', [0, 2.92, 0.1], [1.55, 0.2, 0.88], wood, { parentId: machine });
	const crown: Vec3[] = Array.from({ length: 33 }, (_, i) => { const a = i / 32 * Math.PI; return [Math.cos(a) * 0.8, 2.96 + Math.sin(a) * 0.55, -0.36]; });
	line('we-cabinet-crown-trim', crown, gold, 0.065, { parentId: machine });
	ring('we-cabinet-crown-eye', [0, 3.13, -0.4], 0.14, pale, 0.03, 'xy', { parentId: machine });
	sphere('we-cabinet-crown-pearl', [0, 3.13, -0.41], [0.09, 0.09, 0.04], teal, { parentId: machine });
	for (let i = 0; i < 3; i++) {
			ring(`we-seal-${i}`, [-0.36 + i * 0.36, 0.45, -0.52], 0.09, '#655170', 0.025, 'xy', { parentId: machine });
			line(`we-seal-mark-${i}`, [[-0.36 + i * 0.36, 0.38, -0.53], [-0.36 + i * 0.36, 0.52, -0.53]], gold, 0.02, { parentId: machine });
	}
	box('we-slot-surround', [0.48, 1.03, 5.99], [0.3, 0.13, 0.045], brass);
	box('we-slot-opening', [0.48, 1.035, 5.96], [0.2, 0.024, 0.018], '#03050c');
	add({ id: 'we-coin-slot', name: 'Coin Slot', position: [0.48, 1.04, 5.94], components: [{ type: 'socket', accepts: ['wish-coin'], radius: 0.35, snap: { position: [0, 0, 0], rotation: [0, 0, 0] }, playMedia: false }] });
	add({ id: 'we-machine-light', name: 'Cabinet Light', position: [0, 2.5, 5.8], components: [{ type: 'pointLight', color: '#eac692', intensity: 0.65, range: 7 }] });

	// Stylized spirit with a carved mask, gold brows, floating hands and trailing ribbons.
	const genie = 'we-genie', genieAt: Vec3 = [0, 1.77, 6.35];
	group(genie, 'The Bound Genie', genieAt, { components: [script(wishAnimation('genie', genieAt))] });
	sphere('we-genie-shoulders', [0, -0.03, 0.08], [0.67, 0.4, 0.3], '#51446c', { parentId: genie });
	sphere('we-genie-body', [0, -0.24, 0.08], [0.4, 0.57, 0.28], '#6d5b89', { parentId: genie });
	sphere('we-genie-mask', [0, 0.28, -0.005], [0.34, 0.49, 0.26], '#ad94b8', { parentId: genie });
	sphere('we-genie-nose', [0, 0.25, -0.14], [0.052, 0.12, 0.063], '#c2a6c7', { parentId: genie });
	line('we-genie-mouth', [[-0.066, 0.14, -0.122], [0, 0.128, -0.144], [0.066, 0.14, -0.122]], '#413247', 0.015, { parentId: genie });
	group('we-genie-eyes', 'Awakened Eyes', [0, 0, 0], { parentId: genie, disabled: true });
	for (const side of [-1, 1]) {
		sphere(`we-genie-eye-shadow-${side}`, [side * 0.074, 0.324, -0.119], [0.102, 0.052, 0.028], '#211c39', { parentId: genie });
		sphere(`we-genie-eye-${side}`, [side * 0.074, 0.324, -0.139], [0.053, 0.023, 0.018], pale, { parentId: 'we-genie-eyes' });
		line(`we-genie-brow-${side}`, [[side * 0.025, 0.385, -0.11], [side * 0.077, 0.396, -0.12], [side * 0.135, 0.366, -0.1]], gold, 0.019, { parentId: genie });
		const hand = `we-genie-hand-${side}`, at: Vec3 = [side * 0.37, -0.1, -0.1];
		group(hand, 'Offering Hand', at, { parentId: genie, components: [script(wishAnimation('hand', at, side))] });
		sphere(`${hand}-palm`, [0, 0, 0], [0.14, 0.075, 0.17], '#ac92bc', { parentId: hand });
		for (let finger = 0; finger < 4; finger++) sphere(`${hand}-finger-${finger}`, [(finger - 1.5) * 0.027, 0.01, -0.095], [0.021, 0.028, 0.1 - Math.abs(finger - 1.5) * 0.018], '#ac92bc', { parentId: hand });
		ring(`${hand}-bracelet`, [0, 0, 0.065], 0.067, gold, 0.016, 'xy', { parentId: hand });
	}
	line('we-genie-crown', [[-0.17, 0.45, 0], [-0.18, 0.63, 0], [-0.07, 0.52, -0.03], [0, 0.7, 0], [0.07, 0.52, -0.03], [0.18, 0.63, 0], [0.17, 0.45, 0]], gold, 0.025, { parentId: genie });
	for (let i = 0; i < 3; i++) {
		const points: Vec3[] = Array.from({ length: 49 }, (_, j) => { const t = j / 48, a = t * Math.PI * 3 + i * 2.1; return [Math.sin(a) * (0.07 + t * 0.17), -0.65 + t * 0.72, Math.cos(a) * (0.07 + t * 0.17) + 0.09]; });
		line(`we-spirit-ribbon-${i}`, points, [violet, teal, gold][i], 0.015, { parentId: genie, components: [script(wishAnimation('ribbon', [0, 0, 0], i))] });
	}
	add({ id: 'we-mist', name: 'Spirit Mist', parentId: genie, position: [0, -0.22, 0], components: [{ type: 'particleEmitter', color: violet, capacity: 100, rate: 16, radius: 0.25, size: 0.5, lifetime: 4, speed: 0.07, opacity: 0.28, active: false }] });
	add({ id: 'we-dust', name: 'Suspended Gold Dust', position: [0, 2.8, 5], components: [{ type: 'particleEmitter', color: pale, capacity: 160, rate: 14, radius: 6, size: 0.065, lifetime: 10, speed: 0.02, opacity: 0.7 }] });

	// The first ritual: tall lanterns and ribbons connecting their flames to the oculus.
	for (const [i, at] of WISH.lamps.entries()) {
		cylinder(`we-lamp-foot-${i}`, [at[0], 0.16, at[2]], [0.72, 0.32, 0.72], brass);
		cylinder(`we-lamp-stem-${i}`, [at[0], 0.78, at[2]], [0.12, 1.15, 0.12], gold);
		cylinder(`we-lamp-bowl-${i}`, [at[0], 1.31, at[2]], [0.49, 0.13, 0.49], brass);
		sphere(`we-lamp-fire-${i}`, at, [0.21, 0.32, 0.21], '#443551');
		ring(`we-lamp-halo-${i}`, at, 0.34, gold, 0.025, 'xy');
		add({ id: `we-lamp-light-${i}`, name: 'Lantern Light', position: at, components: [{ type: 'pointLight', color: '#ffd698', intensity: 0, range: 5 }] });
		const points: Vec3[] = Array.from({ length: 49 }, (_, j) => { const t = j / 48; return [at[0] * (1 - t) + Math.sin(t * Math.PI * 3) * 0.2, at[1] + t * 5, at[2] + (6 - at[2]) * t + Math.sin(t * Math.PI * 2) * 0.2]; });
		line(`we-light-ribbon-${i}`, points, [gold, violet, teal][i], 0.025, { disabled: true });
		panel(`we-lamp-controls-${i}`, 'Lantern Seal', [at[0], 1.05, at[2] - 0.35], 280, 120, 0.55);
		text(`we-lamp-number-${i}`, `we-lamp-controls-${i}`, ['I · DAWN', 'II · MEMORY', 'III · DREAM'][i], 32, 21);
		button(`we-kindle-${i}`, `we-lamp-controls-${i}`, 'Kindle', 240);
		press(`we-lamp-touch-${i}`, [at[0], 1.02, at[2] - 0.44], `we-kindle-${i}`, gold);
	}

	// The second ritual: three independently aligned brass dials.
	box('we-time-desk', [3, 0.89, 5.7], [1.9, 0.17, 0.95], wood);
	for (const x of [2.25, 3.75]) box(`we-time-leg-${x}`, [x, 0.42, 5.7], [0.1, 0.84, 0.5], brass);
	panel('we-time-label', 'The Still Hour', [3, 2.13, 5.81], 660, 90, 1.65);
	text('we-time-title', 'we-time-label', 'THE STILL HOUR', 64, 34, teal);
	for (let i = 0; i < 3; i++) {
		const at: Vec3 = [2.4 + i * 0.6, 1.52, 5.65], id = `we-time-ring-${i}`;
		group(id, 'Time Dial', at, { components: [script(wishAnimation('ring', at, i))] });
		ring(`${id}-rim`, [0, 0, 0], 0.25, gold, 0.032, 'xy', { parentId: id });
		ring(`${id}-inner`, [0, 0, 0.005], 0.19, brass, 0.016, 'xy', { parentId: id });
		line(`${id}-hand`, [[0, 0, -0.015], [0, 0.23, -0.015]], pale, 0.035, { parentId: id });
		sphere(`${id}-hub`, [0, 0, -0.02], [0.075, 0.075, 0.04], teal, { parentId: id });
		sphere(`${id}-target`, [at[0], at[1] + 0.32, at[2]], [0.085, 0.085, 0.085], teal);
		for (let j = 0; j < 4; j++) {
			const a = j * Math.PI / 2;
			line(`${id}-tick-${j}`, [[Math.sin(a) * 0.19, Math.cos(a) * 0.19, -0.01], [Math.sin(a) * 0.235, Math.cos(a) * 0.235, -0.01]], gold, 0.018, { parentId: id });
		}
		press(`we-time-touch-${i}`, [at[0], 1.0, 5.42], `we-turn-${i}`, teal);
	}
	panel('we-time-controls', 'Turn the Dials', [3, 1.05, 5.05], 720, 100, 1.8);
	row('we-time-row', 'we-time-controls', 696);
	for (let i = 0; i < 3; i++) button(`we-turn-${i}`, 'we-time-row', 'Turn', 218, teal);
	for (let i = 0; i < 6; i++) {
		const a = i / 6 * Math.PI * 2, at: Vec3 = [Math.sin(a) * 5.7, 5.4, 6 + Math.cos(a) * 5.7], id = `we-pendulum-${i}`;
		group(id, 'Suspended Hour', at, { components: [script(wishAnimation('pendulum', at, i))] });
		line(`${id}-chain`, [[0, 0, 0], [0, -1.5, 0]], brass, 0.018, { parentId: id });
		sphere(`${id}-weight`, [0, -1.5, 0], [0.13, 0.36, 0.13], gold, { parentId: id });
		ring(`${id}-halo`, [0, -1.5, 0], 0.25, violet, 0.015, 'xy', { parentId: id });
	}

	// The constellation table: matching sockets, real fragments and equivalent laser controls.
	box('we-star-desk', [-3, 0.87, 5], [1.9, 0.2, 1.8], wood);
	for (const x of [-3.75, -2.25]) box(`we-star-leg-${x}`, [x, 0.39, 5], [0.1, 0.78, 1.4], brass);
	panel('we-star-label', 'The Lost Constellation', [-3, 2.14, 5.84], 760, 90, 1.9);
	text('we-star-title', 'we-star-label', 'THE LOST CONSTELLATION', 64, 32, violet);
	line('we-constellation-map', WISH.starSockets, '#7d7696', 0.024);
	for (let i = 0; i < 3; i++) {
		const at = WISH.starSockets[i], color = [gold, teal, violet][i];
		ring(`we-star-target-${i}`, at, 0.16, color, 0.022, 'xy');
		add({ id: `we-star-socket-${i}`, name: ['Dawn Socket', 'Moon Socket', 'Dusk Socket'][i], position: at, components: [{ type: 'socket', accepts: [`wish-star-${i}`], radius: 0.24, snap: { position: [0, 0, 0], rotation: [0, 0, 0] }, playMedia: false }] });
		press(`we-star-touch-${i}`, [-3.5 + i * 0.5, 1.0, 4.25], `we-place-${i}`, color);
	}
	panel('we-star-controls', 'Return the Stars', [-3, 1.19, 4.01], 720, 100, 1.8);
	row('we-star-row', 'we-star-controls', 696);
	for (let i = 0; i < 3; i++) button(`we-place-${i}`, 'we-star-row', ['Dawn', 'Moon', 'Dusk'][i], 218, [gold, teal, violet][i]);

	// Coin tray and wishing bowl are near the visitor; no climbing or long reach is required.
	cylinder('we-coin-pedestal', [0.85, 0.47, 4.1], [0.12, 0.94, 0.12], brass);
	cylinder('we-coin-tray', [0.85, 0.98, 4.1], [0.5, 0.06, 0.5], gold);
	ring('we-coin-tray-lip', [0.85, 1.025, 4.1], 0.24, pale, 0.027);
	cylinder('we-bowl-stem', [0, 0.45, 4.8], [0.13, 0.9, 0.13], brass);
	cylinder('we-bowl', [0, 0.94, 4.8], [0.65, 0.15, 0.65], brass);
	ring('we-bowl-lip', [0, 1.02, 4.8], 0.32, gold, 0.04);
	add({ id: 'we-wish-bowl', name: 'The Last Wish', position: [0, 1.03, 4.8], components: [{ type: 'socket', accepts: ['wish-coin'], radius: 0.34, snap: { position: [0, 0, 0], rotation: [0, 0, 0] }, playMedia: false }] });
	add({ id: 'we-bowl-light', name: 'The Returned Wish', position: [0, 1.13, 4.8], disabled: true, components: [{ type: 'particleEmitter', color: pale, capacity: 40, rate: 6, radius: 0.22, size: 0.1, lifetime: 3, speed: 0.03 }] });
	sphere('we-keepsake', [0, 1.24, 4.8], [0.06, 0.06, 0.06], pale, { disabled: true, components: [script(wishAnimation('mote', [0, 1.24, 4.8]))] });
	slots.push(...wishObjects());

	// Distant scenery unfolds from small gestures at the tables.
	for (let i = 0; i < 3; i++) {
		const at: Vec3 = [[-11, 12, 26], [0, 19, 36], [12, 10, 30]][i] as Vec3, id = `we-sky-star-${i}`, color = [gold, teal, violet][i];
		group(id, 'Restored Star', at, { components: [script(wishAnimation('star', at, i))] });
		sphere(`${id}-core`, [0, 0, 0], [1.4, 1.4, 1.4], color, { parentId: id });
		ring(`${id}-halo`, [0, 0, 0], 2.1, color, 0.06, 'xy', { parentId: id });
		for (let k = 0; k < 8; k++) {
			const a = k * Math.PI / 4;
			line(`${id}-ray-${k}`, [[Math.sin(a) * 1.2, Math.cos(a) * 1.2, 0], [Math.sin(a) * (k % 2 ? 2.7 : 3.6), Math.cos(a) * (k % 2 ? 2.7 : 3.6), 0]], color, 0.045, { parentId: id });
		}
		const center: Vec3 = [0, 13, 32], orbit = `we-orbit-${i}`;
		group(orbit, 'Celestial Orbit', center, { components: [script(wishAnimation('orbit', center, i))] });
		ring(`${orbit}-path`, [0, 0, 0], 8 + i * 3.5, color, 0.06, 'xz', { parentId: orbit });
		sphere(`${orbit}-moon`, [8 + i * 3.5, 0, 0], [0.7 + i * 0.25, 0.7 + i * 0.25, 0.7 + i * 0.25], color, { parentId: orbit });
	}
	add({ id: 'we-cosmos-dust', name: 'Constellation Dust', position: [0, 10, 24], components: [{ type: 'particleEmitter', color: teal, capacity: 200, rate: 22, radius: 12, size: 0.14, lifetime: 8, speed: 0.12, opacity: 0.8, active: false }] });
	const eclipseAt: Vec3 = [0, 20, 56];
	group('we-eclipse', 'The Opening Eclipse', eclipseAt, { components: [script(wishAnimation('eclipse', eclipseAt))] });
	sphere('we-eclipse-sun', [0, 0, 0], [13, 13, 0.3], pale, { parentId: 'we-eclipse' });
	group('we-eclipse-shadow', 'Passing Shadow', [0, 0, -0.3], { parentId: 'we-eclipse', components: [script(wishAnimation('moon', [0, 0, -0.3]))] });
	sphere('we-eclipse-moon', [0, 0, 0], [12.8, 12.8, 0.3], '#101321', { parentId: 'we-eclipse-shadow' });
	ring('we-eclipse-corona', [0, 0, -0.1], 6.8, gold, 0.08, 'xy', { parentId: 'we-eclipse' });
	group('we-freed-stars', 'The Freed Constellation', [0, 0, 0], { disabled: true });
	const constellation: Vec3[] = [[-4, 15, 32], [-2, 19, 32], [0, 22, 32], [2, 19, 32], [4, 15, 32], [0, 17, 32], [-4, 15, 32]];
	line('we-freed-outline', constellation, pale, 0.05, { parentId: 'we-freed-stars' });
	for (const [i, p] of constellation.slice(0, -1).entries()) sphere(`we-freed-pearl-${i}`, p, [0.3, 0.3, 0.3], pale, { parentId: 'we-freed-stars' });
	for (let i = 0; i < 7; i++) {
		const points: Vec3[] = Array.from({ length: 81 }, (_, j) => { const t = j / 80; return [(t - 0.5) * 110, 16 + Math.sin(t * Math.PI * 3 + i * 0.25) * 6 + i * 0.4, 50 + Math.cos(t * Math.PI) * 10]; });
		line(`we-aurora-${i}`, points, [teal, '#82b9cf', violet, '#b6a2d2', gold, '#a1d9d0', '#d8c2ef'][i], 0.12 + i * 0.025, { components: [script(wishAnimation('aurora', [0, 0, 0], i))] });
	}
	for (let i = 0; i < 2; i++) ring(`we-wave-${i}`, [0, 0.02, 6], 0.65 + i * 0.05, i ? violet : gold, 0.02, 'xz', { components: [script(wishAnimation('wave', [0, 0.02, 6], i))] });

	// Diegetic inscriptions and controls. Every action works with mouse, laser, or the physical seals.
	panel('we-title-panel', 'Chapter Inscription', [0, 2.62, 5.9], 1000, 120, 1.9);
	text('we-chapter', 'we-title-panel', 'THE WISH ENGINE', 64, 43);
	text('we-title-sub', 'we-title-panel', 'LIGHT  /  TIME  /  SKY', 32, 23, '#a997b8');
	box('we-voice-frame', [-1.48, 1.86, 6.04], [1.35, 0.5, 0.045], brass);
	panel('we-voice-panel', 'The Genie Speaks', [-1.48, 1.86, 6], 660, 230, 1.27, '#100e1bf5');
	text('we-voice', 'we-voice-panel', 'A small coin. An impossible sky.', 185, 34);
	panel('we-guide', 'The Wishing Lectern', [1.42, 1.55, 5.7], 760, 610, 1.46, '#171220f5');
	text('we-guide-label', 'we-guide', 'THE WISHING RITUAL', 48, 28, gold);
	text('we-instruction', 'we-guide', 'Take the coin from the tray and place it in the brass slot.', 138, 28, '#e0d7e7');
	button('we-start', 'we-guide', 'Insert the coin', 640);
	button('we-release', 'we-guide', 'Give the final wish', 640);
	button('we-again', 'we-guide', 'Begin again', 640);
	button('we-recall', 'we-guide', 'Return lost objects', 640, '#b8a3ca');
	row('we-options', 'we-guide', 640);
	button('we-sound', 'we-options', 'Sound: on', 310, '#b8a3ca');
	button('we-gentle', 'we-options', 'Effects: full', 310, '#b8a3ca');
	button('we-reset', 'we-guide', 'Restart journey', 640, '#9d899f');
	box('we-guide-post', [1.42, 0.61, 5.8], [0.12, 1.22, 0.12], brass);
	cylinder('we-guide-foot', [1.42, 0.09, 5.8], [0.65, 0.18, 0.65], brass);
	// Avoid three overlapping call-to-action buttons before the director's first frame.
	for (const id of ['we-release', 'we-again']) {
		const c = slots.find((slot) => slot.id === id)!.components[0];
		if (c.type === 'uiElement') c.visible = false;
	}
	// Stars and flames remain luminous in the dark, with no extra scene lights.
	for (const slot of slots) {
		if (/^we-(sky-star-\d-core|orbit-\d-moon|genie-eye--?1|freed-pearl-\d|lamp-fire-\d|keepsake|eclipse-sun|eclipse-moon)$/.test(slot.id)) {
			const mesh = slot.components.find((c) => c.type === 'meshRenderer');
			if (mesh?.type === 'meshRenderer') mesh.unlit = true;
		}
	}
	return slots;
}
