/**
 * Client half of the Admin panel bundle.
 *
 * Reads the snapshot the Host writes and renders it as a page in the main slot
 * with a row in the sidebar panel list. Mutations travel back as Cordis
 * commands through `remote.commands.execute`, so approving a ticket or sending
 * a reply spends no model turn and never enters the conversation.
 *
 * @module @malipetek/dsh-admin
 */
window.__ModuleLoader__.load({
  id: '@malipetek/dsh-admin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback, useRef } = React;

    /** Panel identity: one id addresses both the sidebar row and the main page. */
    const PANEL_ID = 'admin';
    /** Locale namespace for visible strings. */
    const NAMESPACE = 'admin';
    /** Reported to the Host on activation, so "did the panel load?" has an answer. */
    const CLIENT_VERSION = '1.0.0';

    /**
     * The files the Host half writes. Absolute literals because this side
     * cannot read the Host environment; `index.js` hardcodes the same paths.
     */
    const SNAPSHOT_PATH = '/Users/malipetek/.dsh/admin/state.json';
    const OPEN_PATH = '/Users/malipetek/.dsh/admin/open-ticket.json';

    /** The file Remote caps one text page at this many lines. */
    const PAGE_LINES = 5000;
    /** Hard stop so a pathological file cannot spin the reader. */
    const MAX_PAGES = 8;
    /** How often the panel re-reads the snapshot the Host refreshes. */
    const POLL_MS = 15000;

    /** Theme tokens the rest of the shell uses. */
    const C = {
      base: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      text: 'var(--dsw-alias-label-primary)',
      textSecondary: 'var(--dsw-alias-label-secondary)',
      textTertiary: 'var(--dsw-alias-label-tertiary)',
      inverted: 'var(--dsw-alias-label-primary-inverted)',
      border: 'var(--dsw-alias-border-l2)',
      borderStrong: 'var(--dsw-alias-border-l3)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      business: 'var(--dsw-alias-state-business-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
      radius: 'var(--dsw-radius-sm)',
    };

    /** Colour per ticket status, so the queue reads at a glance. */
    const STATUS_COLOR = {
      new: C.warn,
      approved: C.business,
      in_progress: C.idle,
      review: C.success,
      done: C.textTertiary,
      declined: C.textTertiary,
    };

    /** Visible strings, registered as a locale namespace. */
    const DICTIONARY = {
      title: 'Admin',
      subtitle: 'malipetek.dev portal',
      tickets: 'Tickets',
      directory: 'Clients & projects',
      refresh: 'Refresh',
      loading: 'Loading…',
      empty: 'Nothing here yet.',
      signedOut: 'Signed out',
      signInHelp:
        'Paste a portal session token to load the portal. Get one from malipetek.dev: sign in at /portal, then run localStorage.getItem("portal-session") in the browser console.',
      signIn: 'Sign in',
      token: 'Session token',
      reply: 'Reply',
      note: 'Private note',
      replyPlaceholder: 'Write to the client…',
      notePlaceholder: 'Note for yourself…',
      send: 'Send',
      save: 'Save',
      open: 'Open',
      back: '← Queue',
      clients: 'Clients',
      projects: 'Projects',
      noProjects: 'No projects yet. Create one before a ticket can be worked.',
      createProject: 'Create project',
      name: 'Name',
      slug: 'Slug',
      linked: 'linked',
      unlink: 'Unlink',
      link: 'Link',
      updated: 'updated',
      messages: 'messages',
    };

    /* ——————————————————————— helpers ——————————————————————— */

    /** A readable message from anything thrown. */
    function messageOf(error) {
      if (error === null || error === undefined) return 'Unknown error';
      if (typeof error === 'string') return error;
      return error.message ?? String(error);
    }

    /**
     * Read a whole file through the session-scoped file Remote, one page at a
     * time. A missing file is not an error: the Host may not have written yet.
     * @returns the text, or null when the file does not exist.
     */
    async function readTextFile(remote, sessionId, path, signal) {
      let offset = 1;
      let text = '';
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await remote.read(sessionId, path, { offset, limit: PAGE_LINES }, signal);
        if (result.ok !== true) {
          const error = result.error ?? {};
          if (error.code === 'not_found' || error.code === 'ENOENT') return null;
          throw new Error(`${error.code ?? 'read-failed'}${typeof error.message === 'string' ? `: ${error.message}` : ''}`);
        }
        const value = result.value ?? {};
        const chunk = typeof value.text === 'string' ? value.text : '';
        if (chunk.length > 0) text += (text.length > 0 ? '\n' : '') + chunk;
        if (value.eof === true) break;
        const lines = typeof value.lines === 'number' ? value.lines : 0;
        if (lines === 0) break;
        offset += lines;
      }
      return text;
    }

    /** Parse JSON, returning null rather than throwing. */
    function parseJson(text) {
      if (typeof text !== 'string' || text.trim().length === 0) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    /** The first open session id, which authorizes a Host read. */
    function firstSessionId(ctx) {
      const snapshot = ctx.sessions.list.getSnapshot();
      const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : [];
      return ids[0];
    }

    /** A short relative time, for "updated 4m ago". */
    function ago(unixSeconds) {
      if (!Number.isFinite(unixSeconds)) return '';
      const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
      if (seconds < 60) return `${seconds}s`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
      return `${Math.floor(seconds / 86400)}d`;
    }

    /* ——————————————————————— components ——————————————————————— */

    /** The sidebar glyph. */
    function AdminIcon({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 20 15.5H9.5L5 19v-3.5H4A1.5 1.5 0 0 1 2.5 14V7A1.5 1.5 0 0 1 4 5.5z' }),
        h('path', { d: 'M7 9.5h10M7 12h6' }),
      );
    }

    /**
     * A small pill showing a ticket status. The label comes from the Worker's
     * own status list, carried in the snapshot, so it never drifts from what
     * the portal actually accepts.
     */
    function StatusPill({ status, label }) {
      const color = STATUS_COLOR[status] ?? C.textTertiary;
      return h(
        'span',
        {
          style: {
            display: 'inline-block',
            padding: '1px 7px',
            borderRadius: '999px',
            border: `1px solid ${color}`,
            color,
            fontSize: 11,
            lineHeight: '16px',
            whiteSpace: 'nowrap',
          },
        },
        label ?? status,
      );
    }

    /** The signed-out card: token entry plus where to get one. */
    function SignInCard({ api, onDone, t }) {
      const [token, setToken] = useState('');
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      const submit = async (event) => {
        event.preventDefault();
        if (token.trim().length === 0) return;
        setBusy(true);
        setError(null);
        const result = await api.command(`login ${token.trim()}`);
        setBusy(false);
        if (!result.ok) {
          setError(result.text);
          return;
        }
        setToken('');
        onDone?.();
      };

      return h(
        'form',
        {
          onSubmit: submit,
          style: {
            maxWidth: 560,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 16,
            border: `1px solid ${C.border}`,
            borderRadius: C.radius,
            background: C.layer1,
          },
        },
        h('strong', { style: { color: C.text } }, t('signedOut')),
        h('p', { style: { margin: 0, color: C.textSecondary, fontSize: 12, lineHeight: 1.5 } }, t('signInHelp')),
        h('input', {
          type: 'password',
          value: token,
          placeholder: t('token'),
          onChange: (event) => setToken(event.target.value),
          style: {
            padding: '7px 9px',
            borderRadius: C.radius,
            border: `1px solid ${C.border}`,
            background: C.base,
            color: C.text,
            fontFamily: 'inherit',
            fontSize: 12,
          },
        }),
        error !== null ? h('p', { style: { margin: 0, color: C.error, fontSize: 12 } }, error) : null,
        h(
          'button',
          {
            type: 'submit',
            disabled: busy,
            style: {
              alignSelf: 'flex-start',
              padding: '6px 12px',
              borderRadius: C.radius,
              border: `1px solid ${C.borderStrong}`,
              background: C.layer2,
              color: C.text,
              cursor: busy ? 'default' : 'pointer',
              font: 'inherit',
            },
          },
          busy ? t('loading') : t('signIn'),
        ),
      );
    }

    /** The ticket thread plus the reply and note boxes. */
    function TicketDetail({ api, open, busy, action, t }) {
      const [reply, setReply] = useState('');
      const [note, setNote] = useState('');
      const ticket = open?.ticket ?? null;
      const messages = Array.isArray(open?.messages) ? open.messages : [];

      if (ticket === null) {
        return h('p', { style: { color: C.textSecondary, fontSize: 13 } }, t('loading'));
      }

      const send = async (text, internal) => {
        if (text.trim().length === 0) return;
        const result = await action(internal ? `note ${ticket.id} ${text}` : `reply ${ticket.id} ${text}`);
        if (result.ok) {
          if (internal) setNote('');
          else setReply('');
        }
        return result;
      };

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h(StatusPill, { status: ticket.status, label: api.statusLabels?.[ticket.status] }),
          h('span', { style: { color: C.textTertiary, fontSize: 12 } }, `${messages.length} ${t('messages')}`),
          ticket.project_name !== null && ticket.project_name !== undefined
            ? h('span', { style: { color: C.textTertiary, fontSize: 12 } }, `· ${ticket.project_name}`)
            : h('span', { style: { color: C.textTertiary, fontSize: 12 } }, '· no project'),
        ),
        h('h2', { style: { margin: 0, fontSize: 18, color: C.text } }, ticket.title),
        h(
          'p',
          { style: { margin: 0, color: C.textSecondary, fontSize: 12 } },
          `${ticket.client_email ?? ''} · ${t('updated')} ${ago(ticket.updated_at)} ago`,
        ),

        h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          ...(api.statuses ?? []).map((status) =>
            h(
              'button',
              {
                key: status,
                type: 'button',
                disabled: busy,
                onClick: () => void action(`status ${ticket.id} ${status}`),
                style: {
                  padding: '4px 10px',
                  borderRadius: C.radius,
                  border: `1px solid ${status === ticket.status ? (STATUS_COLOR[status] ?? C.borderStrong) : C.border}`,
                  background: status === ticket.status ? C.layer2 : 'transparent',
                  color: C.text,
                  cursor: busy ? 'default' : 'pointer',
                  font: 'inherit',
                  fontSize: 12,
                },
              },
              api.statusLabels?.[status] ?? status,
            ),
          ),
        ),

        h(
          'ol',
          { style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 } },
          ...messages.map((message) =>
            h(
              'li',
              {
                key: message.id,
                style: {
                  padding: '8px 10px',
                  border: `1px solid ${C.border}`,
                  borderLeft: `3px solid ${message.internal === 1 ? C.warn : C.border}`,
                  borderRadius: C.radius,
                  background: message.internal === 1 ? C.layer2 : C.layer1,
                },
              },
              h(
                'p',
                { style: { margin: '0 0 4px', color: C.textTertiary, fontSize: 11 } },
                `${message.author}${message.internal === 1 ? ' · private' : ''} · ${ago(message.created_at)} ago`,
              ),
              h('p', { style: { margin: 0, color: C.text, fontSize: 13, whiteSpace: 'pre-wrap' } }, message.body),
            ),
          ),
        ),

        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('textarea', {
            value: reply,
            rows: 3,
            placeholder: t('replyPlaceholder'),
            onChange: (event) => setReply(event.target.value),
            style: {
              padding: '7px 9px',
              borderRadius: C.radius,
              border: `1px solid ${C.border}`,
              background: C.base,
              color: C.text,
              font: 'inherit',
              fontSize: 13,
              resize: 'vertical',
            },
          }),
          h(
            'div',
            { style: { display: 'flex', gap: 6 } },
            h(
              'button',
              {
                type: 'button',
                disabled: busy || reply.trim().length === 0,
                onClick: () => void send(reply, false),
                style: {
                  padding: '5px 12px',
                  borderRadius: C.radius,
                  border: `1px solid ${C.borderStrong}`,
                  background: C.layer2,
                  color: C.text,
                  cursor: 'pointer',
                  font: 'inherit',
                },
              },
              t('reply'),
            ),
          ),
        ),

        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('textarea', {
            value: note,
            rows: 2,
            placeholder: t('notePlaceholder'),
            onChange: (event) => setNote(event.target.value),
            style: {
              padding: '7px 9px',
              borderRadius: C.radius,
              border: `1px dashed ${C.border}`,
              background: C.layer1,
              color: C.text,
              font: 'inherit',
              fontSize: 13,
              resize: 'vertical',
            },
          }),
          h(
            'div',
            { style: { display: 'flex', gap: 6 } },
            h(
              'button',
              {
                type: 'button',
                disabled: busy || note.trim().length === 0,
                onClick: () => void send(note, true),
                style: {
                  padding: '5px 12px',
                  borderRadius: C.radius,
                  border: `1px dashed ${C.borderStrong}`,
                  background: 'transparent',
                  color: C.textSecondary,
                  cursor: 'pointer',
                  font: 'inherit',
                },
              },
              t('note'),
            ),
          ),
        ),
      );
    }

    /** Clients and projects: who may file against what. */
    function DirectoryTab({ api, snapshot, busy, action, t }) {
      const [name, setName] = useState('');
      const [slug, setSlug] = useState('');
      const projects = snapshot?.projects ?? [];
      const clients = snapshot?.clients ?? [];
      const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

      const create = async (event) => {
        event.preventDefault();
        if (name.trim().length === 0 || slug.trim().length === 0) return;
        const result = await action(`project ${name.trim()} ${slug.trim().toLowerCase()}`);
        if (result.ok) {
          setName('');
          setSlug('');
        }
        return result;
      };

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 18 } },

        h(
          'section',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('h3', { style: { margin: 0, fontSize: 13, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' } }, t('projects')),
          projects.length === 0
            ? h('p', { style: { margin: 0, color: C.textTertiary, fontSize: 13 } }, t('noProjects'))
            : h(
                'ul',
                { style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
                ...projects.map((project) =>
                  h(
                    'li',
                    {
                      key: project.id,
                      style: {
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        padding: '6px 9px',
                        border: `1px solid ${C.border}`,
                        borderRadius: C.radius,
                        background: C.layer1,
                        fontSize: 13,
                      },
                    },
                    h('code', { style: { color: C.text } }, project.slug),
                    h('span', { style: { color: C.textSecondary } }, project.name),
                  ),
                ),
              ),
          h(
            'form',
            { onSubmit: create, style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
            h('input', {
              value: name,
              placeholder: t('name'),
              onChange: (event) => setName(event.target.value),
              style: {
                padding: '6px 9px',
                borderRadius: C.radius,
                border: `1px solid ${C.border}`,
                background: C.base,
                color: C.text,
                font: 'inherit',
                fontSize: 12,
              },
            }),
            h('input', {
              value: slug,
              placeholder: t('slug'),
              onChange: (event) => setSlug(event.target.value),
              style: {
                padding: '6px 9px',
                borderRadius: C.radius,
                border: `1px solid ${C.border}`,
                background: C.base,
                color: C.text,
                font: 'inherit',
                fontSize: 12,
              },
            }),
            h(
              'button',
              {
                type: 'submit',
                disabled: busy,
                style: {
                  padding: '6px 12px',
                  borderRadius: C.radius,
                  border: `1px solid ${C.borderStrong}`,
                  background: C.layer2,
                  color: C.text,
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 12,
                },
              },
              t('createProject'),
            ),
          ),
        ),

        h(
          'section',
          { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h('h3', { style: { margin: 0, fontSize: 13, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' } }, t('clients')),
          clients.length === 0
            ? h('p', { style: { margin: 0, color: C.textTertiary, fontSize: 13 } }, t('empty'))
            : h(
                'ul',
                { style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 } },
                ...clients.map((client) => {
                  const linked = client.projectIds ?? [];
                  const unlinked = projects.filter((project) => !linked.includes(project.id));
                  return h(
                    'li',
                    {
                      key: client.id,
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '8px 10px',
                        border: `1px solid ${C.border}`,
                        borderRadius: C.radius,
                        background: C.layer1,
                      },
                    },
                    h(
                      'div',
                      { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
                      h('strong', { style: { color: C.text, fontSize: 13 } }, client.email),
                      h('span', { style: { color: C.textTertiary, fontSize: 11 } }, `${client.role} · ${client.ticket_count} ticket(s)`),
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
                      ...linked.map((projectId) =>
                        h(
                          'span',
                          {
                            key: projectId,
                            style: {
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '2px 8px',
                              borderRadius: '999px',
                              border: `1px solid ${C.borderStrong}`,
                              fontSize: 11,
                              color: C.textSecondary,
                            },
                          },
                          byId.get(projectId)?.slug ?? projectId,
                          h(
                            'button',
                            {
                              type: 'button',
                              disabled: busy,
                              onClick: () => void action(`unlink ${client.id} ${projectId}`),
                              title: t('unlink'),
                              style: {
                                border: 'none',
                                background: 'transparent',
                                color: C.textTertiary,
                                cursor: 'pointer',
                                font: 'inherit',
                                fontSize: 12,
                                padding: 0,
                              },
                            },
                            '×',
                          ),
                        ),
                      ),
                      unlinked.length > 0
                        ? h(
                            'select',
                            {
                              value: '',
                              disabled: busy,
                              onChange: (event) => {
                                if (event.target.value.length > 0) void action(`link ${client.id} ${event.target.value}`);
                              },
                              style: {
                                padding: '3px 6px',
                                borderRadius: C.radius,
                                border: `1px solid ${C.border}`,
                                background: C.base,
                                color: C.textSecondary,
                                font: 'inherit',
                                fontSize: 11,
                              },
                            },
                            h('option', { value: '' }, `${t('link')}…`),
                            ...unlinked.map((project) => h('option', { key: project.id, value: project.id }, project.slug)),
                          )
                        : null,
                    ),
                  );
                }),
              ),
        ),
      );
    }

    /** Fallback for a render that happens before the locale seat arrives. */
    function translate(key) {
      return DICTIONARY[key] ?? key;
    }

    /** The page: tabs over the snapshot. */
    function AdminPage({ api, t: seat }) {
      const t = seat ?? translate;
      const [tab, setTab] = useState('tickets');
      const [snapshot, setSnapshot] = useState(null);
      const [open, setOpen] = useState(null);
      const [selected, setSelected] = useState(null);
      const [filter, setFilter] = useState('all');
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState(null);
      const selectedRef = useRef(null);

      selectedRef.current = selected;

      const load = useCallback(
        (signal) => {
          api.readSnapshot(signal).then(
            (value) => setSnapshot(value ?? { signedIn: false, error: null, tickets: [], clients: [], projects: [] }),
            (error) => setSnapshot({ signedIn: false, error: messageOf(error), tickets: [], clients: [], projects: [] }),
          );
        },
        [api],
      );

      useEffect(() => {
        const controller = new AbortController();
        load(controller.signal);
        const timer = setInterval(() => load(controller.signal), POLL_MS);
        return () => {
          controller.abort();
          clearInterval(timer);
        };
      }, [load]);

      const openTicket = useCallback(
        async (id) => {
          setSelected(id);
          setBusy(true);
          const result = await api.command(`open ${id}`);
          if (result.ok) {
            const detail = await api.readOpenTicket().catch(() => null);
            setOpen(detail);
          }
          setBusy(false);
          if (!result.ok) setNotice({ kind: 'error', text: result.text });
          return result;
        },
        [api],
      );

      /** Run one command, refresh the snapshot, and surface the outcome. */
      const action = useCallback(
        async (line) => {
          setBusy(true);
          const result = await api.command(line);
          setNotice({ kind: result.ok ? 'ok' : 'error', text: result.text });
          load();
          const current = selectedRef.current;
          if (current !== null && /^(status|reply|note) /.test(line)) {
            const detail = await api.readOpenTicket().catch(() => null);
            setOpen(detail);
          }
          setBusy(false);
          return result;
        },
        [api, load],
      );

      if (snapshot === null) {
        return h('div', { style: { padding: 20, color: C.textSecondary, fontSize: 13 } }, t('loading'));
      }

      if (snapshot.signedIn === false) {
        return h(
          'div',
          { style: { padding: 20, display: 'flex', flexDirection: 'column', gap: 12 } },
          h('h1', { style: { margin: 0, fontSize: 18, color: C.text } }, t('title')),
          h(SignInCard, { api, t, onDone: () => load() }),
          snapshot.error ? h('p', { style: { margin: 0, color: C.textTertiary, fontSize: 12 } }, snapshot.error) : null,
        );
      }

      const tickets = snapshot.tickets ?? [];
      const statuses = snapshot.statuses ?? [];
      const counts = tickets.reduce((accumulator, ticket) => {
        accumulator[ticket.status] = (accumulator[ticket.status] ?? 0) + 1;
        return accumulator;
      }, {});
      const visible = filter === 'all' ? tickets : tickets.filter((ticket) => ticket.status === filter);

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 20, minHeight: 0, height: '100%', background: C.base } },

        h(
          'header',
          { style: { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' } },
          h('h1', { style: { margin: 0, fontSize: 18, color: C.text } }, t('title')),
          h('span', { style: { color: C.textTertiary, fontSize: 12 } }, `${t('subtitle')} · ${snapshot.endpoint ?? ''}`),
          h('span', { style: { flex: 1 } }),
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: () => void action('refresh'),
              style: {
                padding: '5px 12px',
                borderRadius: C.radius,
                border: `1px solid ${C.border}`,
                background: 'transparent',
                color: C.textSecondary,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 12,
              },
            },
            t('refresh'),
          ),
        ),

        snapshot.error ? h('p', { style: { margin: 0, color: C.error, fontSize: 12 } }, snapshot.error) : null,

        h(
          'div',
          { style: { display: 'flex', gap: 6 } },
          ...[
            ['tickets', t('tickets')],
            ['directory', t('directory')],
          ].map(([key, label]) =>
            h(
              'button',
              {
                key,
                type: 'button',
                onClick: () => setTab(key),
                style: {
                  padding: '5px 12px',
                  borderRadius: C.radius,
                  border: `1px solid ${tab === key ? C.borderStrong : C.border}`,
                  background: tab === key ? C.layer2 : 'transparent',
                  color: tab === key ? C.text : C.textSecondary,
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 12,
                },
              },
              label,
            ),
          ),
        ),

        notice ? h('p', { style: { margin: 0, color: notice.kind === 'ok' ? C.textSecondary : C.error, fontSize: 12 } }, notice.text) : null,

        tab === 'directory'
          ? h(DirectoryTab, { api: { ...api, statuses, statusLabels: snapshot.statusLabels }, snapshot, busy, action, t })
          : h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'minmax(240px, 340px) 1fr', gap: 14, minHeight: 0, flex: 1 } },

              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 } },
                h(
                  'div',
                  { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => setFilter('all'),
                      style: {
                        padding: '3px 9px',
                        borderRadius: '999px',
                        border: `1px solid ${filter === 'all' ? C.borderStrong : C.border}`,
                        background: filter === 'all' ? C.layer2 : 'transparent',
                        color: C.textSecondary,
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 11,
                      },
                    },
                    `all ${tickets.length}`,
                  ),
                  ...statuses
                    .filter((status) => (counts[status] ?? 0) > 0)
                    .map((status) =>
                      h(
                        'button',
                        {
                          key: status,
                          type: 'button',
                          onClick: () => setFilter(status),
                          style: {
                            padding: '3px 9px',
                            borderRadius: '999px',
                            border: `1px solid ${filter === status ? (STATUS_COLOR[status] ?? C.borderStrong) : C.border}`,
                            background: filter === status ? C.layer2 : 'transparent',
                            color: STATUS_COLOR[status] ?? C.textSecondary,
                            cursor: 'pointer',
                            font: 'inherit',
                            fontSize: 11,
                          },
                        },
                        `${snapshot.statusLabels?.[status] ?? status} ${counts[status] ?? 0}`,
                      ),
                    ),
                ),
                h(
                  'ul',
                  { style: { listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 } },
                  ...(visible.length === 0
                    ? [h('li', { key: 'empty', style: { color: C.textTertiary, fontSize: 13 } }, t('empty'))]
                    : visible.map((ticket) =>
                        h(
                          'li',
                          { key: ticket.id },
                          h(
                            'button',
                            {
                              type: 'button',
                              onClick: () => void openTicket(ticket.id),
                              style: {
                                width: '100%',
                                textAlign: 'left',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                padding: '8px 10px',
                                borderRadius: C.radius,
                                border: `1px solid ${selected === ticket.id ? C.borderStrong : C.border}`,
                                background: selected === ticket.id ? C.layer2 : C.layer1,
                                color: C.text,
                                cursor: 'pointer',
                                font: 'inherit',
                              },
                            },
                            h(StatusPill, { status: ticket.status, label: snapshot.statusLabels?.[ticket.status] }),
                            h('span', { style: { fontSize: 13 } }, ticket.title),
                            h(
                              'span',
                              { style: { color: C.textTertiary, fontSize: 11 } },
                              `${ticket.project_name ?? 'no project'} · ${ago(ticket.updated_at)} ago`,
                            ),
                          ),
                        ),
                      )),
                ),
              ),

              h(
                'div',
                { style: { overflowY: 'auto', minHeight: 0, paddingRight: 4 } },
                selected === null
                  ? h('p', { style: { color: C.textTertiary, fontSize: 13 } }, t('empty'))
                  : h(TicketDetail, {
                      api: { ...api, statuses, statusLabels: snapshot.statusLabels },
                      open,
                      busy,
                      action,
                      t,
                    }),
              ),
            ),
      );
    }

    /* ——————————————————————— cordis plugin ——————————————————————— */

    /** Services this Client plugin needs. */
    const inject = ['slots', 'sessions', 'layout', 'remote', 'remote.workspaceFiles', 'remote.commands'];

    /**
     * Register the sidebar row and the main page.
     * @param ctx - the Client plugin context.
     */
    function apply(ctx) {
      /** One stable object so React effects that depend on it do not re-run. */
      const api = {
        readSnapshot: (signal) => {
          const sessionId = firstSessionId(ctx);
          if (sessionId === undefined) return Promise.resolve(null);
          return readTextFile(ctx.remote.workspaceFiles, sessionId, SNAPSHOT_PATH, signal).then(parseJson);
        },
        readOpenTicket: (signal) => {
          const sessionId = firstSessionId(ctx);
          if (sessionId === undefined) return Promise.resolve(null);
          return readTextFile(ctx.remote.workspaceFiles, sessionId, OPEN_PATH, signal).then(parseJson);
        },
        command: async (line) => {
          const sessionId = firstSessionId(ctx);
          if (sessionId === undefined) return { ok: false, text: 'No session is open. Open a session, then try again.' };
          try {
            const result = await ctx.remote.commands.execute(sessionId, line, []);
            // The Remote reports success as `ok`; treat a bare command result
            // defensively so a shape change shows up as a message, not a crash.
            const ok = result?.ok === true || result?.kind === 'success';
            const text =
              (typeof result?.text === 'string' && result.text) ||
              (typeof result?.value?.text === 'string' && result.value.text) ||
              (ok ? 'Done.' : 'The command failed.');
            return { ok, text };
          } catch (error) {
            return { ok: false, text: messageOf(error) };
          }
        },
      };

      // The namespace is declared on both registrations, which is what renders
      // the reactive `t` seat into the page.
      let localize = (key, fallback) => fallback ?? key;
      ctx.inject(['locale'], (localeCtx) => {
        localeCtx.effect(
          () => localeCtx.locale.register(NAMESPACE, { en: DICTIONARY }),
          'admin: locale namespace',
        );
        localize = localeCtx.locale.bind(NAMESPACE);
      });

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NAMESPACE,
            inject: () => ({ api }),
          },
          AdminPage,
        ),
      );

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 12,
            label: 'Admin',
          },
          AdminIcon,
        ),
      );

      // Best effort: the Host records it, and a failure here must not stop the
      // panel from registering.
      void api.command(`hello ${CLIENT_VERSION}`).catch(() => undefined);
    }

    return { name: PANEL_ID, inject, apply };
  },
});
