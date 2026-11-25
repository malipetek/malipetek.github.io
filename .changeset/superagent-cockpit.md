---
'@malipetek/dsh-external-agents': minor
'@malipetek/dsh-projects-manager': minor
---

Superagent behaviour the host enforces, and one cockpit for every project.

`dsh-external-agents` gains parallel fan-out (`tasks[]`, four at a time), no
nesting, tier routing with a persisted quota ledger and fallback, project
context injected into every worker, the `STATUS`/`FACT` report contract, and the
Claude Code Stop hook. Each delegation now writes a start record and an end
record, so work in flight and work that died are distinguishable.

`dsh-projects-manager` gains the cockpit: one ranked "needs you" list across
every project (blocked answers, failed runs, the manager's own proposals),
in-flight work, a proposals store with dismissal, and four autonomy levels'
worth of control (`off`, `record`, `act`) over what the manager may suggest or
start. `/projects`, the `projects_manager` tool and the scheduled review all
read the same list; the panel shows it above momentum and can copy a
continuation prompt for handoff to another agent.
