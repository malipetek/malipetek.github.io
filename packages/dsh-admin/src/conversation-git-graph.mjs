import { createElement, useEffect, useState } from 'react';

export async function graphEligibility(sessionId, signal, fetcher = globalThis.fetch) {
  try {
    const response = await fetcher('api/admin/command', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'git-graph-eligibility', sessionId }), signal,
    });
    if (response.ok) {
      const { status } = await response.json();
      if (status === 'ready' || status === 'no-repo') return status;
    }
  } catch { /* No fallback through a different session or transport. */ }
  return 'unavailable';
}

export function graphBody(sessionId, View, status) {
  let message;
  if (typeof View !== 'function') message = 'Git Graph is unavailable. Enable the native Git Graph plugin to use this tab.';
  else if (status === 'ready') return createElement(View, { key: sessionId, sessionId });
  else if (status === 'no-repo') message = 'No Git repository was found for this conversation.';
  else if (status === 'checking') message = 'Checking this conversation’s workspace…';
  else message = 'Git Graph is unavailable for this conversation.';
  return createElement('p', { role: 'status', style: { padding: '0 1rem' } }, message);
}

function SessionGraph({ sessionId }) {
  const native = globalThis.__dshGitGraphNative;
  const View = native?.version === 1 && typeof native.View === 'function' ? native.View : undefined;
  const [status, setStatus] = useState('checking');
  useEffect(() => {
    if (!View) return;
    const controller = new AbortController();
    void graphEligibility(sessionId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setStatus(next);
    });
    return () => controller.abort();
  }, [sessionId, View]);
  return createElement('div', {
    style: {
      width: '100%', minWidth: 0, minHeight: 0,
      ...(View && status === 'ready' ? {
        height: 'max(12rem, calc(var(--dsh-conversation-viewport-height, 65vh) - var(--dsh-composer-height, 0px)))',
      } : {}),
    },
  }, graphBody(sessionId, View, status));
}

export function ConversationGitGraph({ sessionId }) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return graphBody(sessionId, undefined, 'unavailable');
  return createElement(SessionGraph, { key: sessionId, sessionId });
}
