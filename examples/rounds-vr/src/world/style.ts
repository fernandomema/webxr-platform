import { ARENA, MAPS, TEAM, type Vec3 } from './data.ts';

/** How a map looks: what its blocks are made of, the sky above it and the lights in it. Each map is a place of its own. */
/** A sky and how the picture under it is graded. */
export interface Sky {
	top: string;
	horizon: string;
	bottom: string;
	stars: number;
	ambient: number;
	exposure: number;
	contrast: number;
	saturation: number;
	bloom: number;
}

export interface MapStyle {
	/** What the map is called as a place, and a line about it. */
	place: string;
	tagline: string;
	/** Poly Haven (CC0) materials: the body of the blocks and the surface you stand on, with the real size of one repeat and a tint. */
	body: { id: string; size: number; tint: string };
	top: { id: string; size: number; tint: string };
	/** The sky, switched on when the map is (the script writes these into the world's skybox). */
	sky: Sky;
	/** The colour of the glass walls and the rings behind them; and neon trim on the blocks, for the maps that have it. */
	accent: string;
	trim: boolean;
	/** Lights of the map, baked into its lighting. */
	lights: { at: Vec3; color: string; intensity: number; range: number }[];
}

export const MAP_STYLES: MapStyle[] = [
	{
		place: 'RUINS',
		tagline: 'Old stone under a pink sky',
		body: { id: 'rock_wall_08', size: 2.2, tint: '#f0e6ff' },
		top: { id: 'rocky_terrain_02', size: 2, tint: '#d4f09a' },
		sky: { top: '#1b1040', horizon: '#e0628f', bottom: '#2a1a4a', stars: 0.5, ambient: 1.15, exposure: 1.05, contrast: 1.12, saturation: 1.15, bloom: 0.45 },
		accent: '#f472b6',
		trim: false,
		lights: [
			{ at: [-12, 2, 0], color: '#ff9fc7', intensity: 2.4, range: 34 },
			{ at: [12, 2, 0], color: '#ffb36b', intensity: 2.4, range: 34 },
			{ at: [0, 8, 0], color: '#ffd6e8', intensity: 2, range: 36 }
		]
	},
	{
		place: 'DESERT',
		tagline: 'Red rock at the end of the day',
		body: { id: 'sandstone_cracks', size: 3, tint: '#ffcc99' },
		top: { id: 'aerial_beach_01', size: 2.5, tint: '#ffd9a0' },
		sky: { top: '#2a1838', horizon: '#ff8a3d', bottom: '#5a2a1a', stars: 0.15, ambient: 1.2, exposure: 1.0, contrast: 1.1, saturation: 1.2, bloom: 0.4 },
		accent: '#fb923c',
		trim: false,
		lights: [
			{ at: [-12, 2, 0], color: '#ffa05c', intensity: 2.6, range: 34 },
			{ at: [12, 2, 0], color: '#ff7a59', intensity: 2.6, range: 34 },
			{ at: [0, 8, 0], color: '#ffd3a0', intensity: 1.8, range: 36 }
		]
	},
	{
		place: 'CYBER',
		tagline: 'Neon towers over the night city',
		body: { id: 'blue_metal_plate', size: 2, tint: '#d4eeff' },
		top: { id: 'stone_tiles_02', size: 1.6, tint: '#9be7ff' },
		sky: { top: '#020617', horizon: '#0e7490', bottom: '#082f49', stars: 0.8, ambient: 1.1, exposure: 1.0, contrast: 1.18, saturation: 1.2, bloom: 0.7 },
		accent: '#22d3ee',
		trim: true,
		lights: [
			{ at: [-12, 2, 0], color: '#38bdf8', intensity: 2.8, range: 34 },
			{ at: [12, 2, 0], color: '#e879f9', intensity: 2.8, range: 34 },
			{ at: [0, 8, 0], color: '#a5f3fc', intensity: 2, range: 36 }
		]
	},
	{
		place: 'ICE',
		tagline: 'Snow and cold light on the mountain',
		body: { id: 'stone_tiles_02', size: 2, tint: '#b9d4f5' },
		top: { id: 'snow_01', size: 2, tint: '#ffffff' },
		sky: { top: '#0b2a4a', horizon: '#9ad7ff', bottom: '#1b3a5a', stars: 0.35, ambient: 1.25, exposure: 1.1, contrast: 1.05, saturation: 1.05, bloom: 0.35 },
		accent: '#7dd3fc',
		trim: false,
		lights: [
			{ at: [-12, 2, 0], color: '#a5d8ff', intensity: 2.4, range: 34 },
			{ at: [12, 2, 0], color: '#bfe3ff', intensity: 2.4, range: 34 },
			{ at: [0, 8, 0], color: '#ffffff', intensity: 2.2, range: 36 }
		]
	}
];

/** The sky of the lobby and the sky the world starts with. */
export const LOBBY_SKY: Sky = { top: '#0b0720', horizon: '#5b21b6', bottom: '#020617', stars: 0.6, ambient: 0.95, exposure: 1, contrast: 1.12, saturation: 1.1, bloom: 0.5 };

/** The look of a map: the four places take turns. */
export const styleOf = (map: number): MapStyle => MAP_STYLES[map % MAP_STYLES.length];

/** What the script needs to dress a round: the sky of each map, its name and the place it is. */
export const STYLE_DATA = MAPS.map((map, index) => ({ name: map.name, place: styleOf(index).place, tagline: styleOf(index).tagline, sky: styleOf(index).sky, accent: styleOf(index).accent }));
export { ARENA, TEAM };
