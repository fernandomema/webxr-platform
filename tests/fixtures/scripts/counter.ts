import { defineScript } from '@kithin/engine/script';
import { STEP, label } from './shared.ts';

declare const SEED: { start: number };

export default defineScript((ctx) => {
	let count = SEED.start;
	return {
		onSpawn() {
			ctx.world.setComponentField('label', 'textDisplay', 'lines', [label(count)]);
		},
		tick(dt: number) {
			count += STEP * dt;
			if (ctx.time.fixed(0.5) > 0) ctx.world.setComponentField('label', 'textDisplay', 'lines', [label(count)]);
		},
		onUIEvent(event) {
			if (event.type === 'press') {
				const player = ctx.world.getPlayers()[0];
				if (player) ctx.world.setPlayerVelocity(player.id, [0, 5, 0], { add: true });
				ctx.world.loadFragment(`sha256:${'a'.repeat(64)}`, { id: 'map', position: [1, 0, 0] });
			}
		},
		__count: () => count
	};
});
