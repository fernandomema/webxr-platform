import { ParticleSystem, Vector3, Color4, type Scene, type TransformNode } from '@babylonjs/core';

/** A one-shot omnidirectional burst at `node`'s position — purely local visuals, each peer renders its own. Returns a dispose function. */
export function setupParticleBurst(
	scene: Scene,
	node: TransformNode,
	color: string | undefined,
	count: number | undefined,
	durationMs: number | undefined
): () => void {
	const particleCount = count ?? 60;
	const ps = new ParticleSystem(`particle-burst-${node.name}`, particleCount, scene);
	ps.emitter = node.getAbsolutePosition().clone();
	ps.particleEmitterType = ps.createSphereEmitter(0.05, 1);

	const c = Color4.FromHexString(`${color ?? '#f97316'}ff`);
	ps.color1 = c;
	ps.color2 = c;
	ps.minSize = 0.03;
	ps.maxSize = 0.08;
	ps.minLifeTime = 0.3;
	ps.maxLifeTime = Math.max(((durationMs ?? 1200) / 1000) * 0.8, 0.3);
	ps.emitRate = particleCount * 4;
	ps.minEmitPower = 1;
	ps.maxEmitPower = 3;
	ps.gravity = new Vector3(0, -2, 0);

	ps.start();
	const stopTimer = setTimeout(() => ps.stop(), 150);

	return () => {
		clearTimeout(stopTimer);
		ps.dispose();
	};
}
