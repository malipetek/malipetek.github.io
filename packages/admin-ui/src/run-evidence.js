export const sortedRuns = (runs = []) => [...runs].sort((a,b) => Number(b.id) - Number(a.id));
export const selectedRun = (runs, id) => id == null ? sortedRuns(runs)[0] ?? null : runs.find(run => String(run.id) === String(id)) ?? null;
export const recordedPatch = (run) => [run?.diff, run?.diff_stat].find(text => typeof text === 'string' && text.trim()) ?? null;
export const verification = (value) => value == null ? 'unknown' : value === true || value === 1 ? 'passed' : 'failed';
export const mergeSteps = (previous = [], fresh = []) => [...new Map([...previous, ...fresh].map(step => [step.seq, step])).values()].sort((a,b) => a.seq - b.seq);
export function reviewTarget(runs) {
 const sorted = sortedRuns(runs);
 for (const run of sorted) {
  const commit = run.commit_sha;
  const ref = commit || (run.shared_to === 'origin' && run.shared_ref) || run.branch;
  if (ref) return {runId:run.id, ref, mutable:!commit, older:run.id !== sorted[0].id};
 }
 return null;
}
