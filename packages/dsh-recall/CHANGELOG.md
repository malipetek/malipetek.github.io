# @malipetek/dsh-recall

## 0.2.0

### Minor Changes

- 21e47a4: Recall: one thread across every project.

  A new bundle indexes the session store this harness already writes — every
  conversation, every project — into a small searchable summary, and exposes it
  from any session:

  - `recall` tool with `search`, `session`, `projects` and `catch_up`;
  - `/recall …` for the same without a model turn;
  - `catch_up` composes a project's card, open work from the cockpit, recent
    delegated runs and its last conversations, so resuming a project does not mean
    reopening it.

  The index re-reads only logs whose mtime moved, hides scratch-directory and
  delegated-worker sessions, and falls back to decoding a log on demand for
  conversations older than the retained window.
