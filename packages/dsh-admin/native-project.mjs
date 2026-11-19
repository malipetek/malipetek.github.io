/** Browser-safe adapter for the verified native Session and Workspace contracts. */
export async function openLocalProject({ projectId, mode = 'session', appId }, { info, sessions, workspace, remote = {} }) {
  const local = await info({ projectId });
  if (!local.exists || !local.path) throw new Error('Configure an existing local checkout first.');
  const unwrap = result => {
    if (result?.ok === false) throw new Error(result.error?.message ?? result.error?.code ?? 'Native workspace action failed.');
    return result?.ok === true ? result.value : result;
  };
  if (mode === 'session') {
    if (typeof workspace?.openSession !== 'function' || typeof sessions?.create !== 'function') throw new Error('Native workspace sessions are unavailable in this host.');
    let workspaceId;
    if (typeof remote.workspace?.create === 'function') {
      const adopted = unwrap(await remote.workspace.create({ path: local.path }));
      workspaceId = adopted?.workspace?.workspaceId;
    }
    const sessionId = await sessions.create(workspaceId ? { workspaceId } : { cwd: local.path });
    await workspace.openSession(sessionId);
    return { projectId, path: local.path, workspaceId, sessionId, opened: true };
  }
  if (!['reveal', 'app'].includes(mode)) throw new Error('Unknown local open action.');
  if (typeof remote.session?.openWorkspacePath !== 'function') throw new Error('Native desktop opening is unavailable in this host.');
  return unwrap(await remote.session.openWorkspacePath({ path: local.path, ...(mode === 'reveal' ? { action: 'reveal' } : appId ? { application: appId } : {}) }));
}
