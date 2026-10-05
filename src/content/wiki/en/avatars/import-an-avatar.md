---
title: Import an avatar from a model
order: 1
description: Turn a rigged .glb model into a player avatar and wear it in every world.
---

<script>
	import Callout from '$lib/wiki/components/Callout.svelte';
</script>

An avatar is a 3D model with a skeleton. The Studio has a three-step wizard that finds the bones of your model, lets you fix them, and builds an avatar object you can wear.

## What you need

- A **rigged `.glb`** file: a model with a skeleton and skin. Static models without a rig cannot be worn.
- Up to **25 MB** and **300,000 triangles**. Headsets have a tight budget, so lighter is better.
- A skeleton with at least a **head** and **both hands**. Arms, legs, spine and fingers are optional, but make the avatar move more naturally.

<Callout type="note">Only <code>.glb</code> is accepted. If your model is in another format, export it as a binary glTF (<code>.glb</code>) with the armature and skin included.</Callout>

## 1. Open the wizard

There are two ways in:

- In `/studio`, press the **New avatar** card.
- In the editor, open the **Library** panel. Press **New avatar…** to start at the model picker, or press **Avatar** next to a model you already imported to jump straight to the bones step.

## 2. Choose the model

Pick one of the models already on your device, or press **Import .glb** to add one. Each entry shows its triangle count and how many bones it has.

If the model has no skeleton, the wizard tells you: *"This model has no skeleton, so it cannot be worn. Export it with a rig (a skinned .glb)."*

## 3. Match the bones

The wizard reads the bone names of your model and maps them to the humanoid roles Kithin needs. It understands common rigs, such as Mixamo (`mixamorig:`), prefixed rigs (`Armature|Hips`), VRM-style names (`J_Bip_*`) and `Left`/`Right` or `L`/`R` naming.

It reports how many of the 19 body bones it found. **Head, left hand and right hand are required.** If something is wrong or missing, pick the right bone from the dropdowns, grouped as body, left arm, right arm and legs. Fingers are available in their own section.

## 4. Finish

- **Name**: how the avatar will appear in your inventory.
- **Eye height (m)**: the avatar is scaled so its eyes match the player's real height. It is pre-filled from the size of the model; adjust it if the avatar looks too big or too small.
- **Carrying spots**: optional shoulder and hip sockets, places to keep an item within reach.

A summary shows what this avatar can do: head, left and right arm, legs, crouch and fingers (for example `5/5`).

Press **Create avatar**. It is added to the current project.

<Callout type="warning">An avatar can only be created in an object project. If you open the wizard from a world project it will tell you to open or create an object project first.</Callout>

## 5. Save it

Save the project (`Ctrl+S`). Because it contains an avatar, it is stored in your inventory as an **Avatar**.

## 6. Wear it

1. Open `/play` and the **Dash** panel (`Tab` on desktop, the menu button on your controller).
2. Open your **Inventory** and select the avatar.
3. Press **Set as default**.

From now on you wear it here and in every world you join later. Press **Unset** on the same item to go back to the original avatar.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| "This model has no skeleton" | Re-export with the armature and skin included. |
| The wizard won't go past the bones step | Map **head**, **left hand** and **right hand** by hand. |
| Arms or legs don't move | Map those bones in the bone editor; unmapped bones are skipped. |
| The model won't import | Check it is a `.glb`, under 25 MB and under 300,000 triangles. |
| The avatar is the wrong size | Change **Eye height** in the last step, or edit the avatar's height later in the Inspector. |
| It isn't in the avatar list | It must be saved from an object project, not a world. |
