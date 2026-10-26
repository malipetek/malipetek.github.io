# Real-React render test

[`dev-client-smoke.mjs`](../dev-client-smoke.mjs) drives the browser bundle with a
miniature hook runtime. That runtime is fast, has no dependencies and catches a
component that throws — but it is not React, so it cannot fail a component for
breaking the rules of hooks across a re-render, and it has no event system.

This directory closes that gap. It mounts the real bundle with
`react-dom/client` into jsdom, and drives it the way a person would:

```sh
./dev-react/setup.sh && node dev-react/render.mjs
```

React, React DOM and jsdom are installed into a scratch directory
(`/tmp/dsh-action-cards-react` by default) rather than added to the plugin, which
keeps the package dependency-free. `setup.sh` uses pnpm — the package manager the
Harness itself bundles.

What it checks, on the real rendering path:

- the card's first paint: title, note, both step kinds, both declared fields, the
  hint, the seeded default, and the secret field rendered as a password box;
- **Apply is refused while a required value is missing**, and becomes available
  once one is typed through React's own event system;
- the preview block substitutes typed *and* seeded values and leaves no
  placeholder behind;
- clicking Apply reaches the callback face with the **edited** value, the original
  steps, the right action id and the right session scope;
- the card then settles: the outcome and status render, and the Apply button goes;
- the `preparing` → `start` phase change remounts rather than complaining about
  hook order — the preparing phase calls a hook the started phase does not;
- the Host's pre-flight checks reach the DOM (the overwrite warning and the
  ambiguity warning);
- a proposal restored from the store with no arguments recovers its title, steps,
  status and outcome;
- the Sidebar panel counts statuses, filters to what is waiting, and applies from
  the list on the real React path, and it offers no link to the page it is already
  drawn in;
- the composer review popup stays away when nothing waits, opens its form in place
  on **Review** without sending you to the Sidebar, offers the link out to the
  panel from the open form, closes again on **Hide**, and returns when the count
  changes after a dismissal;
- degraded input does not blank the slot: a call-less result, and an unreadable
  store, both still render a usable card.

A throwing component blanks its entire slot, and a rules-of-hooks violation
crashes the whole conversation view, so both are worth failing loudly here rather
than discovering in the app.
