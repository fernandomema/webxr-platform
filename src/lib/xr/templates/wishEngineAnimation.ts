import { WISH } from './wishEngineConfig.ts';
import type { Vec3 } from '../../ecs/types';

/** Every peer reconstructs decoration from bounded host progress, without wall-clock assumptions. */
export const WISH_CLOCK_SOURCE = `
let sample = '', localTime = 0;
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const t = clamp(v); return t * t * (3 - 2 * t); };
const phases = ['idle','awakening','light','lightReveal','time','timeReveal','sky','skyReveal','release','finale','afterglow'];
function clock(dt) {
  const slot = ctx.hierarchy.getSlot('${WISH.director}');
  const state = slot && slot.components.find((c) => c.type === 'scriptState');
  const s = state ? state.data : { phase: 'idle', time: 0, lights: [], rings: [1,2,3], stars: [] };
  const key = s.run + ':' + s.phase + ':' + s.time;
  if (key !== sample) { localTime = s.time || 0; sample = key; }
  else localTime = Math.min(localTime + dt, (s.time || 0) + 1);
  return { s, t: localTime, n: phases.indexOf(s.phase) };
}
function progress(n, index, t, duration) { return n > index ? 1 : n < index ? 0 : smooth(t / duration); }
`;

type Animation = 'roof' | 'wall' | 'genie' | 'hand' | 'ribbon' | 'orbit' | 'star' | 'ring' | 'pendulum' | 'aurora' | 'wave' | 'mote' | 'eclipse' | 'moon';

export function wishAnimation(kind: Animation, base: Vec3, index = 0, scale: Vec3 = [1, 1, 1], angle = 0): string {
	return `${WISH_CLOCK_SOURCE}
const base = ${JSON.stringify(base)}, size = ${JSON.stringify(scale)}, index = ${index}, angle = ${angle};
let drift = 0;
return { tick(dt) {
  const {s,t,n} = clock(dt);
  drift += dt * (s.gentle ? 0.35 : 1);
  let p = base.slice(), q = ctx.math.quatFromAxisAngle([0,1,0], angle), k = 1;
  const returning = n === 10 ? smooth(t / 16) : 0;
  const opening = progress(n,3,t,18) * (1-returning), unfolding = progress(n,5,t,18) * (1-returning);
  const rising = progress(n,7,t,20), freedom = progress(n,9,t,28);
  switch ('${kind}') {
    case 'roof': {
      const a = index * Math.PI / 4;
      p[0] += Math.sin(a) * opening * 12; p[2] += Math.cos(a) * opening * 12;
      p[1] += opening * 8;
      k = 1 - opening * 0.94;
      q = ctx.math.quatMultiply(q, ctx.math.quatFromAxisAngle([1,0,0], opening * 0.8));
      break;
    }
    case 'wall': {
      const a = angle;
      p[0] += Math.sin(a) * unfolding * 12; p[2] += Math.cos(a) * unfolding * 12;
      p[1] += Math.sin(unfolding * Math.PI / 2) * (index % 2 ? 2.5 : 5);
      break;
    }
    case 'genie':
      k = (1 + rising * 10) * (1 - freedom * 0.999);
      p[1] += rising * 11 + (n > 0 ? Math.sin(drift * 0.8) * 0.06 : 0);
      p[2] += rising * 25;
      q = ctx.math.quatFromAxisAngle([0,1,0], Math.sin(drift * 0.25) * (n > 0 ? 0.12 : 0));
      break;
    case 'hand':
      p[1] += n > 0 ? Math.sin(drift * 0.8 + index) * 0.06 : 0;
      q = ctx.math.quatFromAxisAngle([0,0,1], Math.sin(drift * 0.5 + index) * 0.12);
      break;
    case 'ribbon':
      q = ctx.math.quatFromAxisAngle([0,1,0], drift * 0.24 * (index % 2 ? -1 : 1) + index);
      k = n === 0 ? 0.001 : 1;
      break;
    case 'orbit':
      k = Math.max(0.001, rising * (1-returning));
      q = ctx.math.quatMultiply(ctx.math.quatFromAxisAngle([0,0,1], 0.35 + index * 0.35), ctx.math.quatFromAxisAngle([0,1,0], drift * 0.04 * (index % 2 ? -1 : 1)));
      break;
    case 'star':
      k = s.stars[index] ? Math.max(0.001,1-returning) : 0.001;
      p[1] += Math.sin(drift * 0.3 + index) * 0.35;
      q = ctx.math.quatFromAxisAngle([0,0,1], drift * 0.07);
      break;
    case 'ring':
      q = ctx.math.quatFromAxisAngle([0,0,1], (s.rings[index] || 0) * Math.PI / 2);
      break;
    case 'pendulum': {
      const frozen = n === 4;
      const a = frozen ? Math.sin(index * 1.7) * 0.55 : Math.sin(drift * 0.7 + index) * 0.55;
      q = ctx.math.quatFromAxisAngle([0,0,1], a);
      break;
    }
    case 'aurora':
      k = n === 10 ? Math.max(0.001,1-returning) : n === 9 ? Math.max(0.001, smooth(t / 8)) : 0.001;
      p[1] += Math.sin(drift * 0.2 + index) * (s.gentle ? 0.2 : 0.8);
      break;
    case 'wave': {
      const revealing = [1,3,5,7,9].includes(n);
      const v = revealing ? (t % 6) / 6 : 0;
      k = revealing && !s.gentle ? 0.1 + v * 16 : 0.001;
      p[1] = 0.02 + index * 0.006;
      break;
    }
    case 'mote':
      p[1] += Math.sin(drift * 0.45 + index) * 0.2;
      q = ctx.math.quatFromAxisAngle([0,1,0], drift * 0.2 + index);
      break;
    case 'eclipse':
      k = Math.max(0.001, rising * (1-returning));
      break;
    case 'moon':
      p[0] -= freedom * 15;
      break;
  }
  ctx.self.setLocalTransform({position:p, rotation:q, scale:size.map((v) => Math.max(0.001, v*k))});
} };
`;
}

/** Physical buttons submit to the same director as laser/desktop UI. Only the host runs interactions. */
export function wishPress(action: string): string {
	return `return { onPress() {
  if (!ctx.world.isHost()) return;
  const slot = ctx.hierarchy.getSlot('${WISH.director}');
  const state = slot && slot.components.find((c) => c.type === 'scriptState');
  if (state) ctx.world.setComponentField('${WISH.director}', 'scriptState', 'request', { action: '${action}', run: state.data.run });
} };`;
}
