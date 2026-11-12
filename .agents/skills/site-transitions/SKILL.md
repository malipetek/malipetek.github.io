---
name: site-transitions
description: Add or fix a page transition on malipetek.dev, lab.malipetek.dev or the client portal (View Transitions API, shared-element morphs, the zoom into a card, the 3D room). Use for any change that makes something move between two pages or two portal routes, and for any transition that flashes, jumps, pops or does not play.
---

# Site transitions

This skill tells you how transitions work on this site and how to add one.
Read all of it before you change code. Follow the steps in order.
Every rule in "Traps" comes from a real bug in this code. Do not skip them.

## 1. What exists

There are three kinds of transition. Find which kind your change is.

| Kind | When | Where the code is |
|---|---|---|
| A. Page to page | A normal link between two Astro pages on the same origin | `src/layouts/Base.astro` (`@view-transition`, the `pageswap`/`pagereveal` scripts), `src/styles/base.css` section "page transitions" |
| B. Portal route to route | A hash route change inside the portal (`#/ticket/12`) | `src/components/portal/store.js` (`useRoute`), `src/styles/client-portal.css` section starting "Route changes ride" |
| C. Between the two sites | malipetek.dev ↔ lab.malipetek.dev | `Base.astro` "hop" script, `base.css` "the hop between sites". Two origins cannot share a transition. It is played in two halves. Do not try to make it a real view transition. |

Other parts you will meet:

- `--vt-slow` in `src/styles/base.css`: one multiplier for every duration. It can be above 1 for review.
- The portal's first frame: `src/components/portal/PortalFrame.astro`. It is static HTML that stands in until React mounts.
- The 3D scene: `src/lib/workshop3d.ts` (`initWorkshop` = homepage, `initBoard` = portal board).
- The 3D room across portal pages: `src/components/portal/room.js`. The hop from the homepage into the portal: `src/components/portal/sceneHandover.js` (`arrivingBox` = the machine the site sent, spent once; `placeScene` = land it on the page's own machine; `landInWindow` = land it in the room's small window).
- The zoom into a card (camera move): `setCamera` and `zoomFor` in `store.js`, keyframes `cp-zoom-*` in `client-portal.css`.

## 2. How a view transition works (the parts that matter here)

1. The browser takes a picture of every element that has a `view-transition-name` on the old page ("old state").
2. The DOM changes (new page loads, or the update callback runs).
3. The browser takes a picture of every named element on the new page ("new state") at the first frame.
4. For each name it builds `::view-transition-group(name)` with `::view-transition-old(name)` and `::view-transition-new(name)` inside. A name on both sides morphs (position and size animate). A name on one side only fades in or out.
5. Everything without a name is part of the `root` group.

Two facts decide most bugs:

- **Stacking order of groups.** `root` is always at the bottom. Then come the names from the old state, in the old page's paint order. Then the names that only the new state has. So **a name that only the new page has is painted above everything the old page had**, including elements that are visually in front of it.
- **The new state is captured once, at the first frame.** An element that appears later (a React island, `client:only`, anything after a fetch) is not in the new state. It is drawn inside the `root` layer, under every named group. A `view-transition-name` added to it after the capture does nothing.

## 3. Rules for every transition

1. Multiply every duration and delay by the slow factor: `calc(280ms * var(--vt-slow))` in site CSS, `calc(280ms * var(--vt-slow, 1))` in portal CSS. In JS use `slowFactor()` from `sceneHandover.js`.
2. Respect reduced motion. Site: transitions are opted in only under `prefers-reduced-motion: no-preference` (already done in `Base.astro`). Portal: `useRoute` skips `startViewTransition` when reduced motion is on. New JS motion must check `matchMedia('(prefers-reduced-motion: reduce)')`.
3. Each name must be unique on a page at capture time. Two elements with the same name make the browser skip the whole transition.
4. Set a name only for the trip that needs it, and remove it when the transition finishes (`transition.finished.then(clear, clear)`). Also clear it on `pageshow` (the back/forward cache restores the old page with its names).
5. Pieces that must move together use the same duration, the same delay and the same easing (`var(--ease)`). Different values make the pieces drift apart in the middle.
6. To move a picture "as one piece", use one transform with translate and scale from one `transform-origin`. Do not scale around one point and translate toward another.
7. A text box that morphs between two sizes stretches by default. Stop that on the old and new pictures:
   ```css
   ::view-transition-old(x), ::view-transition-new(x) { height: 100%; object-fit: none; object-position: left top; }
   ```
   (See `cp-peek` in `client-portal.css`.) Let only a heading scale.
8. Write comments the way the surrounding code does: say why, in plain words.

## 4. Recipes

### A1. A shared element between two Astro pages (same origin)

Use this when one element is on both pages (a title, a logo, a card that becomes a header).

1. If the element is the same on every page (the header mark), give it a fixed name in `base.css` like `.wordmark-root { view-transition-name: brand; }`.
2. If the element is one of many (a row in a list → that row's detail page), do not give all rows a name. Add its selector to `TITLES` in the "list title" script in `Base.astro`. That script names the one row whose link matches the other page, in `pageswap` (old page) and `pagereveal` (new page), and clears the name after.
3. Add timing in `base.css` inside `html:active-view-transition-type(page) { ... }`: a `::view-transition-group(name)` with duration and `var(--ease)`.
4. If the element exists on one page only, it fades. If that is wrong, give it a partner on the other page or set `view-transition-name: none` for that trip.

### A2. A page arriving needs a name that depends on where it came from

Set or remove names in a `pagereveal` listener in `Base.astro`. The new state is captured after `pagereveal`, so changes there count. Read the old page's URL from `navigation.activation.from.url`. Restore the name in `e.viewTransition.finished.then(...)`.
Example in the code: arriving from `/portal`, the site header drops its name for that trip (see trap T3).

### B1. A shared element between two portal routes

1. Give the element on both routes the same name, only for this trip. In React: `style={fromX ? { viewTransitionName: 'cp-x' } : undefined}`.
2. Decide `fromX` once, at mount, in a `useState` initializer. React renders more than once before the browser captures; a flag read and cleared during render is gone by the second render.
3. Keep the memory between routes in `boardReturn` in `store.js` (for example `peek`, `sheet`, `reopen`). Document each field in the comment above `boardReturn`.
4. Add CSS next to `cp-peek` / `cp-project` in `client-portal.css`.
5. The update runs inside `document.startViewTransition(() => flushSync(apply))`. Do not add another `startViewTransition`.

### B2. A camera zoom into a card (the page moves into the card)

The zoom already works for a request card (`peek`) and a project sheet (`sheet`). To add a new card:

1. When the card is clicked, save its box: `getBoundingClientRect()` → `{ left, top, width }`.
2. In `zoomFor(prev, next)` in `store.js`, return `{ way: 'in', card, head: '<selector of the next page's head>' }` for that case.
3. The card and the head must also share a name (recipe B1), so the card grows into the head while the page moves.
4. `setCamera` measures the head after the update and sets the CSS variables. The keyframes `cp-zoom-*` use them. You do not need new keyframes.
5. For a way back (`way: 'out'`), the old page must reopen the card where it was (see `reopen` in `TicketView.jsx` and `Board.jsx`).

### B3. Something on the new page appears only after the capture

The element is drawn under the named groups and jumps in front when the transition ends (trap T1). Choose one:

- **Hold it back, then bring it in.** Hide it while the transition runs and let a CSS transition bring it in after. Example: `.cp-overview--guest` waits while `html[data-vt-scene]` is set and rises in when it is removed.
- **Hand over early.** If the moving picture lands exactly on the live element, remove the picture as soon as the live element is ready. Example: `data-vt-scene-ready='same'` in `sceneHandover.js` and `base.css`.
- **Land it somewhere.** A page reached by a hop that has no board of its own (a portal page whose room is the small window, room.js) must give the picture a destination before the guard runs out, or it stands in front of the page and the machine then appears at the top. `landInWindow` maps the whole picture onto the frame the room draws there (its own `boxLens`), so the live canvas takes over on the same pixels.

Do not try to fix it by adding a `view-transition-name` to the late element. It does nothing (section 2).

### B4. The 3D room

The board does not stop when the overview unmounts. It becomes the room (`room.js`) and the route gives it a role (`roomModeOf` in `store.js`):
overview = the board itself, a request or a project = faded backdrop, any other page = small window (`.cp-roombox`).

- To change the role for a page, change `roomModeOf`.
- A new 3D effect goes through the `Board` API in `workshop3d.ts` (`focus`, `focusNode`, `lane`, `zoomView`, `reframe`, `arrive`). Do not reach into the scene from React.
- To swap one canvas for another invisibly, the second must draw the same frame: same camera, same lens shift (`setViewOffset`), same pointer lean, same animation clock. `initWorkshop`'s `start` and `initBoard`'s `arrival` carry these across.
- To end a live 3D view on the last frame of a 2D zoom of its own picture, use `zoomView({ cx, cy, hx, hy, s })`. It draws a sub-window of the picture, which equals the 2D zoom. `s` below 1 zooms out.
- Do not morph a 3D canvas between two places with a CSS view transition when the two places show different framings. The browser can only cross-fade two pictures, and they do not line up. Move the live canvas instead: keep it full-window, and animate a clip (`clip-path: inset(...)`) and a `zoomView` lens in JavaScript. During the page transition, show the canvas live and still (name it, hide its old picture, no animation on its group). `room.js` does this for the small window; copy that.

## 5. Traps (each one was a real bug)

| # | Symptom | Cause | Fix |
|---|---|---|---|
| T1 | Content sits behind a moving picture and jumps in front at the end | It mounted after the capture, so it is in `root`, under every named group | Recipe B3 |
| T2 | A shared element fades out and pops back at the end | A name only the new page has (for example the site header) is stacked above it and fades in over it | Remove that name for this trip in `pagereveal` (recipe A2), or give it a partner on the old page |
| T3 | Same as T2, header case | The portal has no site header; arriving on the site, `site-head` was new-only and covered the travelling mark | Done in `Base.astro`: arriving from `/portal`, `.site-head` has no name for the trip |
| T4 | A moving element is blurred | A named element with `backdrop-filter` (the portal sidebar) is stacked above it | Do not give that element its own name for the trip |
| T5 | Nothing animates; a whole inline script does nothing | TypeScript syntax in an `is:inline` script. Astro does not compile inline scripts, so the browser gets a syntax error | Plain JavaScript only in `is:inline` scripts. TypeScript is fine in a bundled `<script>` |
| T6 | The transition is skipped | Two elements with the same name at capture | Names only for the trip, one element per name |
| T7 | Something scales to nothing or flies to a corner | A measurement taken before the element had a size (a canvas's first frame at 1×1) | Ignore measurements below a sane minimum and wait for the next frame (`MIN_LANDING_WIDTH` in `sceneHandover.js`) |
| T8 | A transition plays only sometimes | The new page painted before its content existed | `Base.astro` takes `expect` (a selector) and emits `<link rel="expect" blocking="render">`. Pass the main content's selector |
| T9 | State from an earlier transition breaks later ones | A replaced transition never finished, so its attributes stayed on `<html>` | Clear state at the start of each change and keep a watchdog (see `clearZoom` and `WATCHDOG` in `store.js`) |
| T10 | `ReferenceError: Cannot access 'x' before initialization` during setup | A function used by the first render is declared lower down with `const` | Declare it before the first call (`initBoard` draws during setup) |
| T11 | Stale names after Back | The back/forward cache restored the page with trip names on it | Clear names on `pageshow` |
| T12 | A morphing canvas slides away and fades instead of landing in its new place | Two pictures with different framings cross-fade; they never line up | Animate the live canvas (clip + lens), see recipe B4 |
| T13 | A morph is cut off by something appearing on top | The next page's own element (a new board) showed before the morph ended | Keep it hidden until the moving one says it has finished (`handOver` in `room.js`) |
| T14 | The homepage's 3D picture stretches down the page while an entrance plays (after the hop from the lab) | A `transform` (or `filter`) on `main`, even an animated one, makes `main` the containing block of the `position: fixed` workshop canvas, so the canvas takes `main`'s height | Animate only `opacity` on `main` or any element with fixed descendants (`hop-fade-in` in `base.css`); move children, not the container |
| T15 | The camera flies in from the homepage's machine to the board every time the overview is reached again, in a load that did not come from the site | The hop's measurement (`sessionStorage.scene-box`) was read fresh by every mount, and only a landing ever cleared it; the overview remounts on each hash change | Spend it once per page load (`arrivingBox` in `sceneHandover.js` reads and removes it for good) and only use it while `data-vt-scene='in'` |
| T16 | The machine hangs at full size in front of a portal page, then the little window at the top gets it | A hop into a page with no board (room mode `mini`) leaves the paused old(scene) picture waiting for a landing nobody makes; Base.astro's guard clears it after `1400ms * --vt-slow` | `landInWindow` from room.js: land it on the frame the room draws, then set `data-vt-scene-ready` |

## 6. How to check your work

Do not report a transition as done without a check. Build first: `pnpm run build`.

- **Headless screenshots do not show transition pictures reliably.** Use these instead:
  - Which animations run, with names and timings: in the page, `document.getAnimations().filter(a => a.effect?.pseudoElement).map(a => [a.effect.pseudoElement, a.animationName, a.effect.getComputedTiming().duration])`.
  - When the transition ends: in `page.addInitScript`, listen to `pagereveal` and log the time of `e.viewTransition.finished`.
  - To see frames: launch Chrome with `headless: false` and the window off screen (`--window-position=-2400,-2400`), slow all animations with the DevTools protocol (`Animation.enable`, then `Animation.setPlaybackRate` with `playbackRate: 0.1`), then take screenshots every ~0.7 s.
- **Signed-in portal pages:** the dev server has no API by default. Start a second one with a fake endpoint, `PUBLIC_CHAT_ENDPOINT=http://mock.test npx astro dev --port 4325 --host 127.0.0.1`, answer `http://mock.test/**` with `context.route` (`/portal/me`, `/portal/tickets`, CORS headers, `OPTIONS`), and set `localStorage['portal-session']`. Stop the server when you are done.
- Check both directions (there and back), Back/Forward, a direct load of the second page, a phone width (390 px) and reduced motion.
- If you cannot check something (for example a click inside the 3D board), say so in your report. Do not claim it works.

## 7. Before you finish

- [ ] Every duration uses `--vt-slow`.
- [ ] Names exist only for the trip and are cleared.
- [ ] No new-only name covers a shared element (trap T2).
- [ ] Nothing that mounts late is expected to be in a named group (trap T1).
- [ ] No TypeScript in `is:inline` scripts.
- [ ] Reduced motion still gets the page with no motion.
- [ ] `pnpm run build` passes.
- [ ] You checked it (section 6) and your report says what you checked and what you did not.
