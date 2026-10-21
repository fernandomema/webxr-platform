import { Constants, RawTexture3D, Texture, type Light, type Scene } from '@babylonjs/core';
import { setAmbientScale } from './ambientControl.ts';
import { MAX_VOLUMES, atlasSize, packAtlas, type VolumeLayout } from './irradianceShader.ts';

export type LightingMode = 'on' | 'off' | 'only';

/** What the world chooses to be lit by: only live lights, only baked light (the baked lights stay off), or both. */
export type LightingPolicy = 'live' | 'baked' | 'both';

/** One baked volume as the manager holds it: where it is, its texels, and how the world is asking for it to look. */
interface Entry {
	layout: Omit<VolumeLayout, 'atlasX'>;
	texels: Uint8Array;
	tint: [number, number, number];
	intensity: number;
	enabled: boolean;
}

const managers = new WeakMap<Scene, LightVolumeManager>();

/** A hex colour as 0 to 1 channels (white for anything else). */
export function tintOf(hex: string | undefined): [number, number, number] {
	const m = typeof hex === 'string' ? /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim()) : null;
	if (!m) return [1, 1, 1];
	return [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255];
}

/** `?lightdebug=off` shows the world without its baked light, `only` shows the light alone (as if every surface were white). */
function modeFromUrl(): LightingMode {
	if (typeof window === 'undefined') return 'on';
	const value = new URLSearchParams(window.location.search).get('lightdebug');
	return value === 'off' || value === 'only' ? value : 'on';
}

/**
 * Everything a scene has of baked lighting: the volumes its `lightVolume` components loaded, the 3D texture they are packed
 * into, and what depends on whether they are there: the flat ambient light goes out, and the lights that were baked stop being
 * drawn live. The material plugin reads the layout and the texture from here.
 */
export class LightVolumeManager {
	static for(scene: Scene): LightVolumeManager {
		let manager = managers.get(scene);
		if (!manager) {
			manager = new LightVolumeManager(scene);
			managers.set(scene, manager);
		}
		return manager;
	}
	static peek(scene: Scene | null | undefined): LightVolumeManager | undefined {
		return scene ? managers.get(scene) : undefined;
	}

	/** Makes the 3D texture of the atlas; replaced in tests, which have no graphics card. */
	static textureFactory: (data: Uint8Array, width: number, height: number, depth: number, scene: Scene) => RawTexture3D = (data, width, height, depth, scene) => {
		const texture = new RawTexture3D(data, width, height, depth, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
		texture.wrapU = texture.wrapV = texture.wrapR = Texture.CLAMP_ADDRESSMODE;
		return texture;
	};

	/** Changes whenever the shader has to be made again (the volumes or the atlas changed). */
	version = 0;
	/** The packed texture, once the volumes are in it. */
	texture: RawTexture3D | null = null;
	atlas: [number, number, number] = [1, 1, 1];
	layouts: VolumeLayout[] = [];
	mode: LightingMode = modeFromUrl();
	policy: LightingPolicy = 'baked';
	/** The light a surface gets outside every volume. */
	floor = 0.02;
	gain = 1;

	private entries = new Map<string, Entry>();
	private order: string[] = [];
	private lights = new Set<Light>();
	private pending: ReturnType<typeof setTimeout> | null = null;
	private listeners = new Set<() => void>();
	private tooBig = false;

	private constructor(private scene: Scene) {
		if (typeof window !== 'undefined') {
			(window as unknown as { __lightVolume?: unknown }).__lightVolume = {
				manager: this,
				setMode: (mode: LightingMode) => this.setMode(mode),
				get mode() { return LightVolumeManager.for(scene).mode; }
			};
		}
	}

	/** Whether the world is lit by baked light right now. */
	get active(): boolean {
		return this.texture !== null && this.layouts.length > 0 && this.mode !== 'off' && this.policy !== 'live';
	}

	add(id: string, layout: Omit<VolumeLayout, 'atlasX'>, texels: Uint8Array, tint: [number, number, number], intensity: number, enabled: boolean): void {
		if (!this.entries.has(id)) this.order.push(id);
		this.entries.set(id, { layout, texels, tint, intensity, enabled });
		this.schedule();
	}

	remove(id: string): void {
		if (!this.entries.delete(id)) return;
		this.order = this.order.filter((other) => other !== id);
		this.schedule();
	}

	/** What a script or the Studio changed about a volume that is already here: no new texture, only new numbers. */
	update(id: string, tint: [number, number, number], intensity: number, enabled: boolean): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		const wasEnabled = entry.enabled;
		entry.tint = tint; entry.intensity = intensity; entry.enabled = enabled;
		if (wasEnabled !== enabled) this.schedule();
		else this.scene.markAllMaterialsAsDirty(Constants.MATERIAL_MiscDirtyFlag);
	}

	setMode(mode: LightingMode): void {
		if (this.mode === mode) return;
		this.mode = mode;
		this.apply();
		this.scene.markAllMaterialsAsDirty(Constants.MATERIAL_MiscDirtyFlag);
	}

	setPolicy(policy: LightingPolicy): void {
		if (this.policy === policy) return;
		this.policy = policy;
		this.apply();
		this.scene.markAllMaterialsAsDirty(Constants.MATERIAL_MiscDirtyFlag);
	}

	/** The values the uniforms take, in the order of `UNIFORMS`: the tint of each volume, then `[mode, floor, gain, 0]`. */
	uniformValues(): number[][] {
		const rows: number[][] = [];
		for (let i = 0; i < MAX_VOLUMES; i++) {
			const entry = this.entries.get(this.activeIds()[i] ?? '');
			rows.push(entry ? [entry.tint[0] * entry.intensity, entry.tint[1] * entry.intensity, entry.tint[2] * entry.intensity, 1] : [1, 1, 1, 1]);
		}
		rows.push([this.policy === 'live' || this.mode === 'off' ? 2 : this.mode === 'only' ? 1 : 0, this.floor, this.gain, 0]);
		return rows;
	}

	/** A light that was baked: it is drawn live only while there is no baked light to stand in for it. */
	registerBakedLight(light: Light): () => void {
		this.lights.add(light);
		light.setEnabled(this.lightsLive());
		return () => { this.lights.delete(light); };
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		if (this.pending) clearTimeout(this.pending);
		this.texture?.dispose();
		this.texture = null;
		this.entries.clear();
		this.order = [];
		this.layouts = [];
		setAmbientScale(this.scene, 1);
		managers.delete(this.scene);
	}

	private activeIds(): string[] {
		return this.order.filter((id) => this.entries.get(id)?.enabled);
	}

	/** Volumes arrive one at a time as their files load: pack them all once the last one is in. */
	private schedule(): void {
		if (this.pending) return;
		this.pending = setTimeout(() => { this.pending = null; this.rebuild(); }, 40);
	}

	private rebuild(): void {
		const ids = this.activeIds();
		const list = ids.map((id) => this.entries.get(id) as Entry);
		this.texture?.dispose();
		this.texture = null;
		this.layouts = [];
		this.tooBig = false;
		if (list.length > 0 && list.length <= MAX_VOLUMES) {
			const [width, height, depth] = atlasSize(list.map((e) => e.layout));
			const engine = this.scene.getEngine() as unknown as { _gl?: WebGL2RenderingContext; webGLVersion?: number };
			const gl = engine._gl;
			const limit = gl && typeof gl.getParameter === 'function' ? Number(gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)) || 256 : 256;
			if ((engine.webGLVersion ?? 2) < 2 || width > limit || height > limit || depth > limit) {
				this.tooBig = true;
				console.warn(`[lighting] the baked lighting does not fit this device (a ${width} x ${height} x ${depth} texture; the most it can hold is ${limit}): it is left out`);
			} else {
				const packed = packAtlas(list.map((e) => ({ ...e.layout, texels: e.texels })));
				const data = packed.data;
				this.layouts = packed.layouts;
				try {
					this.texture = LightVolumeManager.textureFactory(data, width, height, depth, this.scene);
				} catch (error) {
					console.warn('[lighting] the baked lighting could not be uploaded: it is left out', error);
					this.layouts = [];
				}
				this.atlas = [width, height, depth];
			}
		}
		this.version++;
		this.apply();
		// Every material makes its shader again, now that there is a volume (or no longer).
		this.scene.markAllMaterialsAsDirty(Constants.MATERIAL_AllDirtyFlag);
		for (const listener of this.listeners) listener();
	}

	/** The flat ambient goes out, and the baked lights with it, while baked light is in use. */
	private apply(): void {
		setAmbientScale(this.scene, this.active ? 0 : 1);
		for (const light of this.lights) light.setEnabled(this.lightsLive());
	}

	/** Baked lights are drawn live when there is no baked light to stand in for them, or the world asks for both. */
	private lightsLive(): boolean {
		return !this.active || this.policy === 'both';
	}

	get didNotFit(): boolean { return this.tooBig; }
}
