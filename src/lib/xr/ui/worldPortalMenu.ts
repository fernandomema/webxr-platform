import { MeshBuilder, Quaternion, StandardMaterial, Color3, Vector3, type Camera, type Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui';
import type { SceneGraph } from '../sceneGraph';
import type { HostedWorldVisibility } from '$lib/worldVisibility';
import { WORLD_VISIBILITY_INFO } from '$lib/worldVisibility';
import { createRadialView } from './radialView';
import { sourceLabel, validateWorldPackage } from '$lib/worlds/package';
import type { WorldPackage } from '$lib/worlds/types';

export function createWorldPortalMenu(
  scene: Scene,
  sceneGraph: SceneGraph,
  getCamera: () => Camera,
  launch: (world: WorldPackage, visibility: HostedWorldVisibility | 'solo') => Promise<void>,
  saveCopy: (world: WorldPackage) => Promise<void>
) {
  const radial = createRadialView(scene, 'world-portal', getCamera, {
    pointerSelectable: true,
    size: 0.9,
    offset: new Vector3(0, 0.36, 0)
  });
  const panel = MeshBuilder.CreatePlane('world-session-settings', { width: 0.9, height: 0.8 }, scene);
  const material = new StandardMaterial('world-session-settings-material', scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.White();
  material.backFaceCulling = false;
  panel.material = material;
  panel.metadata = { interactive: true };
  panel.setEnabled(false);
  const texture = AdvancedDynamicTexture.CreateForMesh(panel, 720, 640, true);
  const background = new Rectangle('world-settings-background');
  background.width = 1;
  background.height = 1;
  background.thickness = 0;
  background.background = '#111827';
  texture.addControl(background);
  const stack = new StackPanel('world-settings-stack');
  stack.width = 0.9;
  background.addControl(stack);
  const title = new TextBlock('world-settings-title', 'Custom world session');
  title.height = '64px'; title.fontSize = 28; title.color = 'white';
  stack.addControl(title);
  const source = new TextBlock('world-settings-source', '');
  source.height = '32px'; source.fontSize = 17; source.color = '#9ca3af';
  stack.addControl(source);
  const status = new TextBlock('world-settings-status', '');
  status.height = '42px'; status.fontSize = 18; status.color = '#fbbf24';
  stack.addControl(status);
  let selectedWorld: WorldPackage | null = null;
  let selectedVisibility: HostedWorldVisibility | 'solo' = 'private';
  const options: Array<HostedWorldVisibility | 'solo'> = ['solo', 'private', 'friends', 'friends-plus', 'public'];
  const buttons = new Map<string, Button>();
  for (const visibility of options) {
    const button = Button.CreateSimpleButton(`world-settings-${visibility}`, WORLD_VISIBILITY_INFO[visibility].label);
    button.height = '70px'; button.color = 'white'; button.fontSize = 22; button.cornerRadius = 10;
    if (visibility === 'friends' || visibility === 'friends-plus') { button.textBlock!.text += ' (unavailable)'; button.isEnabled = false; }
    button.onPointerClickObservable.add(() => { selectedVisibility = visibility; refresh(); });
    stack.addControl(button);
    buttons.set(visibility, button);
  }
  const start = Button.CreateSimpleButton('world-settings-start', 'Start world');
  start.height = '72px'; start.color = 'white'; start.background = '#16a34a'; start.cornerRadius = 10;
  start.onPointerClickObservable.add(async () => {
    if (!selectedWorld) return;
    start.isEnabled = false;
    status.text = 'Starting world…';
    try {
      await launch(selectedWorld, selectedVisibility);
      panel.setEnabled(false);
    } catch (error) {
      status.text = error instanceof Error ? error.message : 'Could not start world';
    } finally { start.isEnabled = true; }
  });
  stack.addControl(start);
  const cancel = Button.CreateSimpleButton('world-settings-cancel', 'Cancel');
  cancel.height = '60px'; cancel.color = 'white'; cancel.background = '#374151'; cancel.cornerRadius = 10;
  cancel.onPointerClickObservable.add(() => panel.setEnabled(false));
  stack.addControl(cancel);

  function refresh() {
    for (const [visibility, button] of buttons) button.background = selectedVisibility === visibility ? '#6d28d9' : '#374151';
  }
  refresh();

  function showCustom(world: WorldPackage) {
    selectedWorld = world;
    title.text = world.name.length > 32 ? `${world.name.slice(0, 32)}…` : world.name;
    source.text = `${sourceLabel(world.source)}${world.source?.kind === 'inventory' && world.source.revisionNumber ? ` · v${world.source.revisionNumber}` : ''}`;
    selectedVisibility = world.defaultVisibility === 'solo' ? 'solo' : world.defaultVisibility;
    status.text = '';
    refresh();
    const camera = getCamera();
    panel.position.copyFrom(camera.globalPosition.add(camera.getForwardRay().direction.scale(1.1)));
    const dx = camera.globalPosition.x - panel.position.x;
    const dz = camera.globalPosition.z - panel.position.z;
    panel.rotationQuaternion = Quaternion.FromEulerAngles(0, Math.atan2(dx, dz), 0);
    panel.setEnabled(true);
  }

  function open(slotId: string) {
    const entry = sceneGraph.getLive(slotId);
    const world = entry?.slot.components.find((component) => component.type === 'worldPortal')?.world;
    if (!entry || !world) return;
    try { validateWorldPackage(world); } catch { return; }
    panel.setEnabled(false);
    radial.open(entry.node, [
      { label: 'Load map', isEnabled: () => true, onSelect: () => void launch(world, world.defaultVisibility).catch((error) => { showCustom(world); status.text = error instanceof Error ? error.message : 'Could not start world'; }) },
      { label: 'Custom session', isEnabled: () => true, onSelect: () => showCustom(world) },
      { label: 'Save a copy', isEnabled: () => true, onSelect: () => void saveCopy(world).catch((error) => { showCustom(world); status.text = error instanceof Error ? error.message : 'Could not save a copy'; }) }
    ]);
  }

  return { open, close: () => { radial.close(); panel.setEnabled(false); }, dispose: () => { radial.dispose(); texture.dispose(); material.dispose(); panel.dispose(); } };
}
