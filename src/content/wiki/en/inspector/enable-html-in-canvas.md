---
title: Enable HTML-in-Canvas for the Inspector
order: 1
description: Turn on the experimental browser flag that lets the in-game Inspector (and web pages on surfaces) draw properly.
---

<script>
	import Callout from '$lib/wiki/components/Callout.svelte';
</script>

The in-game **Inspector** is a normal web page (the Studio's hierarchy and inspector) drawn onto a panel in the 3D world. Kithin does this with the experimental **HTML-in-Canvas** browser API. The same API powers the `htmlView` component, which shows a live web page on a plane.

You get the best result with the browser flag enabled. Without it, Kithin falls back to a slower snapshot renderer that only works for pages from this site and may look less accurate.

## Turn the flag on

1. Use a Chromium-based browser (Chrome on desktop).
2. Open `chrome://flags/#canvas-draw-element` in a new tab.
3. Set **Canvas draw element** to **Enabled**.
4. Press **Relaunch** at the bottom of the page.
5. Reload Kithin.

<Callout type="note">The flag is experimental and can change or disappear in future browser versions. If you can't find it, update your browser first.</Callout>

## Open the Inspector

1. Open the **Dash** (`M` on desktop, the menu button on your controller).
2. On the **Home** tab, press **Inspector**. The panel appears in front of you; you can grab it and move it like any object.
3. If you don't see the button, press **Customise** on the Home tab and add **Inspector** to your shortcuts.

## Check that it works

The panel should show the hierarchy and the inspector. If you see the message **"This page cannot be drawn here"**, the browser can't draw the page:

- Without the flag, the message says *"Enable chrome://flags/#canvas-draw-element, or use a page from this site."* Follow the steps above.
- With the flag on, it says *"Only pages from this site can be shown while the browser pauses the page."* This happens with pages from other sites. The Inspector is from this site, so it should still draw.

An immersive VR session pauses page rendering in the browser, so Kithin switches to the snapshot renderer automatically while you are in VR. If the panel looks slightly different from the flat version, that is why.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| The Inspector panel stays blank | Enable the flag, relaunch the browser and reload Kithin. |
| The flag isn't listed | Update your browser, or use a Chromium-based one. |
| Text looks blurry or the panel updates slowly | Expected with the fallback renderer. Enable the flag to use the native one. |
| A web page from another site doesn't show | Only the native API can draw other sites, and only as far as its specification allows. |
