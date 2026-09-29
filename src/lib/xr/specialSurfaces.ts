import {
	AbstractMesh,
	Color3,
	MirrorTexture,
	Plane,
	StandardMaterial,
	Vector3,
	type Scene
} from '@babylonjs/core';

export function setupMirrorSurface(
	scene: Scene,
	mesh: AbstractMesh,
	resolution = 512
): () => void {
	const mirrorTexture = new MirrorTexture(`${mesh.name}-reflection`, resolution, scene, true);
	mirrorTexture.level = 1;

	const material = new StandardMaterial(`${mesh.name}-mirror-material`, scene);
	material.diffuseColor = new Color3(0.82, 0.88, 0.94);
	material.specularColor = Color3.White();
	material.reflectionTexture = mirrorTexture;
	material.backFaceCulling = false;
	mesh.material = material;
	mesh.metadata = { ...(mesh.metadata ?? {}), specialSurface: 'mirror' };

	const updateMirror = () => {
		mesh.computeWorldMatrix(true);
		const world = mesh.getWorldMatrix();
		const position = Vector3.TransformCoordinates(Vector3.Zero(), world);
		const normal = Vector3.TransformNormal(Vector3.Forward(), world).normalize();
		mirrorTexture.mirrorPlane = Plane.FromPositionAndNormal(position, normal);
		mirrorTexture.renderList = scene.meshes.filter(
			(candidate) =>
				candidate !== mesh &&
				candidate.isEnabled() &&
				candidate.isVisible &&
				candidate.metadata?.specialSurface !== 'mirror'
		);
	};

	const observer = scene.onBeforeRenderObservable.add(updateMirror);
	updateMirror();

	return () => {
		scene.onBeforeRenderObservable.remove(observer);
		mirrorTexture.dispose();
		material.dispose();
	};
}
