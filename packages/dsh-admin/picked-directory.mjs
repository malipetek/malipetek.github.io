/**
 * The folder a directory-picker call returned, as a path string or null.
 * `ctx.remote.directoryPicker.pick()` answers with a result envelope,
 * `{ ok: true, value: string | null }` or `{ ok: false, error }`; older hosts
 * answered with the bare path. A failure throws with the host's message.
 * @module @malipetek/dsh-admin/picked-directory
 */
export function pickedDirectory(result) {
  if (result === null || result === undefined) return null;
  if (typeof result === 'string') return result.trim() === '' ? null : result;
  if (typeof result === 'object' && 'ok' in result) {
    if (!result.ok) throw new Error(`Could not choose a folder: ${result.error?.message ?? 'the picker failed'}`);
    return pickedDirectory(result.value);
  }
  return null;
}
