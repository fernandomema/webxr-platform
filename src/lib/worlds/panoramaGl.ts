/**
 * One shared WebGL2 renderer for every panorama card on a page. Browsers allow only a handful of WebGL contexts, so each card
 * draws through this one and copies the result into its own 2D canvas. Textures are mipmapped and filtered, so a small card
 * looks smooth and a large one uses the full picture. Returns false whenever WebGL2 is not available; callers fall back to the CPU.
 */

const TEXTURE_CACHE = 8;

const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	vUv = p;
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 color;
uniform sampler2D uPanorama;
uniform float uYaw;
uniform float uPitch;
uniform float uTanHalfFov;
uniform float uAspect;
const float PI = 3.14159265359;
void main() {
	vec3 ray = vec3((vUv.x * 2.0 - 1.0) * uTanHalfFov, (vUv.y * 2.0 - 1.0) * uTanHalfFov / uAspect, 1.0);
	float cp = cos(uPitch), sp = sin(uPitch), cy = cos(uYaw), sy = sin(uYaw);
	float y1 = ray.y * cp + ray.z * sp;
	float z1 = -ray.y * sp + ray.z * cp;
	vec3 d = normalize(vec3(ray.x * cy + z1 * sy, y1, -ray.x * sy + z1 * cy));
	float u = atan(d.x, d.z) / (2.0 * PI) + 0.5;
	vec2 st = vec2(u, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI);
	// atan jumps at the seam; take the derivative from whichever of the two wrappings is continuous, or the seam picks the wrong mip level
	float u2 = fract(u + 0.5) - 0.5;
	vec2 gx = vec2(abs(dFdx(u)) < abs(dFdx(u2)) ? dFdx(u) : dFdx(u2), dFdx(st.y));
	vec2 gy = vec2(abs(dFdy(u)) < abs(dFdy(u2)) ? dFdy(u) : dFdy(u2), dFdy(st.y));
	color = vec4(textureGrad(uPanorama, st, gx, gy).rgb, 1.0);
}`;

interface Renderer {
	canvas: HTMLCanvasElement;
	gl: WebGL2RenderingContext;
	uniforms: Record<'yaw' | 'pitch' | 'tan' | 'aspect', WebGLUniformLocation | null>;
}

let renderer: Renderer | null = null;
let unavailable = false;
const textures = new Map<string, Promise<WebGLTexture | null>>();

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function create(): Renderer | null {
	if (unavailable) return null;
	if (renderer) return renderer;
	try {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
		if (!gl) throw new Error('no webgl2');
		const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
		const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
		const program = gl.createProgram();
		if (!vertex || !fragment || !program) throw new Error('shader');
		gl.attachShader(program, vertex);
		gl.attachShader(program, fragment);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('link');
		gl.useProgram(program);
		gl.uniform1i(gl.getUniformLocation(program, 'uPanorama'), 0);
		canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); unavailable = true; renderer = null; textures.clear(); });
		renderer = {
			canvas, gl,
			uniforms: {
				yaw: gl.getUniformLocation(program, 'uYaw'),
				pitch: gl.getUniformLocation(program, 'uPitch'),
				tan: gl.getUniformLocation(program, 'uTanHalfFov'),
				aspect: gl.getUniformLocation(program, 'uAspect')
			}
		};
		return renderer;
	} catch {
		unavailable = true;
		return null;
	}
}

function loadTexture(gl: WebGL2RenderingContext, src: string): Promise<WebGLTexture | null> {
	const known = textures.get(src);
	if (known) {
		textures.delete(src);
		textures.set(src, known);
		return known;
	}
	const job = new Promise<WebGLTexture | null>((resolve) => {
		const image = new Image();
		image.onload = () => {
			const texture = gl.createTexture();
			if (!texture) return resolve(null);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
			gl.generateMipmap(gl.TEXTURE_2D);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			resolve(texture);
		};
		image.onerror = () => resolve(null);
		image.src = src;
	});
	textures.set(src, job);
	if (textures.size > TEXTURE_CACHE) {
		const oldest = textures.keys().next().value as string;
		void textures.get(oldest)?.then((texture) => texture && gl.deleteTexture(texture));
		textures.delete(oldest);
	}
	return job;
}

/** Draws the view into `target` at its own pixel size. Resolves false if WebGL2 cannot do it (use the CPU path instead). */
export async function drawPanorama(target: HTMLCanvasElement, src: string, yaw: number, pitch: number, hfov: number): Promise<boolean> {
	const active = create();
	if (!active) return false;
	const { gl, canvas, uniforms } = active;
	const texture = await loadTexture(gl, src);
	if (!texture || renderer !== active) return false;
	const context = target.getContext('2d');
	if (!context || target.width === 0 || target.height === 0) return false;
	if (canvas.width !== target.width || canvas.height !== target.height) {
		canvas.width = target.width;
		canvas.height = target.height;
	}
	gl.viewport(0, 0, canvas.width, canvas.height);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.uniform1f(uniforms.yaw, yaw);
	gl.uniform1f(uniforms.pitch, pitch);
	gl.uniform1f(uniforms.tan, Math.tan(hfov / 2));
	gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
	// Copied in the same task as the draw: the shared canvas is not kept between frames.
	context.drawImage(canvas, 0, 0);
	return true;
}
