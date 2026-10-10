/**
 * Client half of the Action cards bundle.
 *
 * Two surfaces over one idea: the agent proposes a concrete action, and the
 * human applies it.
 *
 * 1. A keyed `tool.call.toolview` for the wire tool `propose_action`. The card
 *    reads the proposal straight from the tool call's own arguments, so it
 *    renders before the Host has finished recording anything.
 * 2. A right-Sidebar page (`ctx.sidebarRightTabs` + `sidebar.right.pane.tab`)
 *    listing every proposal, so a card you scrolled past is still reachable.
 *
 * The Client never touches the filesystem. Applying sends the edited proposal
 * to the Host through `ctx.remote.commands.execute`, which runs `/actions apply`
 * without spending a model turn; the Host does the sandboxed write, edit or
 * command and reports the outcome.
 *
 * @module @malipetek/dsh-action-cards/client
 */
window.__ModuleLoader__.load({
  id: '@malipetek/dsh-action-cards',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback, useRef } = React;

    /** The wire tool name this bundle renders. */
    const TOOL_NAME = 'propose_action';
    /** The Host command this bundle drives. */
    const COMMAND_NAME = 'actions';
    /** Right-Sidebar page type identity; also the body registration key. */
    const TAB_ID = '@malipetek/dsh-action-cards/actions';
    /** The tab `kind` a page is opened by. */
    const TAB_KIND = 'action-cards';
    /**
     * The Host's action store. The tool result carries the resolved path in its
     * metadata; this literal is the fallback, and must match `index.js`.
     */
    const DEFAULT_STORE_PATH = '/Users/malipetek/.dsh/action-cards/actions.json';
    /** The file Remote caps one text page at this many lines. */
    const PAGE_LINES = 5000;
    /** Hard stop so a pathological store cannot spin the reader. */
    const MAX_PAGES = 20;
    /** Field values are capped so one paste cannot blow up the command line. */
    const MAX_FIELD_CHARS = 20000;
    /** How much of a file's content the preview block shows. */
    const PREVIEW_LINES = 400;

    /* ------------------------------------------------------------------ *
     * Template values
     * ------------------------------------------------------------------ */

    /**
     * Matches a `{{ name }}` placeholder. Mirrored by `TOKEN` in `index.js`;
     * the Host substitution is the authoritative one, this copy only previews.
     */
    const TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

    /**
     * Replace every `{{ name }}` placeholder with the supplied value.
     * @param text - the template text, possibly not a string.
     * @param values - field name to value.
     * @returns the substituted text, or the input unchanged when it is not a string.
     */
    function substitute(text, values) {
      if (typeof text !== 'string' || text.length === 0) return text;
      return text.replace(TOKEN, (whole, name) => {
        const value = values === undefined || values === null ? undefined : values[name];
        return value === undefined || value === null ? whole : String(value);
      });
    }

    /**
     * Collect the field names a step declares, in first-seen order.
     * @param steps - the proposal's steps.
     * @returns field descriptors, de-duplicated by name.
     */
    function collectFields(steps) {
      const seen = new Map();
      if (!Array.isArray(steps)) return [];
      for (const step of steps) {
        if (step === null || typeof step !== 'object' || !Array.isArray(step.fields)) continue;
        for (const field of step.fields) {
          if (field === null || typeof field !== 'object') continue;
          const name = typeof field.name === 'string' ? field.name.trim() : '';
          if (name.length === 0 || seen.has(name)) continue;
          seen.set(name, {
            name,
            label: typeof field.label === 'string' && field.label.length > 0 ? field.label : name,
            hint: typeof field.hint === 'string' ? field.hint : '',
            value: typeof field.value === 'string' ? field.value : '',
            secret: field.secret === true,
          });
        }
      }
      return [...seen.values()];
    }

    /**
     * Seed the editor's values from the fields' suggested defaults.
     * @param fields - output of {@link collectFields}.
     * @param stored - values already recorded by the Host, which win.
     * @returns a field name to value map.
     */
    function seedValues(fields, stored) {
      const values = {};
      for (const field of fields) values[field.name] = field.value;
      if (stored !== null && typeof stored === 'object') {
        for (const [name, value] of Object.entries(stored)) {
          if (typeof value === 'string') values[name] = value;
        }
      }
      return values;
    }

    /**
     * Names of declared fields that are still empty and still appear as a
     * placeholder somewhere in the proposal.
     * @param steps - the proposal's steps.
     * @param fields - output of {@link collectFields}.
     * @param values - current field values.
     * @returns the blocking field labels.
     */
    function missingFields(steps, fields, values) {
      const texts = [];
      for (const step of Array.isArray(steps) ? steps : []) {
        if (step === null || typeof step !== 'object') continue;
        for (const key of ['path', 'content', 'search', 'replace', 'command', 'cwd']) {
          if (typeof step[key] === 'string') texts.push(step[key]);
        }
      }
      const blob = texts.join('\n');
      const missing = [];
      for (const field of fields) {
        const value = values[field.name];
        if (typeof value === 'string' && value.trim().length > 0) continue;
        if (blob.includes(`{{${field.name}}}`) || blob.includes(`{{ ${field.name} }}`)) missing.push(field.label);
      }
      return missing;
    }

    /* ------------------------------------------------------------------ *
     * Reading the tool call
     * ------------------------------------------------------------------ */

    /**
     * Parse the complete argument JSON of a started or settled call.
     * @param block - the frozen stage block.
     * @param phase - the call's phase.
     * @returns the parsed arguments, or null while preparing or on malformed JSON.
     */
    function parseCall(block, phase) {
      if (phase === 'preparing') return null;
      const raw = phase === 'result' ? block?.call?.argsRaw : block?.argsRaw;
      if (typeof raw !== 'string' || raw.length === 0) return null;
      try {
        const args = JSON.parse(raw);
        if (args === null || typeof args !== 'object' || Array.isArray(args)) return null;
        return args;
      } catch {
        return null;
      }
    }

    /**
     * Flatten a settled result's content under the ui-tool contract.
     * @param block - the result block.
     * @returns the result text.
     */
    function resultText(block) {
      const parts = [];
      for (const part of Array.isArray(block?.content) ? block.content : []) {
        if (part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') parts.push(part.text);
        else parts.push(JSON.stringify(part, null, 2));
      }
      if (parts.length === 0 && block?.error !== undefined) parts.push(`${block.error.name}: ${block.error.code}`);
      return parts.join('\n');
    }

    /**
     * Build the display model for one call.
     *
     * The tool's result metadata is the fallback source, because a result block
     * can arrive without its call (`block.call === null`) at a page boundary.
     *
     * @param callId - the call identity, which is also the action identity.
     * @param args - the parsed arguments, or null.
     * @param meta - the settled result's metadata, or undefined.
     * @param phase - the call's phase.
     * @returns the model consumed by the editor.
     */
    function modelOf(callId, args, meta, phase) {
      const source = args !== null && args !== undefined ? args : meta;
      const steps = Array.isArray(source?.steps) ? source.steps : [];
      return {
        id: typeof meta?.actionId === 'string' && meta.actionId.length > 0 ? meta.actionId : callId,
        title: typeof source?.title === 'string' && source.title.length > 0 ? source.title : 'Proposed action',
        note: typeof source?.note === 'string' ? source.note : '',
        steps,
        // What the Host found when it looked at each target before showing this.
        checks: meta?.checks !== null && typeof meta?.checks === 'object' ? meta.checks : {},
        storePath: typeof meta?.storePath === 'string' && meta.storePath.length > 0 ? meta.storePath : DEFAULT_STORE_PATH,
        malformed: phase === 'result' && args === null && steps.length === 0,
      };
    }

    /* ------------------------------------------------------------------ *
     * Steps, presented
     * ------------------------------------------------------------------ */

    /** One-line headline for a step, before substitution. */
    function stepTitle(step) {
      if (step === null || typeof step !== 'object') return 'Unknown step';
      if (step.kind === 'write_file') return 'Create file';
      if (step.kind === 'edit_file') return 'Edit file';
      if (step.kind === 'run_command') return 'Run command';
      return String(step.kind ?? 'Step');
    }

    /**
     * The line shown next to a step: its path, or the command.
     * @param step - one proposal step.
     * @param values - current field values.
     * @returns display text.
     */
    function stepDetail(step, values) {
      if (step === null || typeof step !== 'object') return '';
      if (step.kind === 'run_command') return substitute(typeof step.command === 'string' ? step.command : '', values);
      return substitute(typeof step.path === 'string' ? step.path : '', values);
    }

    /**
     * The code body a step would produce, for the preview block.
     * @param step - one proposal step.
     * @param values - current field values.
     * @returns preview text, or an empty string when the step has no body.
     */
    function stepPreview(step, values) {
      if (step === null || typeof step !== 'object') return '';
      if (step.kind === 'write_file') return substitute(typeof step.content === 'string' ? step.content : '', values);
      if (step.kind === 'edit_file') {
        const search = substitute(typeof step.search === 'string' ? step.search : '', values);
        const replace = substitute(typeof step.replace === 'string' ? step.replace : '', values);
        return `- ${search}\n+ ${replace}`;
      }
      if (step.kind === 'run_command') {
        const cwd = typeof step.cwd === 'string' && step.cwd.length > 0 ? ` (in ${substitute(step.cwd, values)})` : '';
        return `$ ${substitute(typeof step.command === 'string' ? step.command : '', values)}${cwd}`;
      }
      return '';
    }

    /**
     * Turn one of the Host's pre-flight checks into a warning, if it has one.
     *
     * The Host looks at each target when the proposal is made, so the card can
     * say "this will overwrite a file" or "this text occurs three times" before
     * the human spends an apply finding out.
     *
     * @param check - the check record for one step.
     * @returns a warning line, or an empty string when there is nothing to say.
     */
    function checkWarning(check) {
      if (check === null || typeof check !== 'object') return '';
      if (check.deferred === true) return '';
      if (check.error !== undefined) return String(check.error);
      if (check.exists === true) return 'overwrites an existing file';
      if (check.missing === true) return 'this file does not exist yet';
      if (typeof check.matches === 'number' && check.matches !== 1) {
        return check.matches === 0 ? 'the text to replace is not in the file' : `the text to replace occurs ${check.matches} times`;
      }
      return '';
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
      borderL1: 'var(--dsw-alias-border-l1)',
      borderL2: 'var(--dsw-alias-border-l2)',
      code: 'var(--dsw-alias-markdown-code-block)',
      primaryFill: 'var(--dsw-alias-button-primary-fill)',
      primaryHover: 'var(--dsw-alias-button-primary-hover)',
      floatingFill: 'var(--dsw-alias-button-floating-fill)',
      floatingHover: 'var(--dsw-alias-button-floating-hover)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      business: 'var(--dsw-alias-state-business-primary)',
      interactiveHover: 'var(--dsw-alias-interactive-bg-hover)',
      radiusLg: 'var(--dsw-radius-lg)',
      radiusSm: 'var(--dsw-radius-sm)',
      mono: 'var(--dsw-font-markdown-code-block-small)',
      textSm: 'var(--dsh-content-font-size-secondary, 13px)',
      textXs: 'var(--dsw-font-xxs-12, 12px)',
    };

    /** Status to its display tone. */
    const STATUS = {
      pending: { label: 'Waiting for you', color: C.warn },
      applying: { label: 'Applying…', color: C.business },
      applied: { label: 'Applied', color: C.success },
      partial: { label: 'Partly applied', color: C.warn },
      failed: { label: 'Failed', color: C.error },
      dismissed: { label: 'Dismissed', color: C.labelTertiary },
      unknown: { label: 'Waiting for you', color: C.warn },
    };

    /**
     * The tone entry for a status, tolerating an unrecognised one.
     * @param status - the stored status.
     * @returns the display entry.
     */
    function statusTone(status) {
      return STATUS[status] ?? STATUS.unknown;
    }

    const s = {
      card: {
        border: `0.5px solid ${C.borderL2}`,
        borderRadius: C.radiusLg,
        background: C.bgLayer1,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        fontSize: C.textSm,
        color: C.labelPrimary,
        maxWidth: '100%',
        boxSizing: 'border-box',
      },
      headRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      glyph: { flex: 'none', display: 'flex', color: C.business },
      title: { fontWeight: 600, lineHeight: '20px' },
      pill: {
        flex: 'none',
        marginLeft: 'auto',
        fontSize: C.textXs,
        lineHeight: '18px',
        padding: '0 8px',
        borderRadius: '999px',
        border: `0.5px solid ${C.borderL2}`,
        color: C.labelSecondary,
        whiteSpace: 'nowrap',
      },
      note: { color: C.labelSecondary, lineHeight: '19px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      stepList: { display: 'flex', flexDirection: 'column', gap: '6px' },
      stepBox: { display: 'flex', flexDirection: 'column', gap: '2px' },
      checkWarning: { fontSize: C.textXs, lineHeight: '17px', color: C.warn, paddingLeft: '2px' },
      step: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        minWidth: 0,
      },
      stepBadge: {
        flex: 'none',
        fontSize: C.textXs,
        lineHeight: '18px',
        padding: '0 6px',
        borderRadius: C.radiusSm,
        background: C.bgLayer2,
        color: C.labelSecondary,
        whiteSpace: 'nowrap',
      },
      stepDetail: {
        fontFamily: C.mono,
        color: C.labelSecondary,
        overflowWrap: 'anywhere',
        minWidth: 0,
        cursor: 'pointer',
        textDecoration: 'none',
      },
      fields: { display: 'flex', flexDirection: 'column', gap: '8px' },
      fieldRow: { display: 'flex', flexDirection: 'column', gap: '4px' },
      fieldLabel: { fontSize: C.textXs, color: C.labelSecondary, display: 'flex', gap: '6px', alignItems: 'baseline' },
      fieldHint: { color: C.labelTertiary, fontSize: C.textXs },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        height: '30px',
        padding: '0 10px',
        fontSize: C.textSm,
        color: C.labelPrimary,
        background: C.bgBase,
        border: `0.5px solid ${C.borderL2}`,
        borderRadius: C.radiusSm,
        outline: 'none',
        fontFamily: 'inherit',
      },
      actions: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      button: {
        height: '28px',
        padding: '0 14px',
        fontSize: C.textSm,
        borderRadius: '999px',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      primaryButton: { background: C.primaryFill, color: 'var(--dsw-alias-label-primary-inverted)' },
      ghostButton: { background: C.floatingFill, color: C.labelPrimary, border: `0.5px solid ${C.borderL2}` },
      linkButton: {
        background: 'transparent',
        border: 'none',
        padding: '0 4px',
        fontSize: C.textXs,
        color: C.labelTertiary,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
      },
      pre: {
        margin: 0,
        padding: '10px 12px',
        maxHeight: '260px',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        font: C.mono,
        color: C.labelSecondary,
        background: C.code,
        border: `0.5px solid ${C.borderL1}`,
        borderRadius: C.radiusLg,
      },
      outcomeList: { display: 'flex', flexDirection: 'column', gap: '4px' },
      outcome: { display: 'flex', gap: '8px', alignItems: 'baseline', fontSize: C.textXs, color: C.labelSecondary },
      outcomeMark: { flex: 'none' },
      notice: { fontSize: C.textXs, lineHeight: '18px' },
      panelRoot: {
        height: '100%',
        minHeight: 0,
        overflow: 'auto',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        background: C.bgBase,
        color: C.labelPrimary,
        boxSizing: 'border-box',
      },
      panelHead: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      panelTitle: { fontSize: '15px', fontWeight: 600, margin: 0 },
      chipRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
      chip: {
        height: '24px',
        padding: '0 10px',
        fontSize: C.textXs,
        borderRadius: '999px',
        border: `0.5px solid ${C.borderL2}`,
        background: 'transparent',
        color: C.labelSecondary,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      chipActive: { background: C.floatingFill, color: C.labelPrimary },
      empty: { color: C.labelTertiary, fontSize: C.textSm, lineHeight: '20px', padding: '8px 2px' },
    };

    /** The bolt used as this feature's glyph. */
    function BoltGlyph({ size }) {
      const dimension = typeof size === 'number' && size > 0 ? size : 14;
      return h(
        'svg',
        { width: dimension, height: dimension, viewBox: '0 0 24 24', 'aria-hidden': true, style: s.glyph },
        h('path', {
          d: 'M13.5 2.5 4.5 13.2h5.2l-1.2 8.3 9-10.7h-5.2z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    /* ------------------------------------------------------------------ *
     * The editor, shared by the card and the panel
     * ------------------------------------------------------------------ */

    /**
     * Render and apply one proposal.
     *
     * The same component serves the conversation card and the Sidebar page, so a
     * proposal behaved identically wherever it is met. It never writes to disk
     * itself: `api.apply` sends the edited proposal to the Host.
     *
     * @param props.item - the proposal model.
     * @param props.sessionId - the Session authorizing the Host call.
     * @param props.api - the callback face built in `apply`.
     * @param props.openFile - optional Host file opener, absent in the Sidebar page.
     * @param props.stored - the Host's record for this proposal, when known.
     * @param props.compact - true in the Sidebar page, which has less width.
     * @returns the editor element.
     */
    function ActionEditor({ item, sessionId, api, openFile, stored, compact }) {
      const fields = useMemo(() => collectFields(item.steps), [item.steps]);
      const [values, setValues] = useState(() => seedValues(fields, stored?.values));
      const [status, setStatus] = useState(() => (typeof stored?.status === 'string' ? stored.status : 'pending'));
      const [outcomes, setOutcomes] = useState(() => (Array.isArray(stored?.outcomes) ? stored.outcomes : []));
      const [notice, setNotice] = useState(null);
      const [showPreview, setShowPreview] = useState(false);
      const [busy, setBusy] = useState(false);
      const seeded = useRef(false);

      // The Host record arrives asynchronously, so re-seed once it lands: values
      // the user already supplied must win over the proposal's defaults.
      useEffect(() => {
        if (seeded.current || stored === null || stored === undefined) return;
        seeded.current = true;
        setValues((current) => seedValues(fields, { ...stored.values, ...current }));
        if (typeof stored.status === 'string') setStatus(stored.status);
        if (Array.isArray(stored.outcomes)) setOutcomes(stored.outcomes);
      }, [stored, fields]);

      const settled = status === 'applied' || status === 'partial' || status === 'failed' || status === 'dismissed';
      const missing = useMemo(() => missingFields(item.steps, fields, values), [item.steps, fields, values]);
      const tone = statusTone(status);

      /** Send the edited proposal to the Host. */
      const apply = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        setNotice(null);
        setStatus('applying');
        try {
          const outcome = await api.apply(sessionId, item.id, values, item.steps);
          setStatus(typeof outcome?.status === 'string' ? outcome.status : 'applied');
          setOutcomes(Array.isArray(outcome?.outcomes) ? outcome.outcomes : []);
          if (outcome?.status === 'applied') setNotice('Applied. The agent has been told.');
        } catch (error) {
          setStatus('failed');
          setNotice(`Could not apply the action: ${messageOf(error)}`);
        } finally {
          setBusy(false);
        }
      }, [busy, api, sessionId, item.id, item.steps, values]);

      /** Mark the proposal dismissed so the panel stops listing it as open. */
      const dismiss = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        setNotice(null);
        try {
          await api.dismiss(sessionId, item.id);
          setStatus('dismissed');
        } catch (error) {
          setNotice(`Could not dismiss the action: ${messageOf(error)}`);
        } finally {
          setBusy(false);
        }
      }, [busy, api, sessionId, item.id]);

      /** Reveal the proposal in the Sidebar page. */
      const openPanel = useCallback(() => {
        try {
          api.openPanel();
        } catch {
          // The Sidebar page is a convenience; the card still works without it.
        }
      }, [api]);

      const checks = item.checks ?? stored?.checks ?? {};

      const renderStep = (step, index) => {
        const detail = stepDetail(step, values);
        const canOpen = typeof openFile === 'function' && typeof step?.path === 'string' && step.kind !== 'run_command';
        const warning = checkWarning(checks[String(index)]);
        return h(
          'div',
          { key: `step-${index}`, style: s.stepBox },
          h(
            'div',
            { style: s.step },
            h('span', { style: s.stepBadge }, stepTitle(step)),
            h(
              'span',
              {
                style: canOpen ? s.stepDetail : { ...s.stepDetail, cursor: 'default' },
                title: canOpen ? `Open ${detail}` : detail,
                onClick: canOpen ? () => openFile(substitute(step.path, values)) : undefined,
              },
              detail,
            ),
          ),
          warning.length > 0 && h('div', { style: s.checkWarning }, warning),
        );
      };

      const previews = [];
      for (const step of item.steps) {
        const text = stepPreview(step, values);
        if (text.length > 0) previews.push(text);
      }
      const preview = previews.join('\n\n---\n\n').split('\n').slice(0, PREVIEW_LINES).join('\n');

      return h(
        'div',
        { style: compact === true ? { ...s.card, background: 'transparent', border: 'none', padding: 0 } : s.card },
        h(
          'div',
          { style: s.headRow },
          h(BoltGlyph, { size: 14 }),
          h('span', { style: s.title }, item.title),
          h('span', { style: { ...s.pill, color: tone.color } }, tone.label),
        ),
        item.note.length > 0 && h('div', { style: s.note }, item.note),
        item.steps.length > 0 && h('div', { style: s.stepList }, ...item.steps.map(renderStep)),
        fields.length > 0 &&
          h(
            'div',
            { style: s.fields },
            h('div', { style: s.fieldLabel }, 'Values to fill in'),
            ...fields.map((field) =>
              h(
                'label',
                { key: field.name, style: s.fieldRow },
                h(
                  'span',
                  { style: s.fieldLabel },
                  field.label,
                  field.hint.length > 0 && h('span', { style: s.fieldHint }, field.hint),
                ),
                h('input', {
                  style: s.input,
                  type: field.secret === true ? 'password' : 'text',
                  value: values[field.name] ?? '',
                  spellCheck: false,
                  autoComplete: 'off',
                  disabled: settled || busy,
                  onChange: (event) => {
                    const next = event.target.value.slice(0, MAX_FIELD_CHARS);
                    setValues((current) => ({ ...current, [field.name]: next }));
                  },
                }),
              ),
            ),
          ),
        !settled &&
          h(
            'div',
            { style: s.actions },
            h(
              'button',
              {
                type: 'button',
                style: { ...s.button, ...s.primaryButton, opacity: busy || missing.length > 0 ? 0.55 : 1 },
                disabled: busy || missing.length > 0,
                title: missing.length > 0 ? `Fill in: ${missing.join(', ')}` : 'Apply this action',
                onClick: apply,
              },
              busy ? 'Applying…' : 'Apply',
            ),
            h(
              'button',
              { type: 'button', style: { ...s.button, ...s.ghostButton, opacity: busy ? 0.55 : 1 }, disabled: busy, onClick: dismiss },
              'Dismiss',
            ),
            preview.length > 0 &&
              h(
                'button',
                { type: 'button', style: s.linkButton, onClick: () => setShowPreview((current) => !current) },
                showPreview ? 'Hide preview' : 'Preview',
              ),
            h('button', { type: 'button', style: s.linkButton, onClick: openPanel }, 'Open the Actions panel'),
          ),
        !settled && missing.length > 0 && h('div', { style: { ...s.notice, color: C.warn } }, `Still needed: ${missing.join(', ')}`),
        notice !== null && h('div', { style: { ...s.notice, color: status === 'failed' ? C.error : C.success } }, notice),
        showPreview && preview.length > 0 && h('pre', { style: s.pre }, preview),
        outcomes.length > 0 &&
          h(
            'div',
            { style: s.outcomeList },
            ...outcomes.map((outcome, index) =>
              h(
                'div',
                { key: `outcome-${index}`, style: s.outcome },
                h('span', { style: { ...s.outcomeMark, color: outcome?.ok === true ? C.success : C.error } }, outcome?.ok === true ? '✓' : '✕'),
                h('span', null, typeof outcome?.summary === 'string' ? outcome.summary : ''),
              ),
            ),
          ),
      );
    }

    /* ------------------------------------------------------------------ *
     * The conversation card
     * ------------------------------------------------------------------ */

    /**
     * The pre-arguments row. Kept a separate component type so the
     * preparing-only arguments hook is never called on a later phase.
     * @param props - the tool view props.
     * @returns the row element.
     */
    function ActionCardPreparing(props) {
      const partial = props.useToolCallArgumentsPartial();
      return h(
        'div',
        { style: { ...s.card, padding: '10px 14px' }, 'data-tool': TOOL_NAME, 'data-state': 'preparing' },
        h('div', { style: s.headRow }, h(BoltGlyph, { size: 14 }), h('span', { style: s.title }, 'Preparing an action…')),
        partial.length > 0 && h('div', { style: { ...s.note, fontFamily: C.mono, fontSize: C.textXs } }, partial.slice(0, 200)),
      );
    }

    /**
     * The interactive card, shown while the call runs and after it settles.
     * @param props - the tool view props.
     * @returns the card element.
     */
    function ActionCardStarted(props) {
      const { callId, phase, block, sessionId, openFile, api } = props;
      const args = useMemo(() => parseCall(block, phase), [block, phase]);
      const meta = phase === 'result' ? block?.meta : undefined;
      const item = useMemo(() => modelOf(callId, args, meta, phase), [callId, args, meta, phase]);
      const storePath = item.storePath;

      const [stored, setStored] = useState(null);
      const [storeError, setStoreError] = useState(null);

      // A proposal applied in an earlier Session still has to show its outcome,
      // so the settled record is fetched once on mount.
      useEffect(() => {
        if (sessionId === undefined || api === undefined) return undefined;
        let live = true;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        api
          .readItem(sessionId, storePath, item.id, controller?.signal)
          .then((record) => {
            if (live) setStored(record);
          })
          .catch((error) => {
            if (live) setStoreError(messageOf(error));
          });
        return () => {
          live = false;
          controller?.abort();
        };
      }, [api, sessionId, storePath, item.id]);

      const failed = phase === 'result' && block?.isError === true;
      const failedText = failed ? resultText(block) : '';

      // A result restored across a page boundary can arrive without its call, so
      // its own arguments are gone. The Host's record is then the only source for
      // what was proposed, and it is the same store the Sidebar page reads.
      const effective = useMemo(() => {
        if (item.steps.length > 0) return item;
        if (stored === null || !Array.isArray(stored.steps) || stored.steps.length === 0) return item;
        return {
          ...item,
          title: typeof stored.title === 'string' && stored.title.length > 0 ? stored.title : item.title,
          note: typeof stored.note === 'string' ? stored.note : item.note,
          steps: stored.steps,
          checks: stored.checks ?? item.checks,
        };
      }, [item, stored]);

      return h(
        'div',
        { 'data-tool': TOOL_NAME, 'data-state': phase },
        h(ActionEditor, { item: effective, sessionId, api, openFile, stored, compact: false }),
        failed &&
          h(
            'div',
            { style: { ...s.card, marginTop: '6px', borderColor: C.error } },
            h('div', { style: { ...s.notice, color: C.error } }, 'The proposal did not reach the Host.'),
            failedText.length > 0 && h('pre', { style: s.pre }, failedText),
          ),
        storeError !== null &&
          h('div', { style: { ...s.notice, color: C.labelTertiary, marginTop: '4px' } }, `Could not read the action store: ${storeError}`),
      );
    }

    /**
     * Keyed view for the `propose_action` wire tool.
     * @param props - the tool view props.
     * @returns the card element.
     */
    function ActionCard(props) {
      if (props.phase === 'preparing') return h(ActionCardPreparing, props);
      return h(ActionCardStarted, props);
    }

    /* ------------------------------------------------------------------ *
     * The right-Sidebar page
     * ------------------------------------------------------------------ */

    /**
     * Every proposal, newest first, with the ones still waiting on the human
     * called out first. This is where a proposal you scrolled past still lives.
     * @param props - the slot props, including the session scope.
     * @returns the page element.
     */
    function ActionsPanel(props) {
      const { sessionId, api } = props;
      const [store, setStore] = useState({ phase: 'loading', items: [], error: null });
      const [filter, setFilter] = useState('open');
      const [reloadToken, setReloadToken] = useState(0);

      useEffect(() => {
        if (sessionId === undefined || api === undefined) {
          setStore({ phase: 'ready', items: [], error: 'Open a session first.' });
          return undefined;
        }
        let live = true;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        setStore((current) => ({ ...current, phase: 'loading' }));
        api
          .list(sessionId, controller?.signal)
          .then((items) => {
            if (live) setStore({ phase: 'ready', items, error: null });
          })
          .catch((error) => {
            if (live) setStore({ phase: 'ready', items: [], error: messageOf(error) });
          });
        return () => {
          live = false;
          controller?.abort();
        };
      }, [api, sessionId, reloadToken]);

      const reload = useCallback(() => setReloadToken((token) => token + 1), []);

      const counts = useMemo(() => {
        const tally = { all: store.items.length, open: 0, applied: 0, failed: 0, dismissed: 0 };
        for (const item of store.items) {
          if (item.status === 'pending' || item.status === 'partial') tally.open += 1;
          else if (item.status === 'applied') tally.applied += 1;
          else if (item.status === 'failed') tally.failed += 1;
          else if (item.status === 'dismissed') tally.dismissed += 1;
        }
        return tally;
      }, [store.items]);

      const visible = useMemo(() => {
        if (filter === 'all') return store.items;
        if (filter === 'open') return store.items.filter((item) => item.status === 'pending' || item.status === 'partial');
        return store.items.filter((item) => item.status === filter);
      }, [store.items, filter]);

      const chips = [
        ['open', `Waiting (${counts.open})`],
        ['applied', `Applied (${counts.applied})`],
        ['failed', `Failed (${counts.failed})`],
        ['dismissed', `Dismissed (${counts.dismissed})`],
        ['all', `All (${counts.all})`],
      ];

      return h(
        'div',
        { style: s.panelRoot },
        h(
          'div',
          { style: s.panelHead },
          h(BoltGlyph, { size: 16 }),
          h('h2', { style: s.panelTitle }, 'Actions'),
          h(
            'button',
            { type: 'button', style: { ...s.chip, marginLeft: 'auto' }, onClick: reload },
            store.phase === 'loading' ? 'Loading…' : 'Refresh',
          ),
        ),
        h('div', { style: s.chipRow }, ...chips.map(([key, label]) =>
          h(
            'button',
            { key, type: 'button', style: filter === key ? { ...s.chip, ...s.chipActive } : s.chip, onClick: () => setFilter(key) },
            label,
          ),
        )),
        store.error !== null && h('div', { style: { ...s.notice, color: C.error } }, `Could not read the action store: ${store.error}`),
        store.phase === 'ready' && visible.length === 0 &&
          h('div', { style: s.empty }, store.items.length === 0
            ? 'No proposed actions yet. When the agent proposes one, it appears here and in the conversation.'
            : 'Nothing in this view.'),
        ...visible.map((item) =>
          h(
            'div',
            { key: item.id, style: { ...s.card, background: C.bgLayer1 } },
            h(ActionEditor, { item, sessionId, api, openFile: undefined, stored: item, compact: true }),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Cordis plugin
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
     * Read a service this plugin can live without.
     *
     * The card is the feature; the Sidebar page is a convenience over it, so a
     * composition that cannot provide one of these services must degrade rather
     * than take the card down with it.
     *
     * @param ctx - the Client plugin context.
     * @param name - the service name.
     * @returns the service, or null when it is absent or unreadable.
     */
    function optionalService(ctx, name) {
      try {
        const service = ctx.get(name);
        return service === undefined || service === null ? null : service;
      } catch {
        return null;
      }
    }

    /**
     * Read a whole file through the session-scoped file Remote, one page at a
     * time, until end of file.
     * @param remote - the `workspaceFiles` Remote namespace.
     * @param sessionId - the Session authorizing the read.
     * @param path - absolute file path.
     * @param signal - caller lifetime.
     * @returns the raw text.
     */
    async function readAllText(remote, sessionId, path, signal) {
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
     * Parse the Host's action store, tolerating a missing or torn file.
     * @param text - the raw store text.
     * @returns the item list, newest first.
     */
    function parseStore(text) {
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        return [];
      }
      const items = parsed !== null && typeof parsed === 'object' ? parsed.items : null;
      if (items === null || typeof items !== 'object') return [];
      const list = [];
      for (const item of Object.values(items)) {
        if (item !== null && typeof item === 'object' && typeof item.id === 'string') list.push(item);
      }
      list.sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0));
      return list;
    }

    /** Services this Client plugin needs. */
    const inject = ['slots', 'sessions', 'remote', 'remote.workspaceFiles', 'remote.commands'];

    /**
     * Resolve the Host's action store.
     *
     * The Client cannot read the Host environment, so the literal is the
     * fallback. The Host's own home is published on the remote host facts, and
     * when it is readable it reproduces the Host's `$DSH_HOME` default exactly.
     * The conversation card does not depend on this: its tool result carries the
     * resolved path. Only the Sidebar list, which has no tool result, does.
     *
     * @param ctx - the Client plugin context.
     * @returns an absolute path to `actions.json`.
     */
    function storePathOf(ctx) {
      try {
        const home = ctx.remote?.$host?.home;
        if (typeof home === 'string' && home.length > 0) return `${home}/.dsh/action-cards/actions.json`;
      } catch {
        // Host facts are optional; the literal matches the default DSH_HOME.
      }
      return DEFAULT_STORE_PATH;
    }

    /**
     * Register the tool card, the Sidebar page and their data face.
     * @param ctx - the Client plugin context.
     */
    function apply(ctx) {
      /**
       * Run one `/actions …` line against a Session and unwrap the command
       * envelope. The call never reaches the model and never enters the
       * transcript.
       * @param sessionId - the Session the command runs against.
       * @param line - the full command line.
       * @returns the command's result payload.
       */
      const runCommand = async (sessionId, line) => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('No session is open to run the command.');
        const result = await ctx.remote.commands.execute(sessionId, line, []);
        if (result?.ok !== true) {
          const error = result?.error ?? {};
          throw new Error(`${error.code ?? 'command-failed'}${typeof error.message === 'string' ? `: ${error.message}` : ''}`);
        }
        const payload = result.value?.result;
        if (payload?.kind !== 'success') throw new Error(typeof payload?.text === 'string' ? payload.text : 'The command failed.');
        return payload.text;
      };

      /** Stable identity, so React effects that depend on it do not re-run per render. */
      const api = {
        /**
         * Read the whole action store.
         * @param sessionId - the Session authorizing the read.
         * @param signal - caller lifetime.
         * @returns the item list, newest first.
         */
        list: async (sessionId, signal) => {
          const text = await readAllText(ctx.remote.workspaceFiles, sessionId, storePathOf(ctx), signal);
          return parseStore(text);
        },
        /**
         * Read one proposal's Host record.
         * @param sessionId - the Session authorizing the read.
         * @param path - the store path carried by the tool result, when known.
         * @param id - the proposal identity.
         * @param signal - caller lifetime.
         * @returns the record, or null when the store has no entry yet.
         */
        readItem: async (sessionId, path, id, signal) => {
          let text = '';
          try {
            text = await readAllText(ctx.remote.workspaceFiles, sessionId, typeof path === 'string' && path.length > 0 ? path : storePathOf(ctx), signal);
          } catch {
            return null;
          }
          const items = parseStore(text);
          return items.find((item) => item.id === id) ?? null;
        },
        /**
         * Send an edited proposal to the Host for execution.
         * @param sessionId - the Session the command runs against.
         * @param id - the proposal identity.
         * @param values - the user's field values.
         * @param steps - the steps, as the card last saw them.
         * @returns `{ status, outcomes }`.
         */
        apply: async (sessionId, id, values, steps) => {
          const payload = JSON.stringify({ values, steps });
          const text = await runCommand(sessionId, `${COMMAND_NAME} apply ${id} ${payload}`);
          try {
            return JSON.parse(text);
          } catch {
            return { status: 'applied', outcomes: [], report: text };
          }
        },
        /**
         * Mark a proposal dismissed.
         * @param sessionId - the Session the command runs against.
         * @param id - the proposal identity.
         * @returns the command's text.
         */
        dismiss: async (sessionId, id) => runCommand(sessionId, `${COMMAND_NAME} dismiss ${id}`),
        /** Reveal the Sidebar page, if this Client composed one. */
        openPanel: () => {
          const controller = optionalService(ctx, 'sidebarRight');
          if (controller === null) return;
          controller.openTab(TAB_KIND, { params: { actionId: null } });
        },
      };

      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register(
          {
            name: 'tool.call.toolview',
            key: TOOL_NAME,
            inject: () => ({ api }),
          },
          ActionCard,
        ),
      );

      // The Sidebar page is a convenience over the card, so a composition that
      // cannot take a tab type must not cost the card.
      ctx.effect(() => {
        const tabs = optionalService(ctx, 'sidebarRightTabs');
        if (tabs === null) {
          console.warn('[action-cards] no sidebarRightTabs service; the Actions panel is unavailable.');
          return () => {};
        }
        try {
          return tabs.register({
            id: TAB_ID,
            kind: TAB_KIND,
            // A page type: it recognizes no resource address, and its title is
            // captured when the tab opens. The registry supplies `kind` to every
            // guide entry itself, and sorts them by the entry's own `order`.
            title: () => 'Actions',
            guide: [
              {
                id: 'action-cards',
                order: 10,
                title: () => 'Actions',
                description: () => 'Proposed actions waiting for you, and what happened to the ones you applied.',
              },
            ],
          });
        } catch (error) {
          // A tab-type shape this build does not accept must not take the card down.
          console.warn('[action-cards] could not register the Actions tab type:', error);
          return () => {};
        }
      }, 'action-cards: Actions tab type');

      ctx.effect(
        () =>
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              {
                name: 'sidebar.right.pane.tab',
                key: TAB_ID,
                inject: () => ({ api }),
              },
              ActionsPanel,
            ),
          ),
        'action-cards: Actions panel body',
      );
    }

    return { name: 'action-cards', inject, apply };
  },
});
