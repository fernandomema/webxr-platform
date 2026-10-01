import * as THREE from "three";

/* -------------------------------------------------------------------------- */
/* Lighting & Environment                                                     */
/* -------------------------------------------------------------------------- */

export function addStandardLights(
  scene: THREE.Scene,
  opts?: { warm?: number; cool?: number; ambient?: number },
) {
  const hemi = new THREE.HemisphereLight(
    opts?.warm ?? 0xffe6c2,
    opts?.cool ?? 0x1a1633,
    opts?.ambient ?? 1.15,
  );
  scene.add(hemi);

  const key = new THREE.DirectionalLight(opts?.warm ?? 0xffd2a1, 2.1);
  key.position.set(5, 8, 6);
  scene.add(key);

  const rim = new THREE.DirectionalLight(opts?.cool ?? 0x7c9bff, 1.4);
  rim.position.set(-6, 4, -5);
  scene.add(rim);

  const fill = new THREE.PointLight(0xff7a45, 1.1, 18);
  fill.position.set(0, 2.5, 2);
  scene.add(fill);

  return { hemi, key, rim, fill };
}

export function createSpatialFloor(opts?: {
  size?: number;
  divisions?: number;
  color1?: number;
  color2?: number;
  y?: number;
}) {
  const group = new THREE.Group();
  const size = opts?.size ?? 28;
  const divisions = opts?.divisions ?? 28;

  const grid = new THREE.GridHelper(
    size,
    divisions,
    opts?.color1 ?? 0xffcf7a,
    opts?.color2 ?? 0x2b2942,
  );
  const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMats.forEach((m) => {
    m.transparent = true;
    m.opacity = 0.32;
  });
  group.add(grid);

  // Subtle floor disc
  const discGeo = new THREE.CircleGeometry(size * 0.48, 48);
  const discMat = new THREE.MeshStandardMaterial({
    color: 0x0d0c18,
    roughness: 0.85,
    metalness: 0.1,
    transparent: true,
    opacity: 0.65,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.01;
  group.add(disc);

  // Concentric spatial rings
  [2.5, 5, 8].forEach((r, i) => {
    const ringGeo = new THREE.RingGeometry(r, r + 0.035, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: i === 0 ? 0xffcf7a : 0x8ff0cf,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.16 - i * 0.04,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    group.add(ring);
  });

  group.position.y = opts?.y ?? -1.2;
  return group;
}

export function createFloatingParticles(count = 60, spread = 12, color = 0xffcf7a) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * spread;
    pos[i * 3 + 1] = (Math.random() - 0.2) * (spread * 0.55);
    pos[i * 3 + 2] = (Math.random() - 0.5) * spread;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: 0.08,
    transparent: true,
    opacity: 0.65,
  });
  return new THREE.Points(geo, mat);
}

/* -------------------------------------------------------------------------- */
/* 3D Kithin Avatar                                                           */
/* -------------------------------------------------------------------------- */

export type Avatar3D = {
  group: THREE.Group;
  head: THREE.Group;
  body: THREE.Mesh;
  leftHand: THREE.Mesh;
  rightHand: THREE.Mesh;
  voiceRings: THREE.Mesh[];
  animate: (t: number, opts?: { speaking?: boolean; wave?: boolean; phase?: number }) => void;
};

export function createAvatar3D(colorHex: number | string = 0x9b8cff, scale = 1): Avatar3D {
  const group = new THREE.Group();
  const baseColor = new THREE.Color(colorHex);

  // Ground shadow
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.48, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  group.add(shadow);

  // Torso (stylized rounded capsule)
  const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.52, 12, 24);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.35,
    metalness: 0.08,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.68;
  group.add(body);

  // Subtle collar / scarf ring
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.045, 12, 32),
    new THREE.MeshStandardMaterial({
      color: baseColor.clone().offsetHSL(0, 0.1, 0.18),
      roughness: 0.3,
    }),
  );
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.06;
  group.add(collar);

  // Head group
  const head = new THREE.Group();
  head.position.y = 1.42;
  group.add(head);

  const headMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.33, 28, 28),
    new THREE.MeshStandardMaterial({
      color: baseColor.clone().offsetHSL(0, 0, 0.06),
      roughness: 0.28,
      metalness: 0.1,
    }),
  );
  head.add(headMesh);

  // Visor face plate
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.29, 24, 24, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.28, Math.PI * 0.42),
    new THREE.MeshStandardMaterial({
      color: 0x0b0b14,
      roughness: 0.15,
      metalness: 0.4,
    }),
  );
  visor.rotation.y = Math.PI * 0.5;
  visor.position.z = 0.06;
  head.add(visor);

  // Expressive glowing eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xf4f1ea });
  const eyeGeo = new THREE.CapsuleGeometry(0.032, 0.045, 6, 12);
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.1, 0.02, 0.31);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.1, 0.02, 0.31);
  head.add(leftEye, rightEye);

  // Floating 3D hands
  const handGeo = new THREE.SphereGeometry(0.11, 18, 18);
  const handMat = new THREE.MeshStandardMaterial({
    color: baseColor.clone().offsetHSL(0, 0, 0.12),
    roughness: 0.3,
    metalness: 0.1,
  });
  const leftHand = new THREE.Mesh(handGeo, handMat);
  leftHand.position.set(-0.52, 0.78, 0.18);
  const rightHand = new THREE.Mesh(handGeo, handMat);
  rightHand.position.set(0.52, 0.78, 0.18);
  group.add(leftHand, rightHand);

  // Spatial voice rings above head
  const voiceRings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(0.22 + i * 0.1, 0.014, 10, 36),
      new THREE.MeshBasicMaterial({
        color: 0x8ff0cf,
        transparent: true,
        opacity: 0,
      }),
    );
    r.rotation.x = Math.PI / 2;
    r.position.y = 1.9 + i * 0.12;
    group.add(r);
    voiceRings.push(r);
  }

  group.scale.setScalar(scale);

  const animate = (t: number, opts?: { speaking?: boolean; wave?: boolean; phase?: number }) => {
    const p = opts?.phase ?? 0;
    const bob = Math.sin(t * 2.4 + p) * 0.04;
    body.position.y = 0.68 + bob * 0.6;
    head.position.y = 1.42 + bob;
    head.rotation.z = Math.sin(t * 1.3 + p) * 0.05;
    head.rotation.y = Math.sin(t * 0.9 + p) * 0.12;

    leftHand.position.y = 0.78 + Math.sin(t * 2.4 + p + 1) * 0.05;
    if (opts?.wave) {
      rightHand.position.set(
        0.52 + Math.sin(t * 7) * 0.12,
        1.25 + Math.cos(t * 7) * 0.06,
        0.25,
      );
    } else {
      rightHand.position.y = 0.78 + Math.cos(t * 2.4 + p) * 0.05;
    }

    voiceRings.forEach((ring, i) => {
      const mat = ring.material as THREE.MeshBasicMaterial;
      if (opts?.speaking) {
        const cycle = (t * 1.6 + i * 0.33) % 1;
        ring.scale.setScalar(0.75 + cycle * 0.85);
        ring.position.y = 1.86 + cycle * 0.36;
        mat.opacity = (1 - cycle) * 0.75;
      } else {
        mat.opacity = 0;
      }
    });
  };

  return { group, head, body, leftHand, rightHand, voiceRings, animate };
}

/* -------------------------------------------------------------------------- */
/* 3D In-Game Objects ("Things")                                              */
/* -------------------------------------------------------------------------- */

export function createBrush3D(tipColor: number | string = 0xffcf7a) {
  const group = new THREE.Group();
  const c = new THREE.Color(tipColor);

  // Handle
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.09, 0.72, 20),
    new THREE.MeshStandardMaterial({ color: 0x2b2438, roughness: 0.35, metalness: 0.25 }),
  );
  handle.position.y = -0.18;
  group.add(handle);

  // Grip ring
  const ferrule = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.075, 0.14, 20),
    new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.2, metalness: 0.8 }),
  );
  ferrule.position.y = 0.22;
  group.add(ferrule);

  // Glowing bristle cone
  const tipMat = new THREE.MeshStandardMaterial({
    color: c,
    emissive: c,
    emissiveIntensity: 0.85,
    roughness: 0.2,
  });
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.32, 24), tipMat);
  tip.position.y = 0.44;
  group.add(tip);

  // Halo ring around tip
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.15, 0.015, 12, 32),
    new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.65 }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.38;
  group.add(halo);

  return { group, tip, tipMat, halo };
}

export function createCamera3D() {
  const group = new THREE.Group();

  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.68, 0.44),
    new THREE.MeshStandardMaterial({ color: 0x232233, roughness: 0.35, metalness: 0.3 }),
  );
  group.add(body);

  // Top Accent Plate
  const topPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.96, 0.16, 0.45),
    new THREE.MeshStandardMaterial({ color: 0xe8e2d5, roughness: 0.3, metalness: 0.4 }),
  );
  topPlate.position.y = 0.28;
  group.add(topPlate);

  // Shutter button
  const shutter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.1, 20),
    new THREE.MeshStandardMaterial({
      color: 0xff7a45,
      emissive: 0xff7a45,
      emissiveIntensity: 0.35,
      roughness: 0.25,
    }),
  );
  shutter.position.set(0.28, 0.39, 0.02);
  group.add(shutter);

  // Lens barrel
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.29, 0.28, 32),
    new THREE.MeshStandardMaterial({ color: 0x14141f, roughness: 0.2, metalness: 0.75 }),
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.02, 0.3);
  group.add(barrel);

  // Glowing lens glass
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x6ec3ff,
    emissive: 0x3b8cc4,
    emissiveIntensity: 0.55,
    roughness: 0.08,
    metalness: 0.9,
  });
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.21, 28, 28), lensMat);
  lens.scale.z = 0.35;
  lens.position.set(0, -0.02, 0.41);
  group.add(lens);

  // Viewfinder window
  const flash = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.1, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xffcf7a }),
  );
  flash.position.set(-0.28, 0.26, 0.22);
  group.add(flash);

  return { group, shutter, lens, lensMat, flash };
}

export function createTurntable3D() {
  const group = new THREE.Group();

  // Plinth base
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.18, 1.25),
    new THREE.MeshStandardMaterial({ color: 0x1d1a2b, roughness: 0.4, metalness: 0.25 }),
  );
  group.add(base);

  // Platter
  const platterGroup = new THREE.Group();
  platterGroup.position.set(-0.12, 0.12, 0);
  group.add(platterGroup);

  const vinyl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.52, 0.03, 40),
    new THREE.MeshStandardMaterial({ color: 0x0b0b12, roughness: 0.22, metalness: 0.6 }),
  );
  platterGroup.add(vinyl);

  // Groove rings on vinyl
  [0.24, 0.34, 0.44].forEach((r) => {
    const groove = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.005, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x9b8cff, transparent: true, opacity: 0.35 }),
    );
    groove.rotation.x = Math.PI / 2;
    groove.position.y = 0.018;
    platterGroup.add(groove);
  });

  // Center label
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.036, 28),
    new THREE.MeshStandardMaterial({
      color: 0xff7a45,
      emissive: 0xff7a45,
      emissiveIntensity: 0.4,
    }),
  );
  platterGroup.add(label);

  // Spindle
  const spindle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.09, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.1 }),
  );
  spindle.position.y = 0.03;
  platterGroup.add(spindle);

  // Tonearm pivot
  const armPivot = new THREE.Group();
  armPivot.position.set(0.52, 0.16, -0.36);
  group.add(armPivot);

  const pivotPost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.09, 0.12, 20),
    new THREE.MeshStandardMaterial({ color: 0xd9d4cc, metalness: 0.8, roughness: 0.2 }),
  );
  armPivot.add(pivotPost);

  const armRod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.72, 12),
    new THREE.MeshStandardMaterial({ color: 0xeae6df, metalness: 0.85, roughness: 0.15 }),
  );
  armRod.rotation.x = Math.PI / 2;
  armRod.position.set(-0.08, 0.04, 0.32);
  armRod.rotation.z = 0.22;
  armPivot.add(armRod);

  // 3D equalizer bars floating behind
  const bars: THREE.Mesh[] = [];
  const barGroup = new THREE.Group();
  barGroup.position.set(0, 0.25, -0.55);
  group.add(barGroup);
  for (let i = 0; i < 11; i++) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.3, 0.07),
      new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? 0x9b8cff : 0x8ff0cf,
        emissive: i % 2 === 0 ? 0x9b8cff : 0x8ff0cf,
        emissiveIntensity: 0.6,
      }),
    );
    b.position.x = (i - 5) * 0.12;
    barGroup.add(b);
    bars.push(b);
  }

  return { group, platterGroup, armPivot, bars };
}

export function createArcadeButton3D() {
  const group = new THREE.Group();

  // Heavy bevelled pedestal housing
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.68, 0.82, 0.32, 36),
    new THREE.MeshStandardMaterial({ color: 0x1d1d2b, roughness: 0.35, metalness: 0.55 }),
  );
  base.position.y = -0.15;
  group.add(base);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.06, 16, 40),
    new THREE.MeshStandardMaterial({ color: 0x383852, roughness: 0.25, metalness: 0.8 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.02;
  group.add(rim);

  // Plunger cap
  const capMat = new THREE.MeshStandardMaterial({
    color: 0xff7a45,
    emissive: 0xff5522,
    emissiveIntensity: 0.45,
    roughness: 0.2,
    metalness: 0.1,
  });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.52, 0.28, 36), capMat);
  cap.position.y = 0.16;
  group.add(cap);

  // Shockwave ring
  const waveMat = new THREE.MeshBasicMaterial({
    color: 0x8ff0cf,
    transparent: true,
    opacity: 0,
  });
  const wave = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.025, 12, 48), waveMat);
  wave.rotation.x = Math.PI / 2;
  wave.position.y = 0.05;
  group.add(wave);

  return { group, cap, capMat, wave, waveMat };
}

export function createDice3D(size = 0.65) {
  const group = new THREE.Group();
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshStandardMaterial({
      color: 0xf4f1ea,
      roughness: 0.25,
      metalness: 0.08,
    }),
  );
  group.add(cube);

  const pipGeo = new THREE.SphereGeometry(size * 0.075, 12, 12);
  const pipMat = new THREE.MeshStandardMaterial({
    color: 0x11111a,
    emissive: 0xff7a45,
    emissiveIntensity: 0.25,
  });

  const half = size / 2 + 0.005;
  const o = size * 0.24;

  const addPip = (x: number, y: number, z: number) => {
    const p = new THREE.Mesh(pipGeo, pipMat);
    p.position.set(x, y, z);
    group.add(p);
  };

  // Front (1)
  addPip(0, 0, half);
  // Back (6)
  [-o, o].forEach((x) => [-o, 0, o].forEach((y) => addPip(x, y, -half)));
  // Top (2)
  addPip(-o, half, -o);
  addPip(o, half, o);
  // Bottom (5)
  addPip(0, -half, 0);
  [-o, o].forEach((x) => [-o, o].forEach((z) => addPip(x, -half, z)));
  // Right (3)
  addPip(half, -o, -o);
  addPip(half, 0, 0);
  addPip(half, o, o);
  // Left (4)
  [-o, o].forEach((y) => [-o, o].forEach((z) => addPip(-half, y, z)));

  return { group, cube };
}

export function createWorldOrb3D(theme?: {
  islandColor?: number;
  crystalColor?: number;
  ringColor?: number;
}) {
  const group = new THREE.Group();

  // Inner miniature world
  const innerWorld = new THREE.Group();
  group.add(innerWorld);

  // Floating island base
  const islandTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.58, 0.42, 0.16, 7),
    new THREE.MeshStandardMaterial({
      color: theme?.islandColor ?? 0x4b3b78,
      roughness: 0.5,
      flatShading: true,
    }),
  );
  islandTop.position.y = -0.14;
  innerWorld.add(islandTop);

  const islandBottom = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 0.45, 7),
    new THREE.MeshStandardMaterial({
      color: 0x231b3a,
      roughness: 0.7,
      flatShading: true,
    }),
  );
  islandBottom.rotation.x = Math.PI;
  islandBottom.position.y = -0.44;
  innerWorld.add(islandBottom);

  // Glowing monolith / crystal in center of mini world
  const crystalMat = new THREE.MeshStandardMaterial({
    color: theme?.crystalColor ?? 0xffcf7a,
    emissive: theme?.crystalColor ?? 0xffcf7a,
    emissiveIntensity: 0.75,
    roughness: 0.2,
    flatShading: true,
  });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), crystalMat);
  crystal.position.set(0, 0.18, 0);
  crystal.scale.set(0.8, 1.45, 0.8);
  innerWorld.add(crystal);

  // Miniature trees / pillars on the island
  [
    [-0.26, 0.05, 0.18],
    [0.28, 0.04, -0.14],
    [-0.14, 0.04, -0.26],
  ].forEach(([x, y, z], idx) => {
    const pillar = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.22, 6),
      new THREE.MeshStandardMaterial({
        color: idx === 0 ? 0x8ff0cf : 0x9b8cff,
        emissive: idx === 0 ? 0x8ff0cf : 0x9b8cff,
        emissiveIntensity: 0.3,
        flatShading: true,
      }),
    );
    pillar.position.set(x, y, z);
    innerWorld.add(pillar);
  });

  // Tiny orbiting moon inside the orb
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  moon.position.set(0.42, 0.34, 0);
  innerWorld.add(moon);

  // Refractive glass shell
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.08,
    metalness: 0.05,
    transmission: 0.4,
    transparent: true,
    opacity: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.82, 36, 36), shellMat);
  group.add(shell);

  // Outer orbital rings
  const ringMat = new THREE.MeshBasicMaterial({
    color: theme?.ringColor ?? 0x9b8cff,
    transparent: true,
    opacity: 0.55,
  });
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.96, 0.014, 12, 64), ringMat);
  ring1.rotation.x = Math.PI * 0.38;
  group.add(ring1);

  const ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(1.08, 0.01, 12, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffcf7a,
      transparent: true,
      opacity: 0.35,
    }),
  );
  ring2.rotation.y = Math.PI * 0.25;
  ring2.rotation.x = -Math.PI * 0.32;
  group.add(ring2);

  return { group, innerWorld, crystal, crystalMat, islandTop, shell, ring1, ring2, moon };
}

export function createInstrument3D() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.16, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x251e38, roughness: 0.35, metalness: 0.3 }),
  );
  group.add(body);

  const keys: THREE.Mesh[] = [];
  const colors = [0xff7a45, 0xffcf7a, 0x8ff0cf, 0x6ec3ff, 0x9b8cff];
  for (let i = 0; i < 5; i++) {
    const k = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.08, 0.46 - i * 0.03),
      new THREE.MeshStandardMaterial({
        color: colors[i],
        emissive: colors[i],
        emissiveIntensity: 0.45,
        roughness: 0.2,
      }),
    );
    k.position.set((i - 2) * 0.17, 0.1, 0);
    group.add(k);
    keys.push(k);
  }
  return { group, keys };
}

export function createWeirdThing3D() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.28, 0),
    new THREE.MeshStandardMaterial({
      color: 0x8ff0cf,
      emissive: 0x8ff0cf,
      emissiveIntensity: 0.65,
      flatShading: true,
    }),
  );
  group.add(core);

  const r1 = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.46, 0.045, 64, 12, 2, 3),
    new THREE.MeshStandardMaterial({
      color: 0xffcf7a,
      roughness: 0.2,
      metalness: 0.8,
    }),
  );
  group.add(r1);

  return { group, core, r1 };
}

/* -------------------------------------------------------------------------- */
/* 3D Volumetric Ribbon Stroke                                                */
/* -------------------------------------------------------------------------- */

export function createRibbonStroke3D(
  points: THREE.Vector3[],
  color: number | string = 0xffcf7a,
  radius = 0.055,
) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, 64, radius, 12, false);
  const c = new THREE.Color(color);
  const mat = new THREE.MeshStandardMaterial({
    color: c,
    emissive: c,
    emissiveIntensity: 0.75,
    roughness: 0.2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, geo, mat, curve };
}
