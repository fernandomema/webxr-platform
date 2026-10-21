/**
 * Which parts of the engine's own interface are on. An app that has no use for one (a single-player game has no sessions to
 * host and no worlds to browse) turns it off; the engine then neither shows it nor asks the platform for what it would show.
 */
export interface EngineFeatures {
	/** The tabs of the dash. */
	homeTab: boolean;
	sessionTab: boolean;
	worldsTab: boolean;
	inventoryTab: boolean;
	settingsTab: boolean;
	/** Signing in, creating an account and signing out from the dash. */
	accountTab: boolean;
	/** The in-game inspector, which needs the hosting app to serve its panel page (see `inspectorPanelPath`). */
	inspector: boolean;
}

const defaults = (): EngineFeatures => ({ homeTab: true, sessionTab: true, worldsTab: true, inventoryTab: true, settingsTab: true, accountTab: true, inspector: true });

let current: EngineFeatures = defaults();

export function configureFeatures(features: Partial<EngineFeatures>): void {
	current = { ...current, ...features };
}

export function getFeatures(): Readonly<EngineFeatures> {
	return current;
}

export function resetFeatures(): void {
	current = defaults();
}
