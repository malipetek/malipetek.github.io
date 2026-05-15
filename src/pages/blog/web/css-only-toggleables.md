---
layout: ../../../layouts/BaseLayout.astro
title: Old trick to use state on web pages without any js
description:
summary:
keywords:
image:
---

# Toggle something on a Web page without JS

You can build temporary/permanent states with CSS-only toggles using checkboxes, labels, and sibling selectors.

## Labels and inputs
`<label for="id">` activates the related `<input>` and lets checkbox state model UI without JavaScript.

## `:checked` state
Use sibling selectors like `~` to style elements only while an input is checked.

```css
.key~.lock{
  color: red;
}
```

The CSS-only pattern works for navigation and overlays when paired with good HTML structure.

<iframe
  height="332"
  style="width: 100%;"
  scrolling="no"
  title="CSS ~ selector example"
  src="https://codepen.io/malipetek/embed/xxwrOow?height=332&theme-id=dark&default-tab=css,result"
  frameborder="no"
  allowtransparency="true"
  allowfullscreen="true"
  loading="lazy">
  See the Pen on CodePen
</iframe>

Also check:

<iframe
  height="455"
  style="width: 100%;"
  scrolling="no"
  title="CSS toggle stuff"
  src="https://codepen.io/malipetek/embed/mdemGPX?height=455&theme-id=dark&default-tab=result"
  frameborder="no"
  allowtransparency="true"
  allowfullscreen="true"
  loading="lazy">
  See the Pen on CodePen
</iframe>
