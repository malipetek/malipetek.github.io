/*
 * /portal/admin: the shared admin workbench (packages/admin-ui) over the
 * portal's own session. The Worker enforces the admin role on every call.
 */
import { useEffect, useState } from 'react';
import { AdminApp } from '../../packages/admin-ui/src/index.js';
import { api, downloadFile, session } from '../lib/portal';

const call = (method, path, body) => api(path, { method, body });
// The web host can move bytes; the Harness bridge is JSON only.
const files = {
  upload: (path, form) => api(path, { method: 'POST', form }),
  download: (path, name) => downloadFile(path, name),
};

export default function AdminWorkbench() {
  const [state, setState] = useState('checking');
  useEffect(() => {
    if (!session.get()) return void location.replace('/portal');
    api('/portal/me')
      .then(({ user }) => (user.role === 'admin' ? setState('ok') : location.replace('/portal')))
      .catch(() => (session.get() ? setState('error') : location.replace('/portal')));
  }, []);
  if (state === 'checking') return <p style={{ padding: 40, textAlign: 'center' }}>Loading…</p>;
  if (state === 'error') return <p style={{ padding: 40, textAlign: 'center' }}>Could not reach the portal. Reload to try again.</p>;
  return <AdminApp api={call} files={files} platform="web" fullscreen />;
}
