import type { RemoteRadialItem } from '../net/protocol.ts';

type Hand = 'left' | 'right';

/** The radial options of the host's scripts, for a guest (see `createRemoteRadial`). */
export interface RemoteRadial {
	/** Whether this player is a guest right now. */
	active(): boolean;
	/** The options the host last gave for the object; none yet: the menu uses this device's own. */
	cached(slotId: string): RemoteRadialItem[] | undefined;
	/** Asks the host for the options; resolves with whether they changed. */
	refresh(hand: Hand, slotId: string): Promise<boolean>;
	select(hand: Hand, slotId: string, index: number, label: string): Promise<void>;
}

/** The two requests a guest can make of the host for radial menus (GuestSync). */
export interface RadialRelay {
	requestRadialItems(slotId: string, hand: Hand): Promise<RemoteRadialItem[] | null>;
	selectRadialItem(slotId: string, hand: Hand, index: number, label: string): Promise<RemoteRadialItem[] | null>;
}

/** Keeps the host's last answer per object, so a menu opened again shows the host's options straight away. */
export function createRemoteRadial(relay: () => RadialRelay | null): RemoteRadial {
	let owner: RadialRelay | null = null;
	const cache = new Map<string, RemoteRadialItem[]>();
	const current = () => {
		const next = relay();
		if (next !== owner) {
			owner = next;
			cache.clear(); // another session: its objects and their options are different
		}
		return next;
	};
	const store = (slotId: string, items: RemoteRadialItem[] | null) => {
		if (!items) return false;
		const changed = JSON.stringify(cache.get(slotId)) !== JSON.stringify(items);
		cache.set(slotId, items);
		return changed;
	};
	return {
		active: () => current() !== null,
		cached: (slotId) => (current() ? cache.get(slotId) : undefined),
		async refresh(hand, slotId) {
			const link = current();
			return link ? store(slotId, await link.requestRadialItems(slotId, hand)) : false;
		},
		async select(hand, slotId, index, label) {
			const link = current();
			if (link) store(slotId, await link.selectRadialItem(slotId, hand, index, label));
		}
	};
}
