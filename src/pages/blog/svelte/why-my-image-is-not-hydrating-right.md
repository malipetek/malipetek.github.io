---
layout: ../../../layouts/BaseLayout.astro
title: Why my image is not hydrating correctly when Svelte initializes
---

# Why my image is not hydrating correctly when Svelte initializes

This article came from a real issue debugging a hydration mismatch where images looked correct at first render but reloaded and caused a layout shift.

In short, if server-rendered HTML for an image and client render do not align, Svelte can replace nodes during hydration.

For my case, this surfaced when a generated set of image props was spread into `<img />` output from an adapter layer. One attribute mismatch was enough to force replacement behavior.

The practical fix is:

- Keep server-rendered and client-rendered image markup aligned.
- Avoid changing the same image attributes in hydration-critical render paths.
- Ensure placeholders and final props are deterministic in both sides.
- Keep `img` generation logic near the framework boundary instead of dynamic late mutation.

Related deep-dive topics:

- Critical CSS and above-the-fold rendering
- `object-fit`, `aspect-ratio`, and `loading` performance
- Lazy loading and responsive image strategy
- Code splitting and third-party script optimization
