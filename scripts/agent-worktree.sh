#!/usr/bin/env bash
# Give one agent its own checkout, so parallel work never shares a dirty folder.
#
#   scripts/agent-worktree.sh <branch> [base]
#
# Prints the worktree path. The branch is created from origin/master unless a
# base is given. Worktrees live beside the runner's own (~/.cache/...), so they
# do not clutter the project folder.
set -euo pipefail

branch="${1:?usage: agent-worktree.sh <branch> [base]}"
base="${2:-origin/master}"
repo="$(git rev-parse --show-toplevel)"
root="${MALIPETEK_WORKTREES:-$HOME/.cache/malipetek-runner/worktrees}"
safe="$(printf '%s' "$branch" | tr '/' '-' | tr -cd 'a-zA-Z0-9._-')"
path="$root/$(basename "$repo")-$safe"

if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
  echo "branch $branch already exists; use a new name or remove the old worktree" >&2
  exit 1
fi

git -C "$repo" fetch origin "${base#origin/}" --quiet || true
mkdir -p "$root"
git -C "$repo" worktree add -b "$branch" "$path" "$base"
echo "$path"
