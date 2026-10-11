window.__ModuleLoader__.load({
  id: '@malipetek/dsh-projects-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback } = React;

    /** Panel identity: one id addresses both the sidebar row and the main page. */
    const PANEL_ID = 'projects';
    /**
     * The Host's home directory, as published on the Remote host facts.
     *
     * This half runs in the browser and cannot read the Host environment, so it
     * rebuilds the same paths `index.js` derives from that home. The tilde forms
     * are a last resort for a composition that publishes no host facts.
     *
     * @param ctx - the Client plugin context.
     * @returns the absolute home path, or null when it is not published.
     */
    function hostHomeOf(ctx) {
      try {
        const home = ctx?.remote?.$host?.home;
        if (typeof home === 'string' && home.length > 0) return home;
      } catch {
        // Host facts are optional; fall through to the tilde fallbacks.
      }
      return null;
    }

    /**
     * The JSONL index the Host half writes.
     * @param ctx - the Client plugin context.
     * @returns an absolute path on this machine.
     */
    function indexPathOf(ctx) {
      const home = hostHomeOf(ctx);
      return home === null
        ? '~/.dsh/projects-panel/index.jsonl'
        : `${home}/.dsh/projects-panel/index.jsonl`;
    }

    /**
     * The folder the Host scans, for the header line only. `DSH_PROJECTS_ROOT`
     * is a Host-side override this half cannot see, so a configured root will
     * still read as the default here.
     * @param ctx - the Client plugin context.
     * @returns an absolute path on this machine.
     */
    function projectsRootOf(ctx) {
      const home = hostHomeOf(ctx);
      return home === null
        ? '~/Documents/Documents/Projects'
        : `${home}/Documents/Documents/Projects`;
    }
    /** A project untouched for longer than this counts as stale. */
    const STALE_DAYS = 90;
    /** Browser-local per-project state (likes, archives, open history). */
    const STORE_KEY = 'dsh.projects.panel.v1';
    /** The file Remote caps one text page at this many lines. */
    const PAGE_LINES = 5000;
    /** Hard stop so a pathological index cannot spin the reader. */
    const MAX_PAGES = 20;

    /* ------------------------------------------------------------------ *
     * Persisted per-project state
     * ------------------------------------------------------------------ */

    /**
     * Read the browser-local store.
     * @returns {{ version: number, items: Record<string, object> }}
     */
    function readStore() {
      const empty = { version: 1, items: {} };
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        if (raw === null) return empty;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || typeof parsed.items !== 'object' || parsed.items === null) return empty;
        // Migrate the field this panel first shipped as `pruned` onto `archived`.
        const items = {};
        for (const [path, record] of Object.entries(parsed.items)) {
          if (record === null || typeof record !== 'object') continue;
          const migrated = { ...record };
          if (migrated.pruned === true && migrated.archived === undefined) migrated.archived = true;
          delete migrated.pruned;
          items[path] = migrated;
        }
        return { version: 1, items };
      } catch (error) {
        console.warn('[projects-panel] could not read local state:', error);
        return empty;
      }
    }

    /**
     * Persist the browser-local store, ignoring quota or privacy-mode failures.
     * @param store - the next complete store value.
     */
    function writeStore(store) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch (error) {
        console.warn('[projects-panel] could not persist local state:', error);
      }
    }

    /**
     * Patch one project's record without disturbing the others.
     * @param store - current store.
     * @param path - absolute project directory.
     * @param patch - fields to merge into that project's record.
     * @returns the next store value.
     */
    function patchProject(store, path, patch) {
      const current = store.items[path] ?? {};
      return { version: 1, items: { ...store.items, [path]: { ...current, ...patch } } };
    }

    /* ------------------------------------------------------------------ *
     * Index transport
     * ------------------------------------------------------------------ */

    /**
     * Read the whole index through the session-scoped file Remote, one page at a
     * time, until end of file.
     * @param remote - the `workspaceFiles` Remote namespace.
     * @param path - absolute path to the index on the Host.
     * @param sessionId - the Session authorizing the read.
     * @param signal - caller lifetime.
     * @returns the raw JSONL text.
     */
    async function readIndexText(remote, path, sessionId, signal) {
      let offset = 1;
      let text = '';
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await remote.read(sessionId, path, { offset, limit: PAGE_LINES }, signal);
        if (result.ok !== true) {
          const error = result.error ?? {};
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

    /**
     * Parse JSONL index text, skipping blank and malformed lines.
     * @param text - raw index text.
     * @returns the index records.
     */
    function parseIndex(text) {
      const records = [];
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const record = JSON.parse(trimmed);
          if (record !== null && typeof record === 'object' && typeof record.path === 'string' && typeof record.name === 'string') records.push(record);
        } catch {
          // A torn line during a concurrent rewrite: ignore it.
        }
      }
      return records;
    }

    /* ------------------------------------------------------------------ *
     * Formatting helpers
     * ------------------------------------------------------------------ */

    /**
     * Whole days between an instant and now.
     * @param timestamp - epoch milliseconds, or 0 when unknown.
     * @returns whole days, or null when the instant is unknown.
     */
    function daysSince(timestamp) {
      if (typeof timestamp !== 'number' || timestamp <= 0) return null;
      return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
    }

    /**
     * Reduce any thrown value to displayable text.
     * @param error - the caught value.
     * @returns a message string.
     */
    function messageOf(error) {
      if (error === null || error === undefined) return 'unknown error';
      if (typeof error === 'string') return error;
      if (typeof error.message === 'string' && error.message.length > 0) return error.message;
      return String(error);
    }

    /* ------------------------------------------------------------------ *
     * Theme tokens and styles
     * ------------------------------------------------------------------ */

    const C = {
      labelPrimary: 'var(--dsw-alias-label-primary)',
      labelSecondary: 'var(--dsw-alias-label-secondary)',
      labelTertiary: 'var(--dsw-alias-label-tertiary)',
      bgBase: 'var(--dsw-alias-bg-base)',
      bgLayer1: 'var(--dsw-alias-bg-layer-1)',
      bgLayer2: 'var(--dsw-alias-bg-layer-2)',
      borderL2: 'var(--dsw-alias-border-l2)',
      borderL3: 'var(--dsw-alias-border-l3)',
      business: 'var(--dsw-alias-state-business-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    };

    const s = {
      root: {
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: C.bgBase,
        color: C.labelPrimary,
        fontFamily: 'inherit',
      },
      header: {
        flex: 'none',
        padding: '20px 24px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      },
      titleRow: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' },
      title: { fontSize: '18px', fontWeight: 600, lineHeight: '26px', margin: 0 },
      subtitle: { fontSize: '12px', lineHeight: '18px', color: C.labelTertiary },
      pathText: {
        fontSize: '12px',
        lineHeight: '18px',
        color: C.labelTertiary,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      toolbar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      search: {
        flex: '1 1 240px',
        minWidth: '160px',
        height: '30px',
        padding: '0 10px',
        fontSize: '13px',
        color: C.labelPrimary,
        background: C.bgLayer1,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '6px',
        outline: 'none',
      },
      chip: {
        height: '26px',
        padding: '0 10px',
        fontSize: '12px',
        fontWeight: 500,
        color: C.labelSecondary,
        background: 'transparent',
        border: `1px solid ${C.borderL2}`,
        borderRadius: '13px',
        cursor: 'pointer',
      },
      chipActive: {
        height: '26px',
        padding: '0 10px',
        fontSize: '12px',
        fontWeight: 600,
        color: C.labelPrimary,
        background: C.bgLayer2,
        border: `1px solid ${C.borderL3}`,
        borderRadius: '13px',
        cursor: 'pointer',
      },
      select: {
        height: '26px',
        fontSize: '12px',
        color: C.labelSecondary,
        background: C.bgLayer1,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '6px',
        padding: '0 6px',
      },
      body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 24px 24px' },
      grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))',
        gap: '12px',
      },
      card: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '14px',
        textAlign: 'left',
        background: C.bgLayer1,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '10px',
        color: C.labelPrimary,
        cursor: 'pointer',
      },
      cardName: {
        fontSize: '14px',
        fontWeight: 600,
        lineHeight: '20px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        paddingRight: '52px',
      },
      cardDescription: {
        fontSize: '12px',
        lineHeight: '17px',
        color: C.labelSecondary,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
      cardPath: {
        fontSize: '11px',
        lineHeight: '16px',
        color: C.labelTertiary,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      badgeRow: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' },
      badge: {
        fontSize: '10px',
        lineHeight: '16px',
        padding: '0 6px',
        borderRadius: '8px',
        background: C.bgLayer2,
        color: C.labelSecondary,
      },
      cardActions: {
        position: 'absolute',
        top: '10px',
        right: '10px',
        display: 'flex',
        gap: '2px',
      },
      iconButton: {
        width: '24px',
        height: '24px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        lineHeight: 1,
        background: 'transparent',
        border: 'none',
        borderRadius: '6px',
        color: C.labelTertiary,
        cursor: 'pointer',
      },
      status: {
        padding: '24px',
        fontSize: '13px',
        color: C.labelSecondary,
        textAlign: 'center',
      },
      error: {
        margin: '0 0 12px',
        padding: '10px 12px',
        fontSize: '12px',
        lineHeight: '18px',
        color: C.error,
        background: C.bgLayer1,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '8px',
      },
    };

    /* ------------------------------------------------------------------ *
     * Sidebar entry icon
     * ------------------------------------------------------------------ */

    /**
     * Decorative folder glyph for the sidebar panel list.
     * @param props - the panel list passes the requested glyph size.
     * @returns an inline SVG element.
     */
    function ProjectsIcon({ size }) {
      const dimension = typeof size === 'number' && size > 0 ? size : 16;
      return h(
        'svg',
        {
          width: dimension,
          height: dimension,
          viewBox: '0 0 16 16',
          fill: 'none',
          'aria-hidden': true,
          focusable: false,
          style: { display: 'block' },
        },
        h('path', {
          d: 'M1.6 4.3c0-.75.6-1.35 1.35-1.35h2.6L6.9 4.4h6.15c.75 0 1.35.6 1.35 1.35v6.0c0 .75-.6 1.35-1.35 1.35H2.95c-.75 0-1.35-.6-1.35-1.35z',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
        }),
      );
    }

    /* ------------------------------------------------------------------ *
     * Panel page
     * ------------------------------------------------------------------ */

    /**
     * The Projects page: cards, filter views, archive/like state, and switching.
     * @param props - carries the stable `api` object injected by the registration.
     * @returns the rendered panel.
     */
    function ProjectsPage({ api }) {
      const [store, setStore] = useState(readStore);
      const [index, setIndex] = useState({ phase: 'loading', records: [], error: null });
      const [query, setQuery] = useState('');
      const [view, setView] = useState('all');
      const [sort, setSort] = useState('activity');
      const [busyPath, setBusyPath] = useState(null);
      const [notice, setNotice] = useState(null);

      useEffect(() => {
        writeStore(store);
      }, [store]);

      const load = useCallback(() => {
        const controller = new AbortController();
        setIndex((previous) => ({ ...previous, phase: 'loading', error: null }));
        api.readIndex(controller.signal).then(
          (records) => {
            if (controller.signal.aborted) return;
            setIndex({ phase: 'ready', records, error: null });
          },
          (error) => {
            if (controller.signal.aborted) return;
            setIndex({ phase: 'error', records: [], error: messageOf(error) });
          },
        );
        return () => controller.abort();
      }, [api]);

      useEffect(() => load(), [load]);

      const isLiked = useCallback((path) => store.items[path]?.liked === true, [store]);
      const isArchived = useCallback((path) => store.items[path]?.archived === true, [store]);
      const isStale = useCallback((record) => {
        const days = daysSince(record.lastActivity);
        return days !== null && days > STALE_DAYS;
      }, []);

      const counts = useMemo(() => {
        let liked = 0;
        let stale = 0;
        let archived = 0;
        for (const record of index.records) {
          if (isArchived(record.path)) archived += 1;
          else {
            if (isLiked(record.path)) liked += 1;
            if (isStale(record)) stale += 1;
          }
        }
        return { liked, stale, archived, active: index.records.length - archived };
      }, [index.records, isLiked, isArchived, isStale]);

      const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const rows = index.records.filter((record) => {
          const archived = isArchived(record.path);
          if (view === 'archived') return archived;
          if (archived) return false;
          if (view === 'liked') return isLiked(record.path);
          if (view === 'stale') return isStale(record);
          return true;
        });
        const matched = needle.length === 0
          ? rows
          : rows.filter((record) => {
            if (record.name.toLowerCase().includes(needle)) return true;
            if (record.path.toLowerCase().includes(needle)) return true;
            return typeof record.description === 'string' && record.description.toLowerCase().includes(needle);
          });
        const sorted = matched.slice();
        if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
        else if (sort === 'nameDesc') sorted.sort((a, b) => b.name.localeCompare(a.name));
        else if (sort === 'opened') {
          sorted.sort((a, b) => {
            const left = store.items[a.path]?.lastOpenedAt ?? 0;
            const right = store.items[b.path]?.lastOpenedAt ?? 0;
            if (left !== right) return right - left;
            return a.name.localeCompare(b.name);
          });
        } else {
          sorted.sort((a, b) => {
            const left = typeof a.lastActivity === 'number' ? a.lastActivity : 0;
            const right = typeof b.lastActivity === 'number' ? b.lastActivity : 0;
            if (left !== right) return right - left;
            return a.name.localeCompare(b.name);
          });
        }
        return sorted;
      }, [index.records, query, view, sort, store, isLiked, isArchived, isStale]);

      const toggleLike = useCallback((path) => {
        setStore((previous) => patchProject(previous, path, { liked: previous.items[path]?.liked !== true }));
      }, []);

      const toggleArchive = useCallback((path) => {
        setStore((previous) => patchProject(previous, path, { archived: previous.items[path]?.archived !== true }));
      }, []);

      const openProject = useCallback(async (record) => {
        setBusyPath(record.path);
        setNotice(null);
        try {
          const workspace = await api.adoptWorkspace(record.path);
          setStore((previous) => patchProject(previous, record.path, {
            lastOpenedAt: Date.now(),
            opens: (previous.items[record.path]?.opens ?? 0) + 1,
          }));
          await api.revealWorkspace(workspace.workspaceId);
          api.showConversation();
        } catch (error) {
          setNotice({ kind: 'error', text: `Could not open ${record.name}: ${messageOf(error)}` });
        } finally {
          setBusyPath(null);
        }
      }, [api]);

      const chips = [
        { id: 'all', label: `All ${counts.active}` },
        { id: 'stale', label: `Stale ${counts.stale}` },
        { id: 'liked', label: `Liked ${counts.liked}` },
        { id: 'archived', label: `Archived ${counts.archived}` },
      ];

      return h(
        'div',
        { style: s.root },
        h(
          'div',
          { style: s.header },
          h(
            'div',
            { style: s.titleRow },
            h('h1', { style: s.title }, 'Projects'),
            h('span', { style: s.subtitle }, `${index.records.length} folder${index.records.length === 1 ? '' : 's'}`),
          ),
          h('div', { style: s.pathText, title: api.projectsRoot }, api.projectsRoot),
          h(
            'div',
            { style: s.toolbar },
            h('input', {
              style: s.search,
              type: 'search',
              value: query,
              placeholder: 'Search projects…',
              'aria-label': 'Search projects',
              onChange: (event) => setQuery(event.target.value),
            }),
            ...chips.map((chip) => h(
              'button',
              {
                key: chip.id,
                type: 'button',
                style: view === chip.id ? s.chipActive : s.chip,
                'aria-pressed': view === chip.id,
                onClick: () => setView(chip.id),
              },
              chip.label,
            )),
            h(
              'select',
              {
                style: s.select,
                value: sort,
                'aria-label': 'Sort projects',
                onChange: (event) => setSort(event.target.value),
              },
              h('option', { value: 'activity' }, 'Last active'),
              h('option', { value: 'name' }, 'Name A–Z'),
              h('option', { value: 'nameDesc' }, 'Name Z–A'),
              h('option', { value: 'opened' }, 'Recently opened'),
            ),
            h(
              'button',
              {
                type: 'button',
                style: s.chip,
                onClick: () => load(),
                disabled: index.phase === 'loading',
              },
              index.phase === 'loading' ? 'Loading…' : 'Refresh',
            ),
          ),
        ),
        h(
          'div',
          { style: s.body },
          notice !== null && h('div', { style: { ...s.error, color: notice.kind === 'error' ? C.error : C.business } }, notice.text),
          index.error !== null && h('div', { style: s.error }, `Could not read the project index: ${index.error}`),
          index.phase === 'loading' && index.records.length === 0 && h('div', { style: s.status }, 'Loading projects…'),
          index.phase === 'ready' && index.records.length === 0 && h('div', { style: s.status }, 'The index is empty. Refresh after the Host has scanned the folder.'),
          visible.length === 0 && index.records.length > 0 && h('div', { style: s.status }, query.trim().length > 0 ? 'No project matches that search.' : 'Nothing in this view.'),
          h(
            'div',
            { style: s.grid },
            ...visible.map((record) => {
              const state = store.items[record.path] ?? {};
              const liked = state.liked === true;
              const archived = state.archived === true;
              const busy = busyPath === record.path;
              const days = daysSince(record.lastActivity);
              const stale = days !== null && days > STALE_DAYS;
              return h(
                'div',
                {
                  key: record.path,
                  style: { ...s.card, opacity: busy ? 0.6 : 1 },
                  role: 'button',
                  tabIndex: 0,
                  title: `Open ${record.path} as the workspace`,
                  onClick: () => { if (!busy) openProject(record); },
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (!busy) openProject(record);
                    }
                  },
                },
                h(
                  'div',
                  { style: s.cardActions },
                  h(
                    'button',
                    {
                      type: 'button',
                      style: { ...s.iconButton, color: liked ? C.warn : C.labelTertiary },
                      title: liked ? 'Remove from liked' : 'Like this project',
                      'aria-label': liked ? `Unlike ${record.name}` : `Like ${record.name}`,
                      'aria-pressed': liked,
                      onClick: (event) => { event.stopPropagation(); toggleLike(record.path); },
                    },
                    liked ? '★' : '☆',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      style: { ...s.iconButton, color: archived ? C.error : C.labelTertiary },
                      title: archived ? 'Restore this project' : 'Archive (hide) this project',
                      'aria-label': archived ? `Restore ${record.name}` : `Archive ${record.name}`,
                      'aria-pressed': archived,
                      onClick: (event) => { event.stopPropagation(); toggleArchive(record.path); },
                    },
                    archived ? '↺' : '✕',
                  ),
                ),
                h('div', { style: s.cardName, title: record.name }, record.name),
                typeof record.description === 'string' && record.description.length > 0
                  && h('div', { style: s.cardDescription }, record.description),
                h(
                  'div',
                  { style: s.badgeRow },
                  record.isGit === true && h('span', { style: s.badge }, 'git'),
                  stale && h('span', { style: { ...s.badge, color: C.warn } }, `stale ${days}d`),
                  liked && h('span', { style: { ...s.badge, color: C.warn } }, 'liked'),
                  archived && h('span', { style: { ...s.badge, color: C.error } }, 'archived'),
                  record.hidden === true && h('span', { style: s.badge }, 'hidden'),
                  state.opens > 0 && h('span', { style: s.badge }, `opened ${state.opens}×`),
                  busy && h('span', { style: { ...s.badge, color: C.business } }, 'opening…'),
                ),
                h('div', { style: s.cardPath, title: record.path }, record.path),
              );
            }),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Cordis plugin
     * ------------------------------------------------------------------ */

    /** Services this Client plugin needs: slots, the workspace shell, sessions, and the file Remote. */
    const inject = ['slots', 'sessions', 'uiWorkspace', 'layout', 'remote', 'remote.workspaceFiles'];

    /**
     * Register the sidebar row and the main page.
     * @param ctx - the Client plugin context.
     */
    function apply(ctx) {
      // One stable object so React effects that depend on it do not re-run every render.
      const api = {
        projectsRoot: projectsRootOf(ctx),
        readIndex: async (signal) => {
          const snapshot = ctx.sessions.list.getSnapshot();
          const sessionId = Array.isArray(snapshot?.ids) ? snapshot.ids[0] : undefined;
          if (sessionId === undefined) throw new Error('No session is open to authorize the read. Open a session, then refresh.');
          const text = await readIndexText(ctx.remote.workspaceFiles, indexPathOf(ctx), sessionId, signal);
          return parseIndex(text);
        },
        adoptWorkspace: (path) => ctx.uiWorkspace.workspaces.create({ path }),
        revealWorkspace: (workspaceId) => ctx.uiWorkspace.openWorkspace(workspaceId),
        showConversation: () => ctx.layout.selectPanel(null),
      };

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ api }),
      }, ProjectsPage));

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 10,
        label: 'Projects',
      }, ProjectsIcon));
    }

    return { name: PANEL_ID, inject, apply };
  },
});
