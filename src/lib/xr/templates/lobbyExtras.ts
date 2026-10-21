import type { SlotTree } from '../../ecs/types.ts';
import { buildAtm, LOBBY_ATM } from './atm.ts';
import { buildLobbyBillboard } from './lobbyBillboard.ts';
import { buildLobbyHub } from './lobbyHub.ts';

/** What the lobby has beyond `lobby.json`: the welcome hub, the board advertising other worlds and the ATM. */
export function buildLobbyExtras(): SlotTree {
	return [...buildLobbyHub(), ...buildLobbyBillboard(), ...buildAtm({ id: 'lobby-atm', ...LOBBY_ATM })];
}
