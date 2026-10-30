import { Color3, StandardMaterial, type AbstractMesh, type BaseTexture } from '@babylonjs/core';

/**
 * How a surface drawn from a GUI texture (a sign, a panel) takes the light of the world. By default it is self-lit: the texture is its own light, as bright
 * in a dark room as in a bright one, which is right for a screen or a neon sign. `lit` makes it a painted board instead: the texture is its colour, and the
 * world's lights and baked light fall on it as on any other object, so the same colour looks the same on a sign and on the wall beside it.
 */
export function setSurfaceLit(mesh: AbstractMesh, texture: BaseTexture, lit: boolean): void {
	const material = mesh.material;
	if (!(material instanceof StandardMaterial)) return;
	material.emissiveTexture = lit ? null : texture;
	material.diffuseTexture = lit ? texture : null;
	material.diffuseColor = lit ? Color3.White() : Color3.Black();
}
