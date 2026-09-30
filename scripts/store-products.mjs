// The Pop Up Store's products: what each is made of, what it does (its codeBlock script), and the display stand script
// that keeps one on every stand. Used by generate-pop-up-store.mjs.
//
// A product is a slot tree whose root sits at its base (y = 0 is where it rests), facing +Z: the side shown to shoppers.
// A held product's trigger reaches its scripts (hand-held or equipped), so every toy does something when "squeezed".

import { TOOLS, toolEquippable } from './workshop-tools.mjs';
import { pitch, yaw } from './world-kit.mjs';

const ALONG_Z = pitch(Math.PI / 2); // a cylinder (along Y) turned to lie along +Z
const mesh = (id, color) => ({ type: 'meshRenderer', meshRef: { kind: 'builtin', id }, ...(color ? { color } : {}) });

/** Shared by the toys' scripts: their parts, a sparkle and a sound. */
const TOY_PRELUDE = String.raw`
const SELF = ctx.self.id;
function part(name) { return ctx.hierarchy.getChildren(SELF).find((c) => c.name === name) || null; }
function partPose(name) { const p = part(name); return p ? ctx.hierarchy.getWorldPose(p.id) : null; }
const round3 = (v) => Math.round(v * 1000) / 1000;
function sparkle(position, color, count, ms) {
  ctx.world.spawn({ name: 'Sparkle', position: position.map(round3), components: [{ type: 'particleBurst', color, count, durationMs: ms }, { type: 'expires', expiresAt: Date.now() + ms }] });
}
const inHand = () => ctx.grab.isHeld() || ctx.equip.isEquipped();
`;
const toyScript = (body) => `${TOY_PRELUDE}\n${body.trim()}\n`;

// --- toys -------------------------------------------------------------------------------------------------------------

const SQUEAK = String.raw`
return {
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    ctx.audio.play({ frequency: 1250, pitchDrop: 800, noiseMix: 0.1, durationMs: 190, volume: 0.5 });
    sparkle(ctx.self.getWorldPosition(), COLOR, 8, 400);
    return true;
  }
};
`;

const PARTY_POPPER = String.raw`
const COLORS = ['#f43f5e', '#facc15', '#22d3ee', '#a3e635', '#c084fc'];
let cooldown = 0;
return {
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    if (cooldown > 0) { ctx.audio.play({ frequency: 200, durationMs: 60, volume: 0.2 }); return true; }
    const muzzle = partPose('Muzzle');
    if (!muzzle) return true;
    // Confetti thrown ahead: bursts of colour further and further out along the popper.
    COLORS.forEach((color, i) => sparkle(ctx.math.vecAdd(muzzle.position, ctx.math.vecScale(muzzle.forward, 0.08 + i * 0.12)), color, 26, 900));
    ctx.audio.play({ noiseMix: 1, durationMs: 140, volume: 0.7 });
    cooldown = 1.5;
    return true;
  },
  tick(dt) { if (cooldown > 0) cooldown -= dt; }
};
`;

const BUBBLE_WAND = String.raw`
let blowing = false;
let every = 0;
return {
  onTrigger(e) {
    if (e.phase === 'press') blowing = true;
    else if (e.phase === 'release') blowing = false;
    return true;
  },
  tick(dt) {
    if (!blowing || !ctx.world.isHost()) return;
    if (!inHand()) { blowing = false; return; }
    every -= dt;
    if (every > 0) return;
    every = 0.12;
    const ring = partPose('Ring');
    if (!ring) return;
    const size = round3(0.03 + Math.random() * 0.05);
    const drift = [(Math.random() - 0.5) * 0.12, 0.1 + Math.random() * 0.08, (Math.random() - 0.5) * 0.12];
    const linear = ctx.math.vecAdd(ctx.math.vecScale(ring.forward, 0.35), drift).map(round3);
    // Bubbles drift off, slow down and vanish; nothing else touches them.
    ctx.world.spawn({
      name: 'Bubble',
      position: ring.position.map(round3),
      scale: [size, size, size],
      components: [
        { type: 'meshRenderer', meshRef: { kind: 'builtin', id: 'sphere' }, color: '#bae6fd' },
        { type: 'velocity', linear, drag: 0.35 },
        { type: 'expires', expiresAt: Date.now() + 3200 + Math.random() * 1500 }
      ]
    });
  }
};
`;

const BALLOON = String.raw`
const RISE = 0.3;
const CEILING = 5.2;
let floating = false;
function pop() {
  const balloon = partPose('Balloon');
  sparkle(balloon ? balloon.position : ctx.self.getWorldPosition(), COLOR, 30, 500);
  ctx.audio.play({ noiseMix: 1, durationMs: 110, volume: 0.6 });
  ctx.world.deleteSelf();
}
return {
  // Let go, a balloon floats up, and pops when it reaches the roof. Squeeze it to pop it in the hand.
  onGrab() { floating = false; ctx.world.setComponentField(SELF, 'velocity', 'linear', [0, 0, 0]); },
  onRelease() { floating = true; ctx.world.setComponentField(SELF, 'velocity', 'linear', [0, RISE, 0]); },
  onTrigger(e) { if (e.phase === 'press') pop(); return true; },
  tick() {
    if (floating && ctx.world.isHost() && ctx.self.getWorldPosition()[1] > CEILING) pop();
  }
};
`;

const MAGIC_BALL = String.raw`
const ANSWERS = ['It is certain', 'Without a doubt', 'Yes, definitely', 'Most likely', 'Signs point to yes', 'Outlook good',
  'Ask again later', 'Cannot predict now', 'Concentrate and ask again', 'Reply hazy, try again',
  "Don't count on it", 'My sources say no', 'Very doubtful', 'Outlook not so good'];
let thinking = 0;
function show(text) { const w = part('Window'); if (w) ctx.world.setComponentField(w.id, 'textDisplay', 'title', text); }
return {
  onTrigger(e) {
    if (e.phase !== 'press' || thinking > 0) return true;
    thinking = 0.9;
    show('...');
    ctx.audio.play({ noiseMix: 0.8, durationMs: 300, volume: 0.35 });
    return true;
  },
  tick(dt) {
    if (thinking <= 0 || !ctx.world.isHost()) return;
    thinking -= dt;
    if (thinking > 0) return;
    show(ANSWERS[Math.floor(Math.random() * ANSWERS.length)]);
    ctx.audio.play({ frequency: 880, pitchDrop: -220, noiseMix: 0, durationMs: 260, volume: 0.35 });
  }
};
`;

/** The spinner's rotor turns itself about its own axis: a push of the trigger speeds it up, and it slows down alone. */
const SPINNER_ROTOR = String.raw`
const SELF = ctx.self.id;
let speed = 0;
let angle = 0;
return {
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    speed = Math.min(40, speed + 14);
    ctx.audio.play({ frequency: 180, pitchDrop: -260, noiseMix: 0.5, durationMs: 260, volume: 0.3 });
    return true;
  },
  tick(dt) {
    if (speed <= 0.01) return;
    angle += speed * dt;
    speed = Math.max(0, speed - 3 * dt);
    const parent = ctx.hierarchy.getParent(SELF);
    const base = parent ? ctx.hierarchy.getWorldPose(parent.id).rotation : [0, 0, 0, 1];
    ctx.self.setWorldRotation(ctx.math.quatMultiply(base, ctx.math.quatFromAxisAngle([0, 1, 0], angle)));
  }
};
`;

const MARACAS = String.raw`
let last = null;
let lastVelocity = null;
let cooldown = 0;
const rattle = () => { ctx.audio.play({ noiseMix: 1, durationMs: 80, volume: 0.45 }); cooldown = 0.11; };
return {
  onTrigger(e) { if (e.phase === 'press') rattle(); return true; },
  // Shaken hard (a sharp change of speed), it rattles.
  tick(dt) {
    if (!ctx.world.isHost() || dt <= 0) return;
    cooldown -= dt;
    const here = ctx.self.getWorldPosition();
    if (!inHand()) { last = null; lastVelocity = null; return; }
    if (last) {
      const velocity = ctx.math.vecScale(ctx.math.vecSub(here, last), 1 / dt);
      if (lastVelocity && cooldown <= 0 && ctx.math.vecLength(ctx.math.vecSub(velocity, lastVelocity)) / dt > 30) rattle();
      lastVelocity = velocity;
    }
    last = here;
  }
};
`;

const DICE = String.raw`
let rolling = 0;
let axis = [0, 1, 0];
const QUARTER = Math.PI / 2;
// Any of the 24 ways a die can lie square: a number of quarter turns about each axis.
function squareTurn() {
  const q = (a, n) => ctx.math.quatFromAxisAngle(a, n * QUARTER);
  const pick = () => Math.floor(Math.random() * 4);
  return ctx.math.quatMultiply(q([0, 0, 1], pick()), ctx.math.quatMultiply(q([0, 1, 0], pick()), q([1, 0, 0], pick())));
}
return {
  onTrigger(e) {
    if (e.phase !== 'press' || rolling > 0) return true;
    rolling = 0.7;
    axis = ctx.math.vecNormalize([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    return true;
  },
  tick(dt) {
    if (rolling <= 0 || !ctx.world.isHost()) return;
    rolling -= dt;
    if (rolling > 0) {
      ctx.self.setWorldRotation(ctx.math.quatMultiply(ctx.math.quatFromAxisAngle(axis, 14 * dt), ctx.self.getWorldRotation()));
      return;
    }
    ctx.self.setWorldRotation(squareTurn());
    ctx.audio.play({ frequency: 500, pitchDrop: 200, noiseMix: 0.4, durationMs: 70, volume: 0.4 });
  }
};
`;

const GLOW_WAND = String.raw`
const COLORS = [['Cyan', '#22d3ee'], ['Pink', '#f472b6'], ['Lime', '#a3e635'], ['Orange', '#fb923c'], ['Violet', '#a78bfa']];
let color = 0;
let on = false;
function paint() { const blade = part('Blade'); if (blade) ctx.world.setComponentField(blade.id, 'meshRenderer', 'color', on ? COLORS[color][1] : '#334155'); }
return {
  onSpawn() { paint(); },
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    on = !on;
    paint();
    ctx.audio.play({ frequency: on ? 220 : 160, pitchDrop: on ? -180 : 120, noiseMix: 0.2, durationMs: 220, volume: 0.35 });
    return true;
  },
  getRadialItems() {
    return [{ label: 'Color: ' + COLORS[color][0], isEnabled: () => true, onSelect: () => { color = (color + 1) % COLORS.length; paint(); } }];
  }
};
`;

const ROCKET = String.raw`
const FUSE_S = 1.2;
let fuse = 0;
let flying = false;
let flight = 0;
let sparks = 0;
function nozzle() { const n = partPose('Nozzle'); return n ? n.position : ctx.self.getWorldPosition(); }
function launch() {
  const up = ctx.hierarchy.getWorldPose(SELF).up;
  flying = true;
  ctx.world.setComponentField(SELF, 'velocity', 'linear', ctx.math.vecScale(up, 3).map(round3));
  ctx.audio.play({ noiseMix: 0.9, frequency: 120, pitchDrop: -300, durationMs: 700, volume: 0.6 });
}
function burst() {
  const at = ctx.self.getWorldPosition();
  for (const color of ['#f43f5e', '#facc15', '#38bdf8', '#a3e635']) sparkle(at, color, 40, 1400);
  ctx.audio.play({ noiseMix: 1, durationMs: 300, volume: 0.8 });
  ctx.world.deleteSelf();
}
return {
  // Squeeze to light the fuse; let go and it takes off, then bursts into a firework.
  onTrigger(e) {
    if (e.phase === 'press' && fuse <= 0 && !flying) { fuse = FUSE_S; ctx.audio.play({ noiseMix: 1, durationMs: 400, volume: 0.25 }); }
    return true;
  },
  tick(dt) {
    if (!ctx.world.isHost()) return;
    sparks -= dt;
    if ((fuse > 0 || flying) && sparks <= 0) { sparks = 0.08; sparkle(nozzle(), '#fb923c', 6, 300); }
    if (fuse > 0) {
      fuse -= dt;
      if (fuse <= 0) launch();
      return;
    }
    // Still held when it launched: it waits to be let go before it goes.
    if (flying && !inHand()) {
      flight += dt;
      if (flight > 2.5) burst();
    }
  }
};
`;

const DISCO_BALL = String.raw`
const COLORS = ['#f472b6', '#38bdf8', '#facc15', '#a78bfa', '#4ade80'];
return {
  onTrigger(e) {
    if (e.phase !== 'press') return true;
    const at = ctx.self.getWorldPosition();
    COLORS.forEach((color, i) => sparkle(ctx.math.vecAdd(at, [Math.cos(i * 1.26) * 0.4, 0.3 + (i % 2) * 0.2, Math.sin(i * 1.26) * 0.4]), color, 20, 900));
    ctx.audio.play({ frequency: 660, pitchDrop: -440, noiseMix: 0.1, durationMs: 400, volume: 0.4 });
    return true;
  }
};
`;

/** The mirror ball turns itself slowly about its hanging axis, on every peer (a look, not something to send around). */
const MIRROR_BALL_SPIN = String.raw`
const SELF = ctx.self.id;
let angle = 0;
return {
  tick(dt) {
    angle += dt * 0.6;
    const parent = ctx.hierarchy.getParent(SELF);
    const base = parent ? ctx.hierarchy.getWorldPose(parent.id).rotation : [0, 0, 0, 1];
    ctx.self.setWorldRotation(ctx.math.quatMultiply(base, ctx.math.quatFromAxisAngle([0, 1, 0], angle)));
  }
};
`;

// --- building blocks --------------------------------------------------------------------------------------------------

const piece = (name, meshId, color, position, scale, rotation) => ({ name, mesh: meshId, color, position, scale, rotation });
const point = (name, position) => ({ name, position });

/** A toy: a grabbable (and scalable) object that can also be equipped, with its fingers closing round it. */
function toy(id, name, parts, code, { equip = { position: [0, -0.02, 0.06], rotation: [0, 0, 0] }, scalable = true, extra = [], scale } = {}) {
	return {
		id,
		name,
		scale,
		components: [
			{ type: 'container' },
			{ type: 'grabbable', scalable },
			...(equip ? [{ type: 'equippable', left: equip, right: equip, autoGrip: true }] : []),
			...extra,
			...(code ? [{ type: 'codeBlock', code }] : [])
		],
		parts
	};
}

const WAND = { position: [0, 0, 0.04], rotation: [15, 0, 0] };
const colored = (code, color) => code.replace('return {', `const COLOR = '${color}';\nreturn {`);

function rubberDuck(id = 'rubber-duck', name = 'Rubber Duck', scale) {
	return toy(id, name, [
		piece('Body', 'sphere', '#facc15', [0, 0.055, 0], [0.14, 0.11, 0.16]),
		piece('Head', 'sphere', '#facc15', [0, 0.13, 0.04], [0.09, 0.09, 0.09]),
		piece('Beak', 'box', '#f97316', [0, 0.125, 0.095], [0.05, 0.016, 0.04]),
		piece('Eye', 'sphere', '#111827', [0.022, 0.145, 0.078], [0.014, 0.014, 0.014]),
		piece('Eye', 'sphere', '#111827', [-0.022, 0.145, 0.078], [0.014, 0.014, 0.014]),
		piece('Tail', 'sphere', '#facc15', [0, 0.09, -0.075], [0.05, 0.05, 0.04])
	], toyScript(colored(SQUEAK, '#fde047')), { scale });
}

function teddyBear(id = 'teddy-bear', name = 'Teddy Bear', scale) {
	const fur = '#b7793f', light = '#e8c39e';
	return toy(id, name, [
		piece('Body', 'sphere', fur, [0, 0.075, 0], [0.13, 0.15, 0.11]),
		piece('Belly', 'sphere', light, [0, 0.07, 0.035], [0.08, 0.09, 0.05]),
		piece('Head', 'sphere', fur, [0, 0.19, 0], [0.11, 0.1, 0.1]),
		piece('Snout', 'sphere', light, [0, 0.18, 0.045], [0.045, 0.035, 0.035]),
		piece('Nose', 'sphere', '#1f1208', [0, 0.19, 0.063], [0.016, 0.012, 0.012]),
		piece('Eye', 'sphere', '#1f1208', [0.022, 0.21, 0.045], [0.012, 0.012, 0.012]),
		piece('Eye', 'sphere', '#1f1208', [-0.022, 0.21, 0.045], [0.012, 0.012, 0.012]),
		piece('Ear', 'sphere', fur, [0.042, 0.24, 0], [0.04, 0.04, 0.025]),
		piece('Ear', 'sphere', fur, [-0.042, 0.24, 0], [0.04, 0.04, 0.025]),
		piece('Arm', 'sphere', fur, [0.07, 0.09, 0.01], [0.045, 0.08, 0.045]),
		piece('Arm', 'sphere', fur, [-0.07, 0.09, 0.01], [0.045, 0.08, 0.045]),
		piece('Leg', 'sphere', fur, [0.04, 0.02, 0.03], [0.05, 0.045, 0.07]),
		piece('Leg', 'sphere', fur, [-0.04, 0.02, 0.03], [0.05, 0.045, 0.07])
	], toyScript(colored(SQUEAK.replace('frequency: 1250, pitchDrop: 800, noiseMix: 0.1', 'frequency: 420, pitchDrop: 180, noiseMix: 0.35'), '#fcd9b6')), { scale });
}

function balloon(color, name) {
	return toy(`balloon-${name.toLowerCase()}`, `${name} Balloon`, [
		piece('String', 'cylinder', '#e5e7eb', [0, 0.2, 0], [0.004, 0.4, 0.004]),
		piece('Knot', 'sphere', color, [0, 0.41, 0], [0.025, 0.025, 0.025]),
		piece('Balloon', 'sphere', color, [0, 0.56, 0], [0.26, 0.3, 0.26])
	], toyScript(colored(BALLOON, color)), { equip: null, extra: [{ type: 'velocity', linear: [0, 0, 0], drag: 0 }] });
}

// The magic ball's window is read from the holder's side (-Z): a plane is seen from its -Z side unturned.
const magicBall = () =>
	toy('magic-ball', 'Magic 8-Ball', [
		piece('Ball', 'sphere', '#0f172a', [0, 0.08, 0], [0.16, 0.16, 0.16]),
		piece('Eight', 'sphere', '#f8fafc', [0, 0.08, 0.071], [0.05, 0.05, 0.03]),
		{ ...piece('Window', 'plane', '#1e1b4b', [0, 0.08, -0.081], [0.075, 0.075, 1]), textDisplay: { title: 'Ask me', lines: [], color: '#1e1b4b', scale: 1.6 } }
	], toyScript(MAGIC_BALL));

const fidgetSpinner = () =>
	toy('fidget-spinner', 'Fidget Spinner', [
		{
			name: 'Rotor',
			position: [0, 0.012, 0],
			code: SPINNER_ROTOR,
			children: [
				piece('Hub', 'cylinder', '#e5e7eb', [0, 0, 0], [0.03, 0.014, 0.03]),
				...[0, 1, 2].map((i) => {
					const a = (i * 2 * Math.PI) / 3;
					return piece('Lobe', 'cylinder', '#06b6d4', [Math.sin(a) * 0.035, 0, Math.cos(a) * 0.035], [0.032, 0.01, 0.032]);
				}),
				piece('Arm', 'box', '#0891b2', [0, 0, 0], [0.012, 0.008, 0.07], yaw(0)),
				piece('Arm', 'box', '#0891b2', [0, 0, 0], [0.012, 0.008, 0.07], yaw(Math.PI / 3)),
				piece('Arm', 'box', '#0891b2', [0, 0, 0], [0.012, 0.008, 0.07], yaw((2 * Math.PI) / 3))
			]
		}
	], null, { equip: { position: [0, 0.01, 0.05], rotation: [0, 0, 0] } });

const partyPopper = () =>
	toy('party-popper', 'Party Popper', [
		piece('Cone', 'cylinder', '#f43f5e', [0, 0, 0.04], [0.045, 0.14, 0.045], ALONG_Z),
		piece('Stripe', 'cylinder', '#facc15', [0, 0, 0.02], [0.047, 0.012, 0.047], ALONG_Z),
		piece('Stripe', 'cylinder', '#facc15', [0, 0, 0.07], [0.047, 0.012, 0.047], ALONG_Z),
		piece('Cap', 'cylinder', '#fde68a', [0, 0, 0.112], [0.05, 0.006, 0.05], ALONG_Z),
		point('Muzzle', [0, 0, 0.12])
	], toyScript(PARTY_POPPER), { equip: WAND });

const bubbleWand = () =>
	toy('bubble-wand', 'Bubble Wand', [
		piece('Handle', 'cylinder', '#a78bfa', [0, 0, 0], [0.016, 0.18, 0.016], ALONG_Z),
		piece('Ring', 'cylinder', '#7dd3fc', [0, 0, 0.12], [0.075, 0.006, 0.075], ALONG_Z),
		piece('Film', 'cylinder', '#e0f2fe', [0, 0, 0.121], [0.06, 0.004, 0.06], ALONG_Z)
	], toyScript(BUBBLE_WAND), { equip: WAND });

const maracas = () =>
	toy('maracas', 'Maracas', [
		piece('Handle', 'cylinder', '#92400e', [0, 0, 0], [0.022, 0.13, 0.022], ALONG_Z),
		piece('Head', 'sphere', '#f97316', [0, 0, 0.1], [0.075, 0.075, 0.09]),
		piece('Band', 'cylinder', '#22c55e', [0, 0, 0.1], [0.078, 0.014, 0.078], ALONG_Z)
	], toyScript(MARACAS), { equip: WAND });

function dice() {
	const h = 0.036, g = 0.017, pip = [0.013, 0.013, 0.013];
	// One pip, or a pattern, on each face: opposite faces add up to seven.
	const patterns = { 1: [[0, 0]], 2: [[-g, -g], [g, g]], 3: [[-g, -g], [0, 0], [g, g]], 4: [[-g, -g], [-g, g], [g, -g], [g, g]], 5: [[-g, -g], [-g, g], [0, 0], [g, -g], [g, g]], 6: [[-g, -g], [-g, 0], [-g, g], [g, -g], [g, 0], [g, g]] };
	const faces = [[1, (a, b) => [a, h, b]], [6, (a, b) => [a, -h, b]], [2, (a, b) => [h, a, b]], [5, (a, b) => [-h, a, b]], [3, (a, b) => [a, b, h]], [4, (a, b) => [a, b, -h]]];
	const pips = faces.flatMap(([n, at]) => patterns[n].map(([a, b]) => piece('Pip', 'sphere', '#111827', at(a, b).map((v, i) => v + (i === 1 ? h : 0)), pip)));
	return toy('dice', 'Big Die', [piece('Cube', 'box', '#f8fafc', [0, h, 0], [0.072, 0.072, 0.072]), ...pips], toyScript(DICE));
}

const glowWand = () =>
	toy('glow-wand', 'Glow Wand', [
		piece('Grip', 'cylinder', '#1f2937', [0, 0, 0], [0.028, 0.14, 0.028], ALONG_Z),
		piece('Guard', 'cylinder', '#9ca3af', [0, 0, 0.075], [0.045, 0.01, 0.045], ALONG_Z),
		piece('Blade', 'cylinder', '#334155', [0, 0, 0.3], [0.024, 0.44, 0.024], ALONG_Z)
	], toyScript(GLOW_WAND), { equip: WAND });

const toyRocket = () =>
	toy('toy-rocket', 'Toy Rocket', [
		piece('Body', 'cylinder', '#e5e7eb', [0, 0.15, 0], [0.06, 0.22, 0.06]),
		piece('Nose', 'sphere', '#ef4444', [0, 0.27, 0], [0.06, 0.09, 0.06]),
		piece('Window', 'sphere', '#38bdf8', [0, 0.19, 0.028], [0.024, 0.024, 0.012]),
		...[0, 1, 2].map((i) => {
			const a = (i * 2 * Math.PI) / 3;
			return piece('Fin', 'box', '#ef4444', [Math.sin(a) * 0.04, 0.06, Math.cos(a) * 0.04], [0.005, 0.07, 0.04], yaw(a));
		}),
		point('Nozzle', [0, 0.03, 0])
	], toyScript(ROCKET), { equip: null, extra: [{ type: 'velocity', linear: [0, 0, 0], drag: 0 }] });

const discoBall = () =>
	toy('disco-ball', 'Disco Ball', [
		piece('Cap', 'cylinder', '#9ca3af', [0, 0.47, 0], [0.06, 0.04, 0.06]),
		{ ...piece('Mirror Ball', 'sphere', '#e2e8f0', [0, 0.24, 0], [0.44, 0.44, 0.44]), code: MIRROR_BALL_SPIN, children: [
			piece('Tile Band', 'cylinder', '#94a3b8', [0, 0, 0], [1.01, 0.08, 1.01]),
			piece('Tile Band', 'cylinder', '#cbd5e1', [0, 0.25, 0], [0.88, 0.06, 0.88]),
			piece('Tile Band', 'cylinder', '#cbd5e1', [0, -0.25, 0], [0.88, 0.06, 0.88])
		] }
	], toyScript(DISCO_BALL), { equip: null });

/** A Workshop tool, as a product: taken home it works anywhere (it only goes back to a bench in the Workshop). */
function toolProduct(tool) {
	return {
		id: `tool-${tool.id}`,
		name: tool.name,
		// Lying along the shelf, its working end to the shopper's left.
		rotation: yaw(Math.PI / 2),
		components: [{ type: 'container' }, { type: 'grabbable', scalable: false }, toolEquippable(), { type: 'codeBlock', code: tool.code }],
		parts: tool.parts.map((p) => ({ name: p.name, mesh: p.mesh, color: p.color, position: p.position, rotation: p.rotation, scale: p.scale, collider: p.collider, textDisplay: p.textDisplay }))
	};
}

export const PRODUCTS = Object.fromEntries(
	[
		rubberDuck(),
		rubberDuck('giant-duck', 'Giant Rubber Duck', [3, 3, 3]),
		teddyBear(),
		teddyBear('giant-teddy', 'Giant Teddy Bear', [2.6, 2.6, 2.6]),
		balloon('#ef4444', 'Red'),
		balloon('#3b82f6', 'Blue'),
		balloon('#facc15', 'Yellow'),
		magicBall(),
		fidgetSpinner(),
		partyPopper(),
		bubbleWand(),
		maracas(),
		dice(),
		glowWand(),
		toyRocket(),
		discoBall(),
		...TOOLS.map(toolProduct)
	].map((product) => [product.id, product])
);

/** The product as the slots it is made of (its root first), with ids to be replaced on every copy. */
export function productSlots(product) {
	const slots = [];
	const add = (p, parentId, index) => {
		const id = parentId ? `${parentId}-${index}` : product.id;
		slots.push({
			id,
			parentId,
			name: p.name,
			position: p.position ?? [0, 0, 0],
			rotation: p.rotation ?? [0, 0, 0, 1],
			scale: p.scale ?? [1, 1, 1],
			components: parentId
				? [
						...(p.mesh ? [mesh(p.mesh, p.color)] : []),
						...(p.collider ? [{ type: 'collider', shape: 'box' }] : []),
						...(p.textDisplay ? [{ type: 'textDisplay', ...p.textDisplay }] : []),
						...(p.code ? [{ type: 'codeBlock', code: p.code }] : [])
					]
				: product.components
		});
		(p.children ?? p.parts ?? []).forEach((child, i) => add(child, id, i));
	};
	add(product, null, 0);
	return slots;
}

/**
 * A display stand's script: it keeps one of its product on its "Spot". Taken away (moved off the spot, or gone), a new
 * one appears there shortly after; one put back on the spot, or found there after the world was loaded, is kept rather
 * than doubled. Only the host (or a solo player) restocks; everyone else sees the result.
 */
export function standScript(product) {
	const template = JSON.stringify(productSlots(product));
	return String.raw`
const SELF = ctx.self.id;
const PRODUCT = ${template};
const RESTOCK_S = 1.5;
const ON_SPOT = 0.12;
let current = null;
let missing = RESTOCK_S;
let every = 0;
function spot() { const s = ctx.hierarchy.getChildren(SELF).find((c) => c.name === 'Spot'); return s ? ctx.hierarchy.getWorldPose(s.id) : null; }
function onSpot(id, where) {
  const pose = ctx.hierarchy.getWorldPose(id);
  return !!pose && ctx.math.vecLength(ctx.math.vecSub(pose.position, where.position)) < ON_SPOT;
}
// A product already sitting there: after a reload, or one a shopper put back.
function found(where) {
  const here = ctx.world.findNear(where.position, ON_SPOT).find((s) => s.parentId === null && s.name === PRODUCT[0].name);
  return here ? here.id : null;
}
function restock(where) {
  const ids = new Map(PRODUCT.map((s) => [s.id, crypto.randomUUID()]));
  for (const s of PRODUCT) {
    const root = s.parentId === null;
    ctx.world.spawn({
      ...JSON.parse(JSON.stringify(s)),
      id: ids.get(s.id),
      parentId: root ? null : ids.get(s.parentId),
      ...(root ? { position: where.position.map((v) => Math.round(v * 1000) / 1000), rotation: ctx.math.quatMultiply(where.rotation, s.rotation) } : {})
    });
  }
  ctx.world.spawn({ name: 'Restock Sparkle', position: where.position, components: [{ type: 'particleBurst', color: '#fde68a', count: 14, durationMs: 500 }, { type: 'expires', expiresAt: Date.now() + 500 }] });
  return ids.get(PRODUCT[0].id);
}
return {
  tick(dt) {
    if (!ctx.world.isHost()) return;
    every -= dt;
    missing += dt;
    if (every > 0) return;
    every = 0.25;
    const where = spot();
    if (!where) return;
    if (current && ctx.hierarchy.getSlot(current) && onSpot(current, where)) { missing = 0; return; }
    current = found(where);
    if (current) { missing = 0; return; }
    if (missing < RESTOCK_S) return;
    current = restock(where);
    missing = 0;
  }
};
`;
}
