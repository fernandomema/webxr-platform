import { MeshBuilder, Quaternion, StandardMaterial, Color3, Vector3, type Camera, type Scene, type TransformNode } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui';
import type { SceneGraph } from '../sceneGraph.ts';
import type { HostedWorldVisibility } from '../../worldVisibility.ts';
import { WORLD_VISIBILITY_INFO } from '../../worldVisibility.ts';
import { createRadialView } from './radialView.ts';
import { sourceLabel, validateWorldPackage } from '../../worlds/package.ts';
import type { WorldPackage } from '../../worlds/types.ts';
import type { WorldLinkComponent } from '../../ecs/types.ts';
import { yawFacing } from './panelFacing.ts';
import { THEME } from './theme.ts';

/** How long the orb's menu stays open when nobody uses it. */
const MENU_AUTO_CLOSE_MS = 20_000;

export function createWorldPortalMenu(
  scene: Scene,
  sceneGraph: SceneGraph,
  getCamera: () => Camera,
  launch: (world: WorldPackage, visibility: HostedWorldVisibility | 'solo') => Promise<void>,
  saveCopy: (world: WorldPackage) => Promise<void>,
  launchBuiltin: (id: string) => Promise<void>,
  launchPublished: (worldId: string) => Promise<void>,
  createWorld: () => Promise<void>
) {
  const radial = createRadialView(scene, 'world-portal', getCamera, {
    pointerSelectable: true,
    size: 0.9,
    offset: new Vector3(0, 0.36, 0),
    // A link can sit on a big panel (the lobby's billboard): the menu comes out in front of it so a press reaches the menu, not the panel.
    towardCamera: 0.5
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
  background.background = THEME.panel;
  texture.addControl(background);
  const stack = new StackPanel('world-settings-stack');
  stack.width = 0.9;
  background.addControl(stack);
  const title = new TextBlock('world-settings-title', 'Custom world session');
  title.height = '64px'; title.fontSize = 28; title.color = THEME.text;
  stack.addControl(title);
  const source = new TextBlock('world-settings-source', '');
  source.height = '32px'; source.fontSize = 17; source.color = THEME.muted;
  stack.addControl(source);
  const status = new TextBlock('world-settings-status', '');
  status.height = '42px'; status.fontSize = 18; status.color = THEME.glow;
  stack.addControl(status);
  let selectedWorld: WorldPackage | null = null;
  let selectedVisibility: HostedWorldVisibility | 'solo' = 'private';
  const options: Array<HostedWorldVisibility | 'solo'> = ['solo', 'private', 'friends', 'friends-plus', 'public'];
  const buttons = new Map<string, Button>();
  for (const visibility of options) {
    const button = Button.CreateSimpleButton(`world-settings-${visibility}`, WORLD_VISIBILITY_INFO[visibility].label);
    button.height = '70px'; button.color = THEME.text; button.fontSize = 22; button.cornerRadius = 10;
    if (visibility === 'friends' || visibility === 'friends-plus') { button.textBlock!.text += ' (unavailable)'; button.isEnabled = false; }
    button.onPointerClickObservable.add(() => { selectedVisibility = visibility; refresh(); });
    stack.addControl(button);
    buttons.set(visibility, button);
  }
  const start = Button.CreateSimpleButton('world-settings-start', 'Start world');
  start.height = '72px'; start.color = THEME.text; start.background = THEME.go; start.cornerRadius = 10;
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
  cancel.height = '60px'; cancel.color = THEME.text; cancel.background = THEME.raised; cancel.cornerRadius = 10;
  cancel.onPointerClickObservable.add(() => panel.setEnabled(false));
  stack.addControl(cancel);

  function refresh() {
    for (const [visibility, button] of buttons) button.background = selectedVisibility === visibility ? THEME.accent : THEME.raised;
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
    panel.rotationQuaternion = Quaternion.FromEulerAngles(0, yawFacing(panel.position, camera.globalPosition), 0);
    panel.setEnabled(true);
  }

  /** The orb the menu is open for, and the timer that puts it away if nobody uses it. */
  let openFor: string | null = null;
  let autoClose: ReturnType<typeof setTimeout> | undefined;

  function closeRadial() {
    clearTimeout(autoClose);
    openFor = null;
    radial.close();
  }

  function open(slotId: string) {
    // Pressing the orb again puts its menu away.
    if (radial.isOpen && openFor === slotId) return closeRadial();
    const entry = sceneGraph.getLive(slotId);
    const link = entry?.slot.components.find((component) => component.type === 'worldLink');
    if (entry && link) return openLink(slotId, entry.node, link.target, link.label);
    const world = entry?.slot.components.find((component) => component.type === 'worldPortal')?.world;
    if (!entry || !world) return;
    try { validateWorldPackage(world); } catch { return; }
    panel.setEnabled(false);
    radial.open(entry.node, [
      { label: 'Load map', isEnabled: () => true, onSelect: () => void launch(world, world.defaultVisibility).catch((error) => { showCustom(world); status.text = error instanceof Error ? error.message : 'Could not start world'; }) },
      { label: 'Custom session', isEnabled: () => true, onSelect: () => showCustom(world) },
      { label: 'Save a copy', isEnabled: () => true, onSelect: () => void saveCopy(world).catch((error) => { showCustom(world); status.text = error instanceof Error ? error.message : 'Could not save a copy'; }) }
    ]);
    keepOpen(slotId);
  }

  /** A link to a built-in or published world offers to go there, and to stay. */
  function openLink(slotId: string, node: TransformNode, target: WorldLinkComponent['target'], label?: string) {
    panel.setEnabled(false);
    const isNew = target.kind === 'new';
    const destination = target.kind === 'builtin' ? target.id : target.kind === 'published' ? target.worldId : '';
    radial.open(node, [
      {
        label: isNew ? 'Create a new world' : `Go to ${label || destination}`,
        isEnabled: () => true,
        onSelect: () => void (target.kind === 'new' ? createWorld() : target.kind === 'published' ? launchPublished(target.worldId) : launchBuiltin(target.id)).catch((error) => console.error('Could not open the world', error))
      },
      { label: isNew ? 'Not now' : 'Stay here', isEnabled: () => true, onSelect: () => {} }
    ]);
    keepOpen(slotId);
  }

  function keepOpen(slotId: string) {
    openFor = slotId;
    // An unused menu does not hang in the air for ever.
    clearTimeout(autoClose);
    autoClose = setTimeout(() => {
      if (openFor === slotId) closeRadial();
    }, MENU_AUTO_CLOSE_MS);
  }

  return { open, close: () => { closeRadial(); panel.setEnabled(false); }, dispose: () => { clearTimeout(autoClose); radial.dispose(); texture.dispose(); material.dispose(); panel.dispose(); } };
}
