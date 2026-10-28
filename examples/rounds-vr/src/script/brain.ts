// What a gun or a shield tells the director: only what the hand did, in its own `scriptState` (a script cannot call another).
import { defineScript } from '@kithin/engine/script';

/** Which side this is, where it writes, where commands go and what it is: written into the script for each gun and shield when the world is built. */
declare const SIDE: number;
declare const BRAIN: string;
declare const COMMANDS: string;
declare const KIND: 'gun' | 'shield';

export default defineScript((ctx) => {
	const state = { seq: 0, down: false, equipped: false, playerId: '', name: '', hand: 'right' as 'left' | 'right' };
	const write = () => ctx.world.setComponentField(BRAIN, 'scriptState', 'data', { ...state }, false);
	const send = (cmd: string) => {
		const holder = ctx.equip.holder();
		if (!holder) return;
		ctx.world.spawn({ name: 'Command', parentId: COMMANDS, components: [{ type: 'scriptState', data: { cmd, side: SIDE, player: holder.playerId } }, { type: 'expires', expiresAt: Date.now() + 6000 }] });
	};
	return {
		onEquip(event) { state.equipped = true; state.playerId = event.playerId; state.name = event.playerName; state.hand = event.hand; state.down = false; write(); },
		onUnequip() { state.equipped = false; state.down = false; write(); },
		onTrigger(event) {
			if (event.phase === 'press') { state.down = true; state.seq += 1; }
			else if (event.phase === 'release') state.down = false;
			else return;
			state.playerId = event.playerId; state.name = event.playerName; state.hand = event.hand;
			write();
		},
		getRadialItems() {
			return KIND === 'gun'
				? [
						{ label: 'Reload', isEnabled: () => true, onSelect: () => send('reload') },
						{ label: 'Block', isEnabled: () => true, onSelect: () => send('block') },
						{ label: 'Quit match', isEnabled: () => true, onSelect: () => send('quit') }
					]
				: [{ label: 'Block', isEnabled: () => true, onSelect: () => send('block') }];
		}
	};
});
