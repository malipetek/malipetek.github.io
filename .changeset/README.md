# Changesets

This directory drives the release of the DeepSeek Harness plugins in
[`packages/`](../packages). The site itself is `private`, so it is never
published.

Add a changeset whenever you change a plugin:

```sh
pnpm changeset          # describe the change, pick the bump
```

Commit the generated markdown file with your change. On merge to `master`,
[`.github/workflows/release.yml`](../.github/workflows/release.yml) either opens
a "chore: release" pull request that applies the version bumps, or — when that
pull request is merged — publishes the bumped packages to npm and pushes the
matching git tags.

To publish locally instead:

```sh
pnpm version-packages   # apply the pending bumps and update changelogs
pnpm release            # publish every package whose version is unpublished
```
