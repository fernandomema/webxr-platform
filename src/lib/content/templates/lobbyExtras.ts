import type { SlotTree } from '@kithin/engine/ecs/types';
import { createSlot } from '@kithin/engine/ecs/types';
import { eulerToQuat } from '@kithin/engine/math/euler';
import { JUKEBOX_ID } from './jukebox.ts';
import { buildAtm, LOBBY_ATM } from './atm.ts';
import { buildLobbyBillboard } from './lobbyBillboard.ts';
import { buildLobbyHub } from './lobbyHub.ts';

/** The jukebox by the discs: loaded from the starter kit (`builtin`, id `jukebox`) rather than built here, turned so that its front faces the room (+Z). */
function buildLobbyJukebox(): SlotTree {
	return [createSlot({ id: LOBBY_JUKEBOX, name: 'Jukebox', position: [2.2, 0, -2.2], rotation: [0, 1, 0, 0], components: [{ type: 'loader', adapter: 'builtin', id: JUKEBOX_ID }] }),
		createSlot({ id: 'lobby-jukebox-records', name: 'Jukebox Records', components: [{ type: 'codeBlock', code: SEAT_RECORDS }] })
	];
}

const LOBBY_JUKEBOX = 'lobby-jukebox';
/** The lobby's discs and the jukebox places (`jukebox-slot-N`, behind the glass; a loader puts its id and `::` in front of every id) they start in. */
const LOBBY_RECORDS = [{ disc: 'lobby-disc-1', place: 0 }, { disc: 'lobby-disc-2', place: 1 }];
/** A record standing on its edge, label to the front: the pose of the jukebox's storage places. */
const RECORD_AT_REST = eulerToQuat([90, -180, 0]);

/** The loaded jukebox exists only once the loader is done, so the host seats the lobby's discs in its places as soon as they are there. */
const SEAT_RECORDS = String.raw`
const RECORDS = ${JSON.stringify(LOBBY_RECORDS)};
const PREFIX = ${JSON.stringify(`${LOBBY_JUKEBOX}::${JUKEBOX_ID}-slot-`)};
const REST = ${JSON.stringify(RECORD_AT_REST)};
const pending = new Set(RECORDS.map((r) => r.disc));
return {
  tick() {
    if (!pending.size || !ctx.world.isHost()) return;
    for (const r of RECORDS) {
      if (!pending.has(r.disc)) continue;
      const socketId = PREFIX + r.place;
      const slot = ctx.hierarchy.getSlot(socketId);
      const socket = slot && slot.components.find((c) => c.type === 'socket');
      if (!socket) continue;
      if (socket.occupantId || !ctx.hierarchy.getSlot(r.disc) || ctx.grab.isSlotHeld(r.disc)) { pending.delete(r.disc); continue; }
      if (!ctx.world.setParent(r.disc, socketId)) continue;
      ctx.world.setLocalPose(r.disc, { position: [0, 0, 0], rotation: REST });
      ctx.world.setComponentField(socketId, 'socket', 'occupantId', r.disc);
      pending.delete(r.disc);
    }
  }
};
`;

/** What the lobby has beyond `lobby.json`: the welcome hub, the board advertising other worlds, the ATM and the jukebox. */
export function buildLobbyExtras(): SlotTree {
	return [...buildLobbyJukebox(), ...buildLobbyHub(), ...buildLobbyBillboard(), ...buildAtm({ id: 'lobby-atm', ...LOBBY_ATM })];
}
