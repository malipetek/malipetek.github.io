/**
 * Client half of the **AI Workspace** bundle.
 *
 * Registers one panel under the id `ai-workspace`: a row in the sidebar's panel
 * list and the matching page in the layout's root-scoped `main` keyed slot. The
 * page renders a grid of process cards — the closest thing a DeepSeek Harness
 * plugin can offer to the "small terminal windows" the original VS Code
 * extension opened, because terminal creation is Agent-gated and closed to
 * plugins.
 *
 * Every card holds a live tail of that process's log, its status, its error-line
 * count and its bound port, which is what makes it safe for the agent to stop
 * running `pnpm dev` itself and read the log instead.
 *
 * Two halves talk through files, not a bespoke RPC: the Host writes a status
 * snapshot to its `DSH_HOME` and this half reads it through the session-scoped
 * file Remote, rebuilding that path from the Host home the Remote publishes.
 * An out-of-tree plugin cannot declare its own Remote, and the file Remote
 * exposes no mutation, so the controls are slash commands executed through
 * `remote.commands` — which is why each button also leaves a command row in the
 * conversation.
 *
 * @module @malipetek/dsh-ai-workspace/client
 */
window.__ModuleLoader__.load({
  id: '@malipetek/dsh-ai-workspace',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback, useRef } = React;

    /** Panel identity: one id addresses both the sidebar row and the main page. */
    const PANEL_ID = 'ai-workspace';

    /**
     * The Host's home directory, as published on the Remote host facts.
     *
     * This half runs in the browser and cannot read the Host environment, so it
     * rebuilds the same path `index.js` derives from `DSH_HOME`. The tilde form is
     * a last resort for a composition that publishes no host facts.
     *
     * @param ctx - the Client plugin context.
     * @returns the absolute home path, or null when it is not published.
     */
    function hostHomeOf(ctx) {
      try {
        const home = ctx?.remote?.$host?.home;
        if (typeof home === 'string' && home.length > 0) return home;
      } catch {
        // Host facts are optional; fall through to the tilde fallback.
      }
      return null;
    }

    /**
     * The status snapshot the Host half writes.
     * @param ctx - the Client plugin context.
     * @returns an absolute path on this machine.
     */
    function statusPathOf(ctx) {
      const home = hostHomeOf(ctx);
      return home === null
        ? '~/.dsh/ai-workspace/status.json'
        : `${home}/.dsh/ai-workspace/status.json`;
    }

    /** How often the page re-reads the snapshot. */
    const POLL_MS = 3000;

    /** Poll cadence once the push feed is live, as a safety net only. */
    const PUSH_POLL_MS = 15000;

    /** The locale namespace this panel's copy is registered under. */
    const NAMESPACE = 'ai-workspace';

    /**
     * English copy, keyed. The values are the strings the panel used to carry
     * inline, so routing them through a namespace changes nothing on screen while
     * making the copy translatable and letting the locale seat swap it live.
     *
     * Keys are also the fallback: `translate` returns the key itself for an
     * unknown one, so a typo shows up as an obvious `someKey` in the panel rather
     * than as blank space.
     */
    const DICTIONARY = {
      panelTitle: 'AI Workspace',
      filterPlaceholder: 'Filter projects, processes and candidates…',
      filterLabel: 'Filter projects and candidates',
      refresh: 'Refresh',
      loading: 'Loading…',
      live: 'Live',
      paused: 'Paused',
      rescan: 'Rescan',
      startAll: 'Start all',
      stopAll: 'Stop all',
      clear: 'Clear',
      streaming: 'streaming',
      polling: 'polling',
      connecting: 'connecting…',
      streamingHint: 'The Host pushes each change; polling every {seconds}s as a safety net.',
      pollingHint: 'The push feed is unavailable, so the panel polls every {seconds}s.',
      connectingHint: 'Opening the push feed…',
      start: 'Start',
      restart: 'Restart',
      stop: 'Stop',
      onboard: 'Onboard',
      askAgent: 'Ask agent',
      offboard: 'Offboard',
      offboardTitle: 'Remove .ai-workspace.json and stop this project\'s processes',
      confirmOffboard: 'Remove this config?',
      remove: 'Remove',
      cancel: 'Cancel',
      highConfidence: 'high confidence',
      needsReview: 'needs review',
      nothingDetected: 'nothing detected',
      agentMustInspect: 'an agent must inspect this project',
      portMoved: 'port moved',
      noManagedMatch: 'No managed project matches that filter.',
      noCandidateMatch: 'No candidate matches this view or filter.',
      noProcessesRead: 'No processes could be read from this config.',
      noProcessesDeclared: 'This config declares no processes.',
      nothingToShow: 'No project under the projects root has a package manifest, a compose file, or an .ai-workspace.json yet.',
      loadingState: 'Loading AI Workspace state…',
      waitingOutput: 'waiting for output…',
      noOutput: 'no output yet',
      onboardAll: 'Onboard all high-confidence ({count})',
      viewAll: 'All {count}',
      viewHigh: 'High {count}',
      viewReview: 'Review {count}',
      viewAgent: 'Agent {count}',
      backlog: 'Not onboarded ({count})',
      backlogFiltered: 'Not onboarded ({shown} of {total})',
      proposalSummary: '{proposed} with a detected proposal',
      proposalSummaryHigh: '{proposed} with a detected proposal, {high} high-confidence',
      projectSummary: '{count} project{plural}, {running}/{total} running',
      notOnboarded: '{count} not onboarded',
      errorLines: '{count} error-like lines',
      errorShort: '{count} err',
      restartCount: '{count}↻',
      exitCode: 'exit {code}',
      portBadge: ':{port}',
      commandLine: '$ {command}',
      logTailLabel: '{name} log tail',
      tailHint: 'bound port {port}',
      noSession: 'No session is open to authorize this call. Open a session first.',
      readFailed: 'Could not read the status snapshot: {error}',
      wiringMissing: 'The ai_workspace tool did not mount ({reason}). Agents can still read the logs by path and through /ai-workspace; the Host log names the reason.',
      toolFailed: '{verb} {target} failed: {error}',
      nothingToSend: '{verb} {target}',
    };

    /**
     * Translate one key against `params`, mirroring the locale service's
     * `{name}` interpolation.
     * @param key - the dictionary key.
     * @param params - values substituted into `{name}` slots.
     * @returns the rendered copy, or the key itself when it is unknown.
     */
    function translate(key, params) {
      const template = Object.prototype.hasOwnProperty.call(DICTIONARY, key) ? DICTIONARY[key] : key;
      if (params === undefined) return template;
      return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
    }

    /** The file Remote caps one text page at this many lines. */
    const PAGE_LINES = 5000;

    /** Hard stop so a pathological file cannot spin the reader. */
    const MAX_PAGES = 20;

    /* ------------------------------------------------------------------ *
     * Transport
     * ------------------------------------------------------------------ */

    /**
     * Read the whole snapshot through the file Remote, one page at a time.
     * @param remote - the `workspaceFiles` Remote namespace.
     * @param sessionId - the Session authorizing the read.
     * @param signal - caller lifetime.
     * @returns the raw JSON text.
     */
    async function readSnapshotText(remote, path, sessionId, signal) {
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
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
      codeBg: 'var(--dsw-alias-markdown-code-block)',
    };

    const MONO = 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)';

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
      pathText: {
        fontSize: '12px',
        lineHeight: '18px',
        color: C.labelTertiary,
        fontFamily: MONO,
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
      body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '4px 24px 24px' },
      project: { marginBottom: '28px' },
      projectHead: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' },
      projectName: { fontSize: '14px', fontWeight: 600, margin: 0 },
      projectPath: { fontSize: '11px', color: C.labelTertiary, fontFamily: MONO },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '12px' },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px',
        background: C.bgLayer1,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '10px',
        minWidth: 0,
      },
      cardHead: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
      dot: { flex: 'none', width: '8px', height: '8px', borderRadius: '50%' },
      cardName: {
        fontSize: '13px',
        fontWeight: 600,
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
      command: {
        fontSize: '11px',
        lineHeight: '16px',
        color: C.labelSecondary,
        fontFamily: MONO,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      tail: {
        height: '132px',
        overflow: 'auto',
        margin: 0,
        padding: '8px',
        background: C.codeBg,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '6px',
        fontFamily: MONO,
        fontSize: '11px',
        lineHeight: '15px',
        color: C.labelSecondary,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      },
      tailEmpty: { fontStyle: 'italic', color: C.labelTertiary },
      proposal: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '8px',
        background: C.codeBg,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '6px',
        fontFamily: MONO,
        fontSize: '11px',
        lineHeight: '16px',
        color: C.labelSecondary,
      },
      proposalLine: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      notes: { fontSize: '11px', lineHeight: '16px', color: C.labelTertiary },
      sectionToggle: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        padding: 0,
        fontSize: '14px',
        fontWeight: 600,
        color: C.labelPrimary,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      },
      actions: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
      button: {
        height: '24px',
        padding: '0 10px',
        fontSize: '11px',
        fontWeight: 500,
        color: C.labelPrimary,
        background: 'transparent',
        border: `1px solid ${C.borderL2}`,
        borderRadius: '6px',
        cursor: 'pointer',
      },
      buttonDisabled: {
        height: '24px',
        padding: '0 10px',
        fontSize: '11px',
        fontWeight: 500,
        color: C.labelTertiary,
        background: 'transparent',
        border: `1px solid ${C.borderL2}`,
        borderRadius: '6px',
        cursor: 'default',
      },
      status: { padding: '24px', fontSize: '13px', color: C.labelSecondary, textAlign: 'center' },
      notice: {
        margin: '0 0 12px',
        padding: '10px 12px',
        fontSize: '12px',
        lineHeight: '18px',
        background: C.bgLayer1,
        border: `1px solid ${C.borderL2}`,
        borderRadius: '8px',
      },
    };

    /**
     * The colour token for one process's state.
     * @param status - the reported status.
     * @param errorCount - error-like lines seen so far.
     * @returns a CSS colour.
     */
    function statusColor(status, errorCount) {
      if (status === 'running') return errorCount > 0 ? C.warn : C.success;
      if (status === 'failed') return C.error;
      if (status === 'idle') return C.idle;
      return C.labelTertiary;
    }

    /* ------------------------------------------------------------------ *
     * Sidebar entry icon
     * ------------------------------------------------------------------ */

    /**
     * Decorative monitor glyph for the sidebar panel list.
     * @param props - the panel list passes the requested glyph size.
     * @returns an inline SVG element.
     */
    function WorkspaceIcon({ size }) {
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
        h('rect', {
          x: 1.6, y: 2.6, width: 12.8, height: 8.6, rx: 1.4,
          stroke: 'currentColor', strokeWidth: 1.4,
        }),
        h('path', {
          d: 'M5.6 13.6h4.8M8 11.2v2.4',
          stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
        }),
      );
    }

    /* ------------------------------------------------------------------ *
     * Process card
     * ------------------------------------------------------------------ */

    /**
     * One process: status, command, badges, a live log tail and its controls.
     * @param props - the process record, the action callback, and the translator.
     * @returns the rendered card.
     */
    function ProcessCard({ project, process, busy, onAction, t = translate }) {
      const colour = statusColor(process.status, process.errorCount);
      const running = process.status === 'running';
      const tail = Array.isArray(process.tail) ? process.tail : [];
      const title = process.port === undefined ? process.name : `${process.name} :${process.port}`;

      const button = (label, verb, disabled) => h(
        'button',
        {
          key: verb,
          type: 'button',
          style: disabled ? s.buttonDisabled : s.button,
          disabled: disabled === true,
          onClick: () => { if (disabled !== true) onAction(verb, project.name, process.name); },
        },
        label,
      );

      return h(
        'div',
        { style: s.card },
        h(
          'div',
          { style: s.cardHead },
          h('span', { style: { ...s.dot, background: colour }, 'aria-hidden': true }),
          h('span', { style: s.cardName, title: title }, process.name),
        ),
        h('div', { style: s.badgeRow },
          h('span', { style: { ...s.badge, color: colour } }, process.status),
          process.port !== undefined && h('span', {
            style: s.badge,
            title: typeof process.portNote === 'string' ? process.portNote : t('tailHint', { port: process.port }),
          }, t('portBadge', { port: process.port })),
          typeof process.portNote === 'string' && h('span', { style: { ...s.badge, color: C.warn } }, t('portMoved')),
          process.errorCount > 0 && h('span', { style: { ...s.badge, color: C.warn } }, t('errorShort', { count: process.errorCount })),
          process.exitCode !== null && process.exitCode !== undefined && process.exitCode !== 0
            && h('span', { style: { ...s.badge, color: C.error } }, t('exitCode', { code: process.exitCode })),
          process.restarts > 0 && h('span', { style: s.badge }, t('restartCount', { count: process.restarts })),
        ),
        // Show the command that actually ran, since port management may have
        // rewritten it; the configured command stays in the tooltip.
        h('div', {
          style: s.command,
          title: [
            typeof process.effectiveCommand === 'string' ? `configuration: ${process.command}` : undefined,
            `cwd: ${process.cwd}`,
          ].filter((part) => part !== undefined).join('  —  '),
        }, t('commandLine', { command: typeof process.effectiveCommand === 'string' ? process.effectiveCommand : process.command })),
        h(
          'pre',
          { style: s.tail, 'aria-label': t('logTailLabel', { name: process.name }) },
          tail.length === 0
            ? h('span', { style: s.tailEmpty }, running ? t('waitingOutput') : t('noOutput'))
            : tail.join('\n'),
        ),
        h('div', { style: s.actions },
          button(t('start'), 'start', running || busy),
          button(t('restart'), 'restart', busy),
          button(t('stop'), 'stop', !running || busy),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Onboarding candidate card
     * ------------------------------------------------------------------ */

    /**
     * One project that has no config yet: what offline detection proposed, and
     * the two ways to onboard it — write the detected config, or hand the
     * project to an agent.
     * @param props - the candidate record, the action callback, and the translator.
     * @returns the rendered card.
     */
    function CandidateCard({ candidate, busy, onAction, t = translate }) {
      const proposed = Array.isArray(candidate.proposal) ? candidate.proposal : [];
      const notes = Array.isArray(candidate.notes) ? candidate.notes : [];
      const high = candidate.confidence === 'high' && proposed.length > 0;
      const here = busy === candidate.name;

      return h(
        'div',
        { style: { ...s.card, opacity: here ? 0.6 : 1 } },
        h('div', { style: s.cardHead }, h('span', { style: s.cardName, title: candidate.root }, candidate.name)),
        h('div', { style: s.badgeRow },
          h('span', { style: s.badge }, candidate.manager),
          h('span', { style: { ...s.badge, color: high ? C.success : C.warn } }, high ? t('highConfidence') : t('needsReview')),
          proposed.length === 0 && h('span', { style: { ...s.badge, color: C.warn } }, t('nothingDetected')),
        ),
        h(
          'div',
          { style: s.proposal },
          proposed.length === 0
            ? h('span', { style: s.tailEmpty }, t('agentMustInspect'))
            : proposed.map((entry) => h('div', { key: entry.name, style: s.proposalLine }, t('commandLine', { command: entry.command }))),
        ),
        notes.length > 0 && h('div', { style: s.notes }, notes.map((note, index) => h('div', { key: index }, note))),
        h('div', { style: s.actions },
          h('button', {
            type: 'button',
            style: proposed.length === 0 || here ? s.buttonDisabled : s.button,
            disabled: proposed.length === 0 || here,
            onClick: () => { if (proposed.length > 0 && !here) onAction('onboard', candidate.name); },
          }, t('onboard')),
          h('button', {
            type: 'button',
            style: here ? s.buttonDisabled : s.button,
            disabled: here,
            onClick: () => { if (!here) onAction('init', candidate.name); },
          }, t('askAgent')),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Panel page
     * ------------------------------------------------------------------ */

    /**
     * The AI Workspace page: one section per project, one card per process.
     * @param props - the stable `api` object injected by the registration, and
     *   the locale `t` seat (absent in contexts without the locale service, in
     *   which case the bundled English dictionary is used).
     * @returns the rendered panel.
     */
    function WorkspacePage({ api, t: seat }) {
      const t = typeof seat === 'function' ? seat : translate;
      const [snapshot, setSnapshot] = useState(null);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [busy, setBusy] = useState(null);
      const [live, setLive] = useState(true);
      const [loading, setLoading] = useState(true);
      // null means "decide from the data": a short backlog starts expanded.
      const [candidatesOpen, setCandidatesOpen] = useState(null);
      // The project awaiting a second click before its config is removed.
      const [pendingOffboard, setPendingOffboard] = useState(null);
      /** Free-text filter over project, process and candidate names. */
      const [query, setQuery] = useState('');
      /** Candidate view: all | high | review | agent. */
      const [candidateView, setCandidateView] = useState('all');
      /** 'idle' until the push feed reports; 'live' while it streams, else 'unavailable'. */
      const [push, setPush] = useState('idle');
      /** Guards overlapping reads when a push arrives during a poll. */
      const inFlight = useRef(false);

      const load = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        try {
          const next = await api.load();
          setSnapshot(next);
          setError(null);
        } catch (problem) {
          setError(messageOf(problem));
        } finally {
          inFlight.current = false;
          setLoading(false);
        }
      }, [api]);

      useEffect(() => { void load(); }, [load]);

      // Push feed: the Host already announces each snapshot rewrite, so react to
      // it instead of waiting for the next poll. Polling stays installed — it is
      // the fallback when the feed cannot open, and the safety net when it goes
      // quiet — but it slows right down once the feed is live.
      useEffect(() => {
        let dispose;
        try {
          dispose = api.watch({
            onReady: () => setPush('live'),
            onChange: () => { void load(); },
            onUnavailable: () => setPush('unavailable'),
          });
        } catch {
          setPush('unavailable');
        }
        return () => { if (typeof dispose === 'function') dispose(); };
      }, [api, load]);

      useEffect(() => {
        if (!live) return undefined;
        const interval = push === 'live' ? PUSH_POLL_MS : POLL_MS;
        const timer = setInterval(() => { void load(); }, interval);
        return () => clearInterval(timer);
      }, [live, load, push]);

      const projects = snapshot !== null && Array.isArray(snapshot.projects) ? snapshot.projects : [];
      const candidates = snapshot !== null && Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
      const onboardable = useMemo(
        () => candidates.filter((candidate) => Array.isArray(candidate.proposal) && candidate.proposal.length > 0).length,
        [candidates],
      );
      const highConfidence = useMemo(
        () => candidates.filter((candidate) => candidate.confidence === 'high' && Array.isArray(candidate.proposal) && candidate.proposal.length > 0).length,
        [candidates],
      );
      const openCandidates = candidatesOpen ?? candidates.length <= 12;

      const needle = query.trim().toLowerCase();
      const shows = (text) => needle.length === 0 || (typeof text === 'string' && text.toLowerCase().includes(needle));

      /** Projects surviving the filter: their name or root, or any process name or command. */
      const visibleProjects = useMemo(() => {
        if (needle.length === 0) return projects;
        return projects.filter((project) =>
          shows(project.name)
          || shows(project.root)
          || (Array.isArray(project.processes)
            && project.processes.some((process) => shows(process.name) || shows(process.command))));
      }, [projects, needle]);

      /** Candidates surviving both the view chip and the filter. */
      const visibleCandidates = useMemo(() => {
        const proposed = (candidate) => Array.isArray(candidate.proposal) && candidate.proposal.length > 0;
        let rows = candidates;
        if (candidateView === 'high') rows = rows.filter((candidate) => proposed(candidate) && candidate.confidence === 'high');
        else if (candidateView === 'review') rows = rows.filter((candidate) => proposed(candidate) && candidate.confidence !== 'high');
        else if (candidateView === 'agent') rows = rows.filter((candidate) => !proposed(candidate));
        if (needle.length === 0) return rows;
        return rows.filter((candidate) => shows(candidate.name) || shows(candidate.root));
      }, [candidates, candidateView, needle]);
      const totals = useMemo(() => {
        let processes = 0;
        let running = 0;
        let errors = 0;
        for (const project of projects) {
          for (const process of Array.isArray(project.processes) ? project.processes : []) {
            processes += 1;
            if (process.status === 'running') running += 1;
            if (typeof process.errorCount === 'number') errors += process.errorCount;
          }
        }
        return { processes, running, errors };
      }, [projects]);

      const onAction = useCallback(async (verb, projectName, processName) => {
        // Candidate actions name only a project; process actions name both.
        const key = processName === undefined ? projectName : `${projectName}/${processName}`;
        setBusy(key);
        setNotice(null);
        try {
          const text = await api.run(verb, projectName, processName);
          setNotice({ kind: 'info', text: text ?? t('nothingToSend', { verb, target: key }) });
          // The Host flushes on change and on a short interval; give it a beat.
          setTimeout(() => { void load(); }, 400);
        } catch (problem) {
          setNotice({ kind: 'error', text: t('toolFailed', { verb, target: key, error: messageOf(problem) }) });
        } finally {
          setBusy(null);
        }
      }, [api, load, t]);

      const onGlobal = useCallback(async (line, label) => {
        setNotice(null);
        try {
          const text = await api.run(line);
          setNotice({ kind: 'info', text: text ?? label });
          setTimeout(() => { void load(); }, 400);
        } catch (problem) {
          setNotice({ kind: 'error', text: t('toolFailed', { verb: label, target: '', error: messageOf(problem) }) });
        }
      }, [api, load, t]);

      return h(
        'div',
        { style: s.root },
        h(
          'div',
          { style: s.header },
          h(
            'div',
            { style: s.titleRow },
            h('h1', { style: s.title }, t('panelTitle')),
            h('span', { style: s.subtitle }, t('projectSummary', {
              count: projects.length,
              plural: projects.length === 1 ? '' : 's',
              running: totals.running,
              total: totals.processes,
            })),
            candidates.length > 0 && h('span', { style: s.subtitle }, t('notOnboarded', { count: candidates.length })),
            // Which update path is actually in use, so "why is this slow" has an
            // answer on screen instead of in the console.
            h('span', {
              style: { ...s.subtitle, color: push === 'live' ? C.success : C.labelTertiary },
              title: push === 'live'
                ? t('streamingHint', { seconds: PUSH_POLL_MS / 1000 })
                : push === 'unavailable'
                  ? t('pollingHint', { seconds: POLL_MS / 1000 })
                  : t('connectingHint'),
            }, push === 'live' ? t('streaming') : push === 'unavailable' ? t('polling') : t('connecting')),
            totals.errors > 0 && h('span', { style: { ...s.subtitle, color: C.warn } }, t('errorLines', { count: totals.errors })),
          ),
          h('div', { style: s.pathText, title: api.statusPath },
            snapshot !== null && typeof snapshot.projectsRoot === 'string' ? snapshot.projectsRoot : api.statusPath),
          h(
            'div',
            { style: s.toolbar },
            h('input', {
              style: s.search,
              type: 'search',
              value: query,
              placeholder: t('filterPlaceholder'),
              'aria-label': t('filterLabel'),
              onChange: (event) => setQuery(event.target.value),
            }),
            h('button', { type: 'button', style: s.chip, onClick: () => { void load(); } },
              loading ? t('loading') : t('refresh')),
            h('button', { type: 'button', style: live ? s.chipActive : s.chip, 'aria-pressed': live, onClick: () => setLive(!live) },
              live ? t('live') : t('paused')),
            h('button', { type: 'button', style: s.chip, onClick: () => { void onGlobal('rescan', t('rescan')); } }, t('rescan')),
            h('button', { type: 'button', style: s.chip, onClick: () => { void onGlobal('start-all', t('startAll')); } }, t('startAll')),
            h('button', { type: 'button', style: s.chip, onClick: () => { void onGlobal('stop-all', t('stopAll')); } }, t('stopAll')),
            query.length > 0 && h('button', { type: 'button', style: s.chip, onClick: () => setQuery('') }, t('clear')),
          ),
        ),
        h(
          'div',
          { style: s.body },
          notice !== null && h('div', {
            style: { ...s.notice, color: notice.kind === 'error' ? C.error : C.business },
          }, notice.text),
          error !== null && h('div', { style: { ...s.notice, color: C.error } },
            t('readFailed', { error })),
          // A wiring failure is otherwise only visible in the Host log, which is
          // exactly the wrong place for "the agent cannot see your processes".
          snapshot !== null && typeof snapshot.wiring?.tool === 'string' && snapshot.wiring.tool !== 'ready'
            && h('div', { style: { ...s.notice, color: C.warn } },
              t('wiringMissing', { reason: snapshot.wiring.tool })),
          loading && snapshot === null && h('div', { style: s.status }, t('loadingState')),
          !loading && error === null && projects.length === 0 && candidates.length === 0 && h('div', { style: s.status },
            t('nothingToShow')),
          needle.length > 0 && visibleProjects.length === 0 && projects.length > 0
            && h('div', { style: s.status }, t('noManagedMatch')),
          visibleProjects.map((project) => h(
            'section',
            { key: project.root, style: s.project },
            h(
              'div',
              { style: s.projectHead },
              h('h2', { style: s.projectName }, project.name),
              h('span', { style: s.projectPath, title: project.root }, project.root),
              typeof project.source === 'string' && h('span', { style: s.badge }, project.source),
              // Only the plugin's own file is removable; a hand-written legacy
              // config is the user's to manage, so no control is offered for it.
              project.source === '.ai-workspace.json' && (
                pendingOffboard === project.name
                  ? h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
                    h('span', { style: { ...s.subtitle, color: C.warn } }, t('confirmOffboard')),
                    h('button', {
                      type: 'button',
                      style: { ...s.button, borderColor: C.error, color: C.error },
                      onClick: () => { setPendingOffboard(null); onAction('offboard', project.name); },
                    }, t('remove')),
                    h('button', { type: 'button', style: s.button, onClick: () => setPendingOffboard(null) }, t('cancel')),
                  )
                  : h('button', {
                    type: 'button',
                    style: s.button,
                    title: t('offboardTitle'),
                    onClick: () => setPendingOffboard(project.name),
                  }, t('offboard'))
              ),
            ),
            project.error !== undefined && h('div', { style: { ...s.notice, color: C.error } }, project.error),
            (() => {
              const processes = Array.isArray(project.processes) ? project.processes : [];
              if (processes.length === 0) {
                return h('div', { style: { ...s.status, textAlign: 'left', padding: '8px 0' } },
                  project.error !== undefined ? t('noProcessesRead') : t('noProcessesDeclared'));
              }
              return h('div', { style: s.grid }, processes.map((process) => h(ProcessCard, {
                key: `${project.root}/${process.name}`,
                project,
                process,
                busy: busy === `${project.name}/${process.name}`,
                onAction,
                t,
              })));
            })(),
          )),
          candidates.length > 0 && h(
            'section',
            { key: '__onboarding__', style: s.project },
            h(
              'div',
              { style: s.projectHead },
              h('button', {
                type: 'button',
                style: s.sectionToggle,
                'aria-expanded': openCandidates,
                onClick: () => setCandidatesOpen(!openCandidates),
              }, `${openCandidates ? '▾' : '▸'} ${visibleCandidates.length === candidates.length
                ? t('backlog', { count: candidates.length })
                : t('backlogFiltered', { shown: visibleCandidates.length, total: candidates.length })}`),
              h('span', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } },
                ...[
                  ['all', t('viewAll', { count: candidates.length })],
                  ['high', t('viewHigh', { count: highConfidence })],
                  ['review', t('viewReview', { count: candidates.filter((c) => (c.proposal ?? []).length > 0 && c.confidence !== 'high').length })],
                  ['agent', t('viewAgent', { count: candidates.filter((c) => (c.proposal ?? []).length === 0).length })],
                ].map(([id, label]) => h('button', {
                  key: id,
                  type: 'button',
                  style: candidateView === id ? s.chipActive : s.chip,
                  'aria-pressed': candidateView === id,
                  onClick: () => setCandidateView(id),
                }, label))),
              h('span', { style: s.subtitle }, highConfidence > 0
                ? t('proposalSummaryHigh', { proposed: onboardable, high: highConfidence })
                : t('proposalSummary', { proposed: onboardable })),
              highConfidence > 0 && h('button', {
                type: 'button',
                style: s.chip,
                onClick: () => { void onGlobal('onboard --all', t('onboardAll', { count: highConfidence })); },
              }, t('onboardAll', { count: highConfidence })),
            ),
            openCandidates && visibleCandidates.length === 0 && candidates.length > 0
              && h('div', { style: { ...s.status, textAlign: 'left', padding: '8px 0' } }, t('noCandidateMatch')),
            openCandidates && h('div', { style: s.grid }, visibleCandidates.map((candidate) => h(CandidateCard, {
              key: candidate.root,
              candidate,
              busy,
              onAction,
              t,
            }))),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Cordis plugin
     * ------------------------------------------------------------------ */

    /** Services this Client plugin needs: slots, sessions, the layout, and two Remotes. */
    const inject = ['slots', 'sessions', 'layout', 'remote', 'remote.workspaceFiles', 'remote.commands'];

    /**
     * Register the sidebar row and the main page, and expose the operations the
     * page's buttons use.
     * @param ctx - the Client plugin context.
     */
    function apply(ctx) {
      /**
       * The Session authorizing Remote calls. A root-scoped panel receives no
       * session props, so the first open Session is used, as the Projects panel
       * does.
       * @returns the Session id.
       */
      const firstSession = () => {
        const snapshot = ctx.sessions.list.getSnapshot();
        const sessionId = Array.isArray(snapshot?.ids) ? snapshot.ids[0] : undefined;
        if (sessionId === undefined) throw new Error('No session is open to authorize this call. Open a session first.');
        return sessionId;
      };

      // One stable object so React effects that depend on it do not re-run every render.
      const api = {
        /** The resolved snapshot path, for the header line only. */
        statusPath: statusPathOf(ctx),
        /**
         * Read and parse the Host's status snapshot.
         * @returns the parsed snapshot.
         */
        load: async () => {
          const sessionId = firstSession();
          const text = await readSnapshotText(ctx.remote.workspaceFiles, statusPathOf(ctx), sessionId, new AbortController().signal);
          if (text.trim().length === 0) return { projects: [], projectsRoot: undefined };
          return JSON.parse(text);
        },
        /**
         * Run an `/ai-workspace` command on the Host and surface its text.
         * @param verb - the subcommand, or a full argument list.
         * @param projectName - optional project name.
         * @param processName - optional process name.
         * @returns the command's message, when it produced one.
         */
        run: async (verb, projectName, processName) => {
          const sessionId = firstSession();
          const args = [verb, projectName, processName].filter((part) => typeof part === 'string' && part.length > 0);
          const line = `/ai-workspace ${args.join(' ')}`;
          const result = await ctx.remote.commands.execute(sessionId, line, []);
          if (result.ok !== true) {
            const error = result.error ?? {};
            throw new Error(`${error.code ?? 'command-failed'}${typeof error.message === 'string' ? `: ${error.message}` : ''}`);
          }
          if (result.value === undefined) throw new Error(`the command "${line}" is not registered`);
          // `execute` settles a CommandExecution: the normalized result plus its
          // lifecycle commandId.
          const outcome = result.value.result;
          if (outcome === undefined) return undefined;
          const text = typeof outcome.text === 'string' && outcome.text.length > 0 ? outcome.text : undefined;
          if (outcome.kind === 'error') throw new Error(text ?? `the command "${line}" failed`);
          return text;
        },
        /**
         * Follow the Host's snapshot file through the workspace-file push feed.
         *
         * `changes` is a Remote stream that yields `ready` once and then a
         * `change` frame per rewrite, so the panel reacts instead of waiting for
         * the next poll. Every failure path — no `$stream` on this build, no
         * open Session, a dropped carrier — reports `onUnavailable` and leaves
         * the caller's polling in place rather than breaking the page.
         *
         * @param handlers - `onReady`, `onChange` and `onUnavailable` callbacks.
         * @returns a disposer for the feed.
         */
        watch: (handlers) => {
          const sessionId = firstSession();
          let stream;
          try {
            stream = ctx.remote.$stream({
              name: `ai-workspace status snapshot of ${sessionId}`,
              open: (signal) => ctx.remote.workspaceFiles.changes(sessionId, statusPathOf(ctx), signal),
              ended: () => new Error('ai-workspace status change stream ended'),
            });
          } catch (error) {
            handlers.onUnavailable?.(messageOf(error));
            return () => undefined;
          }

          void (async () => {
            try {
              for await (const item of stream) {
                const frame = item.value;
                // `accept()` marks the stream as having produced data, which is
                // what decides whether a later end is retried or terminal.
                if (frame?.kind === 'ready') { item.accept(); handlers.onReady?.(); }
                else if (frame?.kind === 'change') handlers.onChange?.();
              }
              handlers.onUnavailable?.('the change stream ended');
            } catch (error) {
              handlers.onUnavailable?.(messageOf(error));
            }
          })();

          return () => {
            try { stream.dispose(); } catch { /* already closed */ }
          };
        },
      };

      // Register the panel's copy as a locale namespace, and keep a bound
      // translator for the places that render outside the entry's `t` seat (the
      // sidebar row label, which the panel list resolves at read time).
      //
      // Only `en` is registered. The locale fallback chain always resolves `en`,
      // so another language shows English copy rather than nothing, and a
      // translation can be added later without touching the components. The
      // namespace is declared on both registrations below, which is what makes
      // the renderer inject the reactive `t` seat into the page.
      let localize = (key) => translate(key);
      ctx.inject(['locale'], (localeCtx) => {
        localeCtx.effect(
          () => localeCtx.locale.register(NAMESPACE, { en: DICTIONARY }),
          'ai-workspace: locale namespace',
        );
        localize = localeCtx.locale.bind(NAMESPACE);
      });

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NAMESPACE,
        inject: () => ({ api }),
      }, WorkspacePage));

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        locale: NAMESPACE,
        // A thunk, so the row follows the active locale instead of freezing the
        // label at registration time.
        label: () => localize('panelTitle'),
      }, WorkspaceIcon));
    }

    return { name: PANEL_ID, inject, apply };
  },
});
