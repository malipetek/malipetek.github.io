/**
 * Client half of the Projects manager bundle.
 *
 * Renders the Momentum page and an app-wide reminder banner. It owns no
 * analysis: the Host half scores every project and writes `index.jsonl`, which
 * this side reads through the session-scoped file Remote.
 *
 * Mutations travel the other way as Cordis commands — `remote.commands.execute`
 * runs `/projects …` directly against the Host, so snoozing a project or setting
 * its pace never spends a model turn and never enters the conversation.
 *
 * @module @malipetek/dsh-projects-manager
 */
window.__ModuleLoader__.load({
  id: '@malipetek/dsh-projects-manager',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback } = React;

    /**
     * Panel identity. Distinct from the Projects panel's `projects` key, because
     * the `main` slot holds exactly one entry per key and the two plugins must
     * not collide.
     */
    const PANEL_ID = 'momentum';
    /**
     * The index the Host half writes. Absolute literal, because this side cannot
     * read the Host environment; `index.js` hardcodes the same path.
     */
    const INDEX_PATH = '/Users/malipetek/.dsh/projects-manager/index.jsonl';
    /** Browser-local dismissals for the reminder banner. */
    const STORE_KEY = 'dsh.projects.manager.v1';
    /** The file Remote caps one text page at this many lines. */
    const PAGE_LINES = 5000;
    /** Hard stop so a pathological index cannot spin the reader. */
    const MAX_PAGES = 20;
    /** How long the reminder banner stays before it fades on its own. */
    const BANNER_HOLD_MS = 25_000;
    /** States the Attention view gathers, worst first. */
    const ATTENTION_STATES = ['never-started', 'stalling', 'cooling'];

    /* ------------------------------------------------------------------ *
     * Transport
     * ------------------------------------------------------------------ */

    /**
     * Read the whole index through the session-scoped file Remote, one page at a
     * time, until end of file.
     * @param remote - the `workspaceFiles` Remote namespace.
     * @param sessionId - the Session authorizing the read.
     * @param signal - caller lifetime.
     * @returns the raw JSONL text.
     */
    async function readIndexText(remote, sessionId, signal) {
      let offset = 1;
      let text = '';
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await remote.read(sessionId, INDEX_PATH, { offset, limit: PAGE_LINES }, signal);
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
          if (record !== null && typeof record === 'object' && typeof record.path === 'string' && typeof record.momentum === 'object') {
            records.push(record);
          }
        } catch {
          // A torn line during a concurrent rewrite: ignore it.
        }
      }
      return records;
    }

    /* ------------------------------------------------------------------ *
     * Formatting
     * ------------------------------------------------------------------ */

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

    /**
     * Human phrase for how long ago an instant was.
     * @param timestamp - epoch milliseconds, or 0 when unknown.
     * @returns a short phrase such as "3d ago".
     */
    function ago(timestamp) {
      if (typeof timestamp !== 'number' || timestamp <= 0) return 'never';
      const days = Math.floor((Date.now() - timestamp) / 86400000);
      if (days <= 0) return 'today';
      if (days === 1) return 'yesterday';
      if (days < 30) return `${days}d ago`;
      return `${Math.floor(days / 30)}mo ago`;
    }

    /** Visual tone per momentum state. */
    const STATE_TONE = {
      'never-started': 'warn',
      stalling: 'error',
      cooling: 'warn',
      active: 'good',
      dormant: 'muted',
      unstarted: 'muted',
      ignored: 'muted',
    };

    /* ------------------------------------------------------------------ *
     * Theme
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
      toastBg: 'var(--dsw-alias-toast-bg, var(--dsw-alias-bg-layer-2))',
      toastLabel: 'var(--dsw-alias-toast-label, var(--dsw-alias-label-primary))',
    };

    /** Resolve a state tone to a colour token. */
    function toneOf(state) {
      const tone = STATE_TONE[state] ?? 'muted';
      if (tone === 'error') return C.error;
      if (tone === 'warn') return C.warn;
      if (tone === 'good') return C.business;
      return C.labelTertiary;
    }

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
      header: { flex: 'none', padding: '20px 24px 12px', display: 'flex', flexDirection: 'column', gap: '12px' },
      titleRow: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' },
      title: { fontSize: '18px', fontWeight: 600, lineHeight: '26px', margin: 0 },
      subtitle: { fontSize: '12px', lineHeight: '18px', color: C.labelTertiary },
      toolbar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      search: {
        flex: '1 1 220px',
        minWidth: '150px',
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
      primaryButton: {
        height: '28px',
        padding: '0 12px',
        fontSize: '12px',
        fontWeight: 600,
        color: C.labelPrimary,
        background: C.bgLayer2,
        border: `1px solid ${C.borderL3}`,
        borderRadius: '6px',
        cursor: 'pointer',
      },
      smallButton: {
        height: '24px',
        padding: '0 8px',
        fontSize: '11px',
        color: C.labelSecondary,
        background: 'transparent',
        border: `1px solid ${C.borderL2}`,
        borderRadius: '6px',
        cursor: 'pointer',
      },
      body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 24px 28px' },
      status: { padding: '24px', fontSize: '13px', color: C.labelSecondary, textAlign: 'center' },
      notice: {
        margin: '0 0 12px',
        padding: '10px 12px',
        fontSize: '12px',
        lineHeight: '18px',
        color: C.labelSecondary,
        background: C.bgLayer1,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '8px',
      },
      list: { display: 'flex', flexDirection: 'column', gap: '10px' },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
        padding: '13px 14px',
        background: C.bgLayer1,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '10px',
      },
      cardTop: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      cardName: { fontSize: '14px', fontWeight: 600, lineHeight: '20px' },
      pill: { fontSize: '10px', lineHeight: '16px', padding: '0 7px', borderRadius: '8px', background: C.bgLayer2 },
      meta: { fontSize: '11px', lineHeight: '17px', color: C.labelTertiary },
      reasons: { margin: 0, paddingLeft: '16px', fontSize: '12px', lineHeight: '18px', color: C.labelSecondary },
      suggestion: { fontSize: '12px', lineHeight: '18px', color: C.labelPrimary },
      actions: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '2px' },
      intentRow: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' },
      input: {
        height: '26px',
        padding: '0 8px',
        fontSize: '12px',
        color: C.labelPrimary,
        background: C.bgBase,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '6px',
        outline: 'none',
      },
      numInput: {
        height: '26px',
        width: '58px',
        padding: '0 8px',
        fontSize: '12px',
        color: C.labelPrimary,
        background: C.bgBase,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '6px',
        outline: 'none',
      },
      banner: {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: 40,
        maxWidth: '360px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px 14px',
        background: C.toastBg,
        color: C.toastLabel,
        border: `1px solid ${C.borderL3}`,
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
        fontSize: '12px',
        lineHeight: '18px',
      },
      bannerHead: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 },
      bannerActions: { display: 'flex', gap: '6px', justifyContent: 'flex-end' },
    };

    /* ------------------------------------------------------------------ *
     * Sidebar entry
     * ------------------------------------------------------------------ */

    /**
     * Decorative momentum glyph for the sidebar panel list.
     * @param props - the panel list passes the requested glyph size.
     * @returns an inline SVG element.
     */
    function MomentumIcon({ size }) {
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
          d: 'M1.8 11.6 5.4 7.3l2.5 2.4L14.2 3.6',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M10.6 3.6h3.6v3.5',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /* ------------------------------------------------------------------ *
     * Momentum page
     * ------------------------------------------------------------------ */

    /**
     * The Momentum page: what is stalling, why, and the controls to change it.
     * @param props - carries the stable `api` object injected by the registration.
     * @returns the rendered panel.
     */
    function MomentumPage({ api }) {
      const [state, setState] = useState({ phase: 'loading', records: [], error: null });
      const [query, setQuery] = useState('');
      const [view, setView] = useState('attention');
      const [notice, setNotice] = useState(null);
      const [busy, setBusy] = useState(null);
      const [editing, setEditing] = useState(null);
      const [draftAction, setDraftAction] = useState('');
      const [draftPace, setDraftPace] = useState('');

      const load = useCallback(() => {
        const controller = new AbortController();
        setState((previous) => ({ ...previous, phase: 'loading', error: null }));
        api.readIndex(controller.signal).then(
          (records) => {
            if (controller.signal.aborted) return;
            setState({ phase: 'ready', records, error: null });
          },
          (error) => {
            if (controller.signal.aborted) return;
            setState({ phase: 'error', records: [], error: messageOf(error) });
          },
        );
        return () => controller.abort();
      }, [api]);

      useEffect(() => load(), [load]);

      /**
       * Run one `/projects …` command against a live Session, then refresh.
       *
       * A command is addressed to a Session's agent, and the panel is root-scoped
       * so it has no Session of its own; the first Session whose agent accepts the
       * line wins.
       */
      const runCommand = useCallback(async (line, options = {}) => {
        setBusy(options.key ?? line);
        setNotice(null);
        try {
          const result = await api.runCommand(line);
          if (result.ok !== true) {
            const error = result.error ?? {};
            setNotice({ kind: 'error', text: `${error.code ?? 'command-failed'}${error.message ? `: ${error.message}` : ''}` });
          } else if (result.value === undefined || result.value.result === undefined) {
            setNotice({ kind: 'error', text: `The Host did not recognise the command: ${line}` });
          } else {
            const outcome = result.value.result;
            setNotice({ kind: outcome.kind === 'error' ? 'error' : 'info', text: typeof outcome.text === 'string' ? outcome.text : 'Done.' });
            load();
          }
        } catch (error) {
          setNotice({ kind: 'error', text: messageOf(error) });
        } finally {
          setBusy(null);
        }
      }, [api, load]);

      const counts = useMemo(() => {
        const tally = { attention: 0 };
        for (const record of state.records) {
          const momentumState = record.momentum.state;
          tally[momentumState] = (tally[momentumState] ?? 0) + 1;
          if (ATTENTION_STATES.includes(momentumState) && record.intent?.ignored !== true) tally.attention += 1;
        }
        return tally;
      }, [state.records]);

      const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const rows = state.records.filter((record) => {
          if (view === 'all') return true;
          if (view === 'attention') return ATTENTION_STATES.includes(record.momentum.state) && record.intent?.ignored !== true;
          return record.momentum.state === view;
        });
        const matched = needle.length === 0 ? rows : rows.filter((record) => (
          record.name.toLowerCase().includes(needle)
          || (typeof record.description === 'string' && record.description.toLowerCase().includes(needle))
          || (typeof record.intent?.nextAction === 'string' && record.intent.nextAction.toLowerCase().includes(needle))
        ));
        const sorted = matched.slice();
        if (view === 'attention') sorted.sort((a, b) => b.momentum.score - a.momentum.score || a.name.localeCompare(b.name));
        else sorted.sort((a, b) => b.momentum.lastTouchAt - a.momentum.lastTouchAt || a.name.localeCompare(b.name));
        return sorted;
      }, [state.records, query, view]);

      const chips = [
        { id: 'attention', label: `Needs attention ${counts.attention ?? 0}` },
        { id: 'stalling', label: `Stalling ${counts.stalling ?? 0}` },
        { id: 'cooling', label: `Cooling ${counts.cooling ?? 0}` },
        { id: 'active', label: `Active ${counts.active ?? 0}` },
        { id: 'dormant', label: `Dormant ${counts.dormant ?? 0}` },
        { id: 'all', label: `All ${state.records.length}` },
      ];

      const openProject = useCallback(async (record) => {
        setBusy(record.path);
        setNotice(null);
        try {
          const workspace = await api.adoptWorkspace(record.path);
          await api.revealWorkspace(workspace.workspaceId);
          api.showConversation();
        } catch (error) {
          setNotice({ kind: 'error', text: `Could not open ${record.name}: ${messageOf(error)}` });
        } finally {
          setBusy(null);
        }
      }, [api]);

      const startEditing = useCallback((record) => {
        setEditing(record.path);
        setDraftAction(record.intent?.nextAction ?? '');
        setDraftPace(record.intent?.cadenceDays > 0 ? String(record.intent.cadenceDays) : '');
      }, []);

      const saveIntent = useCallback(async (record) => {
        const lines = [];
        if (draftPace.trim().length > 0) {
          const pace = Number(draftPace);
          if (!Number.isFinite(pace) || pace <= 0) {
            setNotice({ kind: 'error', text: 'Pace must be a positive number of days.' });
            return;
          }
          lines.push(`/projects cadence "${record.name}" ${pace}`);
        }
        if (draftAction.trim().length > 0) lines.push(`/projects next "${record.name}" ${draftAction.trim()}`);
        lines.push(`/projects resume "${record.name}"`);
        setEditing(null);
        for (const line of lines) {
          const result = await api.runCommand(line);
          if (result.ok !== true) {
            const error = result.error ?? {};
            setNotice({ kind: 'error', text: `${error.code ?? 'command-failed'}${error.message ? `: ${error.message}` : ''}` });
            return;
          }
        }
        setNotice({ kind: 'info', text: `Saved intent for ${record.name}.` });
        load();
      }, [api, draftAction, draftPace, load]);

      return h(
        'div',
        { style: s.root },
        h(
          'div',
          { style: s.header },
          h(
            'div',
            { style: s.titleRow },
            h('h1', { style: s.title }, 'Project momentum'),
            h('span', { style: s.subtitle }, `${state.records.length} tracked · ${counts.attention ?? 0} need attention`),
          ),
          h(
            'div',
            { style: s.toolbar },
            h('input', {
              style: s.search,
              type: 'search',
              value: query,
              placeholder: 'Search projects, next actions…',
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
              'button',
              {
                type: 'button',
                style: s.chip,
                onClick: () => load(),
                disabled: state.phase === 'loading',
              },
              state.phase === 'loading' ? 'Loading…' : 'Refresh',
            ),
          ),
          h(
            'div',
            { style: s.toolbar },
            h(
              'button',
              {
                type: 'button',
                style: s.primaryButton,
                disabled: busy !== null,
                onClick: () => runCommand('/projects cron 0 9 * * 1-5', { key: 'cron' }),
                title: 'Create a cron reminder that runs the projects manager on weekday mornings',
              },
              busy === 'cron' ? 'Scheduling…' : 'Set up weekday review',
            ),
            h(
              'button',
              {
                type: 'button',
                style: s.smallButton,
                disabled: busy !== null,
                onClick: () => runCommand('/projects remind', { key: 'remind' }),
              },
              busy === 'remind' ? 'Starting…' : 'Review now',
            ),
            h(
              'button',
              {
                type: 'button',
                style: s.smallButton,
                disabled: busy !== null,
                onClick: () => runCommand('/projects scan', { key: 'scan' }),
              },
              busy === 'scan' ? 'Scanning…' : 'Rescan',
            ),
          ),
        ),
        h(
          'div',
          { style: s.body },
          notice !== null && h(
            'div',
            { style: { ...s.notice, color: notice.kind === 'error' ? C.error : C.labelSecondary, whiteSpace: 'pre-wrap' } },
            notice.text,
          ),
          state.error !== null && h('div', { style: { ...s.notice, color: C.error } }, `Could not read the projects index: ${state.error}`),
          state.phase === 'loading' && state.records.length === 0 && h('div', { style: s.status }, 'Loading projects…'),
          state.phase === 'ready' && state.records.length === 0
            && h('div', { style: s.status }, 'The index is empty. The Host scans the projects folder shortly after start-up.'),
          state.phase === 'ready' && state.records.length > 0 && visible.length === 0
            && h('div', { style: s.status }, view === 'attention' ? 'Nothing is stalling. Nice.' : 'Nothing matches this view.'),
          h(
            'div',
            { style: s.list },
            ...visible.map((record) => {
              const { momentum, repo, dsh: dshBlock, intent } = record;
              const snoozed = typeof intent?.snoozeUntil === 'number' && intent.snoozeUntil > Date.now();
              const isBusy = busy === record.path;
              const isEditing = editing === record.path;
              return h(
                'div',
                { key: record.path, style: { ...s.card, opacity: isBusy ? 0.6 : 1 } },
                h(
                  'div',
                  { style: s.cardTop },
                  h('span', { style: s.cardName }, record.name),
                  h('span', { style: { ...s.pill, color: toneOf(momentum.state) } }, momentum.state),
                  h('span', { style: { ...s.pill, color: C.labelTertiary } }, `risk ${momentum.score}`),
                  snoozed && h('span', { style: { ...s.pill, color: C.business } }, `snoozed until ${new Date(intent.snoozeUntil).toLocaleDateString()}`),
                  intent?.ignored === true && h('span', { style: { ...s.pill, color: C.labelTertiary } }, 'ignored'),
                ),
                h(
                  'div',
                  { style: s.meta },
                  `quiet ${momentum.quietDays}d vs a ${momentum.cadenceSource} pace of ~${momentum.cadenceDays}d`
                  + ` · last real work ${ago(momentum.lastTouchAt)} via ${momentum.lastTouchSource}`
                  + (repo?.isGit ? ` · git ${repo.commits14}/14d (was ${repo.commitsPrior14})${repo.dirty + repo.untracked > 0 ? `, ${repo.dirty + repo.untracked} uncommitted` : ''} on ${repo.branch}` : ' · not a git repo')
                  + (dshBlock?.sessions > 0 ? ` · dsh ${dshBlock.sessions} session(s), ${dshBlock.turns} turn(s)` : ''),
                ),
                momentum.reasons.length > 0 && h(
                  'ul',
                  { style: s.reasons },
                  ...momentum.reasons.map((reason, index) => h('li', { key: index }, reason)),
                ),
                momentum.suggestions.length > 0 && h('div', { style: s.suggestion }, `Next: ${momentum.suggestions[0]}`),
                isEditing && h(
                  'div',
                  { style: s.intentRow },
                  h('input', {
                    style: { ...s.input, flex: '1 1 220px' },
                    value: draftAction,
                    placeholder: 'Next action',
                    'aria-label': `Next action for ${record.name}`,
                    onChange: (event) => setDraftAction(event.target.value),
                  }),
                  h('input', {
                    style: s.numInput,
                    type: 'number',
                    min: '1',
                    value: draftPace,
                    placeholder: 'days',
                    'aria-label': `Expected pace in days for ${record.name}`,
                    onChange: (event) => setDraftPace(event.target.value),
                  }),
                  h('button', { type: 'button', style: s.smallButton, disabled: busy !== null, onClick: () => saveIntent(record) }, 'Save'),
                  h('button', { type: 'button', style: s.smallButton, onClick: () => setEditing(null) }, 'Cancel'),
                ),
                !isEditing && h(
                  'div',
                  { style: s.actions },
                  h('button', { type: 'button', style: s.smallButton, disabled: busy !== null, onClick: () => openProject(record) }, 'Open'),
                  h(
                    'button',
                    { type: 'button', style: s.smallButton, disabled: busy !== null, onClick: () => runCommand(`/projects snooze "${record.name}" 14`, { key: record.path }) },
                    'Snooze 14d',
                  ),
                  h('button', { type: 'button', style: s.smallButton, disabled: busy !== null, onClick: () => startEditing(record) }, 'Edit intent'),
                  intent?.ignored === true
                    ? h('button', { type: 'button', style: s.smallButton, disabled: busy !== null, onClick: () => runCommand(`/projects resume "${record.name}"`, { key: record.path }) }, 'Resume')
                    : h('button', { type: 'button', style: s.smallButton, disabled: busy !== null, onClick: () => runCommand(`/projects ignore "${record.name}"`, { key: record.path }) }, 'Ignore'),
                ),
              );
            }),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Reminder banner
     * ------------------------------------------------------------------ */

    /**
     * Read the dismissed-scan record from browser storage.
     * @returns an object holding the last dismissed scan timestamp.
     */
    function readDismissed() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY);
        if (raw === null) return { dismissedAt: 0 };
        const parsed = JSON.parse(raw);
        return { dismissedAt: typeof parsed?.dismissedAt === 'number' ? parsed.dismissedAt : 0 };
      } catch {
        return { dismissedAt: 0 };
      }
    }

    /**
     * Remember that the current scan's reminder was dismissed.
     * @param dismissedAt - the scan timestamp that was dismissed.
     */
    function writeDismissed(dismissedAt) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ dismissedAt }));
      } catch {
        // Storage unavailable: the banner simply reappears next time.
      }
    }

    /**
     * Fetches the index once per mount and, when projects are stalling, shows an
     * app-wide banner that outlives the Momentum panel.
     * @param props - carries the stable `api` object injected by the registration.
     * @returns the banner, or null when there is nothing to say.
     */
    function MomentumReminder({ api }) {
      const [summary, setSummary] = useState(null);
      const [hidden, setHidden] = useState(false);

      useEffect(() => {
        const controller = new AbortController();
        api.readIndex(controller.signal).then(
          (records) => {
            if (controller.signal.aborted) return;
            const attention = records
              .filter((record) => ATTENTION_STATES.includes(record.momentum.state) && record.intent?.ignored !== true)
              .sort((a, b) => b.momentum.score - a.momentum.score);
            const scannedAt = records.reduce((max, record) => Math.max(max, record.momentum.lastTouchAt), 0);
            if (attention.length === 0) return;
            if (readDismissed().dismissedAt >= scannedAt) return;
            setSummary({ names: attention.slice(0, 3).map((record) => record.name), total: attention.length, scannedAt });
          },
          () => {
            // The banner is a convenience; a failed read stays silent.
          },
        );
        return () => controller.abort();
      }, [api]);

      useEffect(() => {
        if (summary === null) return undefined;
        const timer = setTimeout(() => setHidden(true), BANNER_HOLD_MS);
        return () => clearTimeout(timer);
      }, [summary]);

      if (summary === null || hidden) return null;

      const dismiss = () => {
        writeDismissed(summary.scannedAt);
        setHidden(true);
      };

      return h(
        'div',
        { style: s.banner, role: 'status' },
        h('div', { style: s.bannerHead }, `⚠ ${summary.total} project${summary.total === 1 ? '' : 's'} losing momentum`),
        h('div', {}, `${summary.names.join(', ')}${summary.total > summary.names.length ? ` and ${summary.total - summary.names.length} more` : ''}.`),
        h(
          'div',
          { style: s.bannerActions },
          h('button', { type: 'button', style: s.smallButton, onClick: () => { api.showPanel(); dismiss(); } }, 'Review'),
          h('button', { type: 'button', style: s.smallButton, onClick: dismiss }, 'Dismiss'),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Cordis plugin
     * ------------------------------------------------------------------ */

    /** Services this Client plugin needs: slots, sessions, the workspace shell and the file Remote. */
    const inject = ['slots', 'sessions', 'uiWorkspace', 'layout', 'remote', 'remote.workspaceFiles', 'remote.commands'];

    /**
     * Register the sidebar row, the Momentum page and the reminder banner.
     * @param ctx - the Client plugin context.
     */
    function apply(ctx) {
      /**
       * The Session authorizing Remote file reads. The file Remote is
       * session-scoped, so one open Session is enough.
       * @returns a session id.
       */
      const currentSessionId = () => {
        const snapshot = ctx.sessions.list.getSnapshot();
        const id = Array.isArray(snapshot?.ids) ? snapshot.ids[0] : undefined;
        if (id === undefined) throw new Error('No session is open. Open a session, then try again.');
        return id;
      };

      // One stable object so React effects that depend on it do not re-run every render.
      const api = {
        readIndex: async (signal) => parseIndex(await readIndexText(ctx.remote.workspaceFiles, currentSessionId(), signal)),
        /**
         * Execute one command against the first Session whose agent accepts it.
         * Commands are addressed to a Session, and the panel is root-scoped, so it
         * has no Session of its own.
         * @param line - the complete command line.
         * @returns the first successful Remote envelope, or the last failure.
         */
        runCommand: async (line) => {
          const snapshot = ctx.sessions.list.getSnapshot();
          const ids = Array.isArray(snapshot?.ids) ? snapshot.ids.slice(0, 4) : [];
          if (ids.length === 0) throw new Error('No session is open. Open a session, then try again.');
          let last = null;
          for (const id of ids) {
            last = await ctx.remote.commands.execute(id, line, []);
            if (last.ok === true) return last;
          }
          return last;
        },
        adoptWorkspace: (path) => ctx.uiWorkspace.workspaces.create({ path }),
        revealWorkspace: (workspaceId) => ctx.uiWorkspace.openWorkspace(workspaceId),
        showConversation: () => ctx.layout.selectPanel(null),
        showPanel: () => ctx.layout.selectPanel(PANEL_ID),
      };

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        inject: () => ({ api }),
      }, MomentumPage));

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 11,
        label: 'Momentum',
      }, MomentumIcon));

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'projects-manager-reminder',
        order: 20,
        inject: () => ({ api }),
      }, MomentumReminder));
    }

    return { name: PANEL_ID, inject, apply };
  },
});
