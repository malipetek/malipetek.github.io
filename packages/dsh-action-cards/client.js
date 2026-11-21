/**
 * Client half of the Action cards bundle.
 *
 * Three surfaces over one idea: the agent proposes a concrete action, and the
 * human applies it.
 *
 * 1. A keyed `tool.call.toolview` for the wire tool `propose_action`. The card
 *    reads the proposal straight from the tool call's own arguments, so it
 *    renders before the Host has finished recording anything.
 * 2. A review popup over the composer (`conversation.input.overlay`), which is
 *    where a waiting action is answered. It is the one surface that survives a
 *    settled turn *and* sits where the message is about to be sent from.
 * 3. A right-Sidebar page (`ctx.sidebarRightTabs` + `sidebar.right.pane.tab`)
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
     * metadata, and this half normally rebuilds it from the Host home; the tilde
     * form is a last resort for a composition that publishes no host facts.
     */
    const DEFAULT_STORE_PATH = '~/.dsh/action-cards/actions.json';
    /**
     * Version of this bundle, mirrored by `PLUGIN_VERSION` in `index.js`.
     *
     * Announced to the Host once at mount via `/actions hello`, which writes
     * `client.json` beside the store. A browser fetches this bundle, so a stale
     * copy behaves exactly like a working one until it can be asked what version
     * it is; that file is the answer. Bump both together.
     */
    const CLIENT_VERSION = '1.2.0';
    /** Delay before the mount handshake, so a Session exists to authorize it. */
    const HANDSHAKE_DELAY_MS = 1500;
    /** The file Remote caps one text page at this many lines. */
    const PAGE_LINES = 5000;
    /** Hard stop so a pathological store cannot spin the reader. */
    const MAX_PAGES = 20;
    /** Field values are capped so one paste cannot blow up the command line. */
    const MAX_FIELD_CHARS = 20000;
    /** How much of a file's content the preview block shows. */
    const PREVIEW_LINES = 400;
    /**
     * How often the always-visible pill re-reads the store.
     *
     * The store is the only shared channel between the two halves, so a new
     * proposal cannot push to the Client. A small file read every few seconds is
     * the cheapest way to notice one, and the read is skipped entirely while the
     * last one is still in flight.
     */
    const OVERLAY_POLL_MS = 8000;
    /**
     * How often the open Actions panel re-reads the store.
     *
     * The store is a file, so nothing can push to this side: an action applied
     * here, or an agent answering a hand-back with `return_action`, stays
     * invisible until something looks again. The panel used to look exactly once,
     * which is why acting on a card left its own counts and filters stale until
     * Refresh. Faster than the popup because this is the surface being worked in,
     * and the read is one small page.
     */
    const PANEL_POLL_MS = 2500;

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
      delegated: { label: 'Sent back to the agent', color: C.business },
      returned: { label: 'Agent sent it back', color: C.warn },
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

    /**
     * Is this proposal still the human's to answer?
     *
     * `partial` failed halfway and `returned` came back with a question; both
     * still want a human, so both count as waiting. Defined once because the
     * composer popup, the panel's chips and the panel's default filter must agree:
     * a count that disagrees with the list under it reads as a lost item.
     *
     * @param item - a proposal model.
     * @returns true when the item is waiting on the human.
     */
    function isWaiting(item) {
      const status = item?.status;
      return status === 'pending' || status === 'partial' || status === 'returned';
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
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
        padding: '6px 2px',
        fontSize: C.textSm,
        color: C.labelSecondary,
      },
      rowText: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: C.labelPrimary,
      },
      rowStatus: {
        flex: 'none',
        fontSize: C.textXs,
        whiteSpace: 'nowrap',
      },
      rowAside: { flex: 'none', color: C.labelTertiary },
      rowButton: {
        flex: 'none',
        height: '22px',
        padding: '0 10px',
        fontSize: C.textXs,
        borderRadius: '999px',
        border: `0.5px solid ${C.borderL2}`,
        background: C.floatingFill,
        color: C.labelPrimary,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      // The exchange reads as a thread: the agent on the left, the human on the
      // right, the proposal itself a card above. Docked bubbles rather than a
      // second form, because "you cannot have this" and "here is how" are two
      // parties talking, not two fields being filled.
      thread: { display: 'flex', flexDirection: 'column', gap: '8px' },
      bubbleIn: { display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start', maxWidth: '88%' },
      bubbleOut: { display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end', maxWidth: '88%', alignSelf: 'flex-end' },
      bubbleWho: { fontSize: C.textXs, color: C.labelTertiary, padding: '0 4px' },
      bubbleAgent: {
        padding: '8px 11px',
        borderRadius: '12px 12px 12px 3px',
        background: C.bgLayer2,
        border: `0.5px solid ${C.borderL2}`,
        color: C.labelPrimary,
        fontSize: C.textSm,
        lineHeight: '20px',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      },
      bubbleUser: {
        padding: '8px 11px',
        borderRadius: '12px 12px 3px 12px',
        background: C.floatingFill,
        border: `0.5px solid ${C.borderL2}`,
        color: C.labelPrimary,
        fontSize: C.textSm,
        lineHeight: '20px',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      },
      bubbleAside: { marginTop: '5px', fontSize: C.textXs, lineHeight: '18px', color: C.labelTertiary },
      composer: {
        display: 'flex',
        alignItems: 'flex-end',
        gap: '8px',
        padding: '6px 6px 6px 10px',
        borderRadius: '12px',
        background: C.bgBase,
        border: `0.5px solid ${C.borderL2}`,
      },
      composerInput: {
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: '22px',
        maxHeight: '120px',
        padding: '4px 0',
        fontSize: C.textSm,
        lineHeight: '20px',
        color: C.labelPrimary,
        background: 'transparent',
        border: 'none',
        outline: 'none',
        resize: 'none',
        fontFamily: 'inherit',
      },
      composerSend: {
        flex: 'none',
        height: '26px',
        padding: '0 12px',
        fontSize: C.textXs,
        fontWeight: 600,
        borderRadius: '999px',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        background: C.primaryFill,
        color: 'var(--dsw-alias-label-primary-inverted)',
      },
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
      /**
       * The review popup, anchored over the composer.
       *
       * `conversation.input.overlay` mounts inside the composer card's
       * `overlayAnchor`, which is a zero-height absolutely-positioned line along
       * the card's top edge (`height:0; inset:0 0 auto`). A child parked at
       * `bottom: calc(100% + 8px)` therefore sits directly above the input — the
       * seat the slash menu and the command popup already use — instead of in a
       * corner of the dock row, which is what made this hard to find.
       *
       * `left`/`right` of 0 rather than a hand-computed offset: the anchor is
       * already as wide as the composer card, so the popup lines up with the input
       * at every window width and cannot drift off centre.
       */
      reviewPopup: {
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
      },
      reviewCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: C.radiusLg,
        background: C.bgLayer1,
        border: `1px solid ${C.business}`,
        boxShadow: 'var(--dsw-shadow-lv2)',
        color: C.labelPrimary,
        fontSize: C.textSm,
        maxWidth: '100%',
        boxSizing: 'border-box',
      },
      reviewHead: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
      reviewLabel: { flex: 'none', fontWeight: 600, whiteSpace: 'nowrap' },
      reviewSubject: {
        minWidth: 0,
        color: C.labelSecondary,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      reviewSpacer: { flex: '1 1 auto', minWidth: 0 },
      reviewBody: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        // A proposal taller than the room above the composer scrolls instead of
        // pushing the input off screen; the header stays put, so the way out is
        // never scrolled away.
        maxHeight: 'min(52vh, 460px)',
        overflowY: 'auto',
      },
      reviewDismiss: {
        flex: 'none',
        width: '20px',
        height: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        border: 'none',
        borderRadius: '4px',
        background: 'transparent',
        color: C.labelTertiary,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: '14px',
        lineHeight: '14px',
      },
      reviewButton: {
        flex: 'none',
        height: '24px',
        padding: '0 12px',
        fontSize: C.textXs,
        fontWeight: 600,
        borderRadius: '999px',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        background: C.primaryFill,
        color: 'var(--dsw-alias-label-primary-inverted)',
      },
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
     * @param props.inPanel - true when this editor *is* the Sidebar page's body,
     *   where the link out to that page would point at itself.
     * @returns the editor element.
     */
    function ActionEditor({ item, sessionId, api, openFile, stored, compact, inPanel, onChanged }) {
      const fields = useMemo(() => collectFields(item.steps), [item.steps]);
      const [values, setValues] = useState(() => seedValues(fields, stored?.values));
      const [status, setStatus] = useState(() => (typeof stored?.status === 'string' ? stored.status : 'pending'));
      const [outcomes, setOutcomes] = useState(() => (Array.isArray(stored?.outcomes) ? stored.outcomes : []));
      const [notice, setNotice] = useState(null);
      const [showPreview, setShowPreview] = useState(false);
      /** How the agent should proceed, required once it has sent the request back. */
      const [note, setNote] = useState(() => (typeof stored?.delegateNote === 'string' ? stored.delegateNote : ''));
      const [busy, setBusy] = useState(false);
      const seeded = useRef(false);

      // The store is the authority, and it moves without this component knowing:
      // an agent answering a hand-back with `return_action` lands there, not here.
      // Adopting its status is what turns a poll into a live panel. Skipped while
      // an action is in flight, so a read that lands mid-request cannot roll the
      // display back to the state it is about to leave.
      useEffect(() => {
        if (busy) return;
        const next = stored?.status;
        if (typeof next === 'string' && next !== status) setStatus(next);
      }, [stored, busy, status]);

      // The Host record arrives asynchronously, so re-seed once it lands: values
      // the user already supplied must win over the proposal's defaults.
      useEffect(() => {
        if (seeded.current || stored === null || stored === undefined) return;
        seeded.current = true;
        setValues((current) => seedValues(fields, { ...stored.values, ...current }));
        if (typeof stored.status === 'string') setStatus(stored.status);
        if (Array.isArray(stored.outcomes)) setOutcomes(stored.outcomes);
      }, [stored, fields]);

      // `returned` is not settled: the agent answered, and the ball is back with
      // the human, so the form has to stay usable.
      const settled = status === 'applied' || status === 'partial' || status === 'failed' || status === 'dismissed' || status === 'delegated';
      const returnReason = typeof (stored?.returnReason ?? item.returnReason) === 'string' ? (stored?.returnReason ?? item.returnReason) : '';
      const needsHow = status === 'returned' && returnReason.length > 0;
      const howMissing = needsHow && note.trim().length === 0;
      const returnNeeds = stored?.returnNeeds ?? item.returnNeeds;
      /** What you said last time, so the thread shows both sides. */
      const priorNote = typeof (stored?.delegateNote ?? item.delegateNote) === 'string' ? (stored?.delegateNote ?? item.delegateNote) : '';
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
          setShowPreview(false);
          onChanged?.();
        } catch (error) {
          setStatus('failed');
          setNotice(`Could not apply the action: ${messageOf(error)}`);
        } finally {
          setBusy(false);
        }
      }, [busy, api, sessionId, item.id, item.steps, values, onChanged]);

      /** Mark the proposal dismissed so the panel stops listing it as open. */
      const dismiss = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        setNotice(null);
        try {
          await api.dismiss(sessionId, item.id);
          setStatus('dismissed');
          onChanged?.();
        } catch (error) {
          setNotice(`Could not dismiss the action: ${messageOf(error)}`);
        } finally {
          setBusy(false);
        }
      }, [busy, api, sessionId, item.id, onChanged]);

      /** Hand the work back to the agent, which is the honest answer to a job it could have done itself. */
      const handBack = useCallback(async () => {
        if (busy) return;
        if (howMissing) {
          setNotice('Say how it should proceed first — the agent asked a question.');
          return;
        }
        setBusy(true);
        setNotice(null);
        try {
          await api.delegate(sessionId, item.id, note.trim());
          setStatus('delegated');
          setNotice('Sent back. The agent will carry it out itself.');
          onChanged?.();
        } catch (error) {
          setNotice(`Could not hand the action back: ${messageOf(error)}`);
        } finally {
          setBusy(false);
        }
      }, [busy, api, sessionId, item.id, note, howMissing, onChanged]);

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
        // The exchange, as a thread rather than as a second form. The agent's
        // reason and the human's answer are messages between two parties, so they
        // read as messages: a bubble per side, oldest first. The proposal above
        // stays a card, because it is an artifact rather than a turn.
        (needsHow || priorNote.length > 0) &&
          h(
            'div',
            { style: s.thread },
            needsHow &&
              h(
                'div',
                { style: s.bubbleIn },
                h('div', { style: s.bubbleWho }, 'Agent'),
                h(
                  'div',
                  { style: s.bubbleAgent },
                  returnReason,
                  typeof returnNeeds === 'string' && returnNeeds.length > 0
                    && h('div', { style: s.bubbleAside }, `It would need: ${returnNeeds}`),
                ),
              ),
            priorNote.length > 0 &&
              h(
                'div',
                { style: s.bubbleOut },
                h('div', { style: { ...s.bubbleWho, textAlign: 'right' } }, 'You'),
                h('div', { style: s.bubbleUser }, priorNote),
              ),
          ),
        // The reply box. The send button is **You do it**, because that is what
        // sending actually does: it hands the job back, with whatever you typed as
        // the answer. Apply is a chip below, since it is a different intent — do
        // it here, rather than ask the agent to.
        !settled &&
          h(
            'div',
            { style: s.composer },
            h('textarea', {
              style: s.composerInput,
              rows: 1,
              value: note,
              spellCheck: false,
              placeholder: howMissing ? 'Tell it how to proceed…' : 'Add a note for the agent (optional)…',
              onChange: (event) => setNote(String(event.target.value).slice(0, MAX_FIELD_CHARS)),
            }),
            h(
              'button',
              {
                type: 'button',
                style: { ...s.composerSend, opacity: busy || howMissing ? 0.55 : 1 },
                disabled: busy || howMissing,
                title: howMissing
                  ? 'Answer the agent\'s question first'
                  : 'Hand this back to the agent to carry out itself',
                onClick: handBack,
              },
              busy ? '…' : 'You do it',
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
                title: missing.length > 0 ? `Fill in: ${missing.join(', ')}` : 'Do this myself, here and now',
                onClick: apply,
              },
              busy ? 'Applying…' : 'Do it here',
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
            // Only where there is somewhere else to go. Inside the Sidebar page
            // this linked to the page it was already drawn in, so pressing it did
            // nothing at all — the control has to be absent, not inert.
            !inPanel && h('button', { type: 'button', style: s.linkButton, onClick: openPanel }, 'Open the Actions panel'),
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
     * The conversation row
     * ------------------------------------------------------------------ */

    /**
     * The one-line trace a proposal leaves in the transcript.
     *
     * Deliberately **not** a form. A form here was the nicer idea and the worse
     * experience: a tool call is a step, and the transcript folds a completed
     * turn's steps into one collapsed process group, so the form appeared while
     * the agent was working and folded away the moment it stopped — often while
     * the human was halfway through filling it in. That reads as a layout shift
     * around a control you were using, which is worse than not offering it.
     *
     * So the row states what was proposed and offers the one thing that stays
     * true once the turn settles: a way into the Actions panel, which holds the
     * same editable form and is not part of the turn.
     *
     * @param props - the tool view props.
     * @returns the row element.
     */
    function ActionRow(props) {
      // The preparing phase calls a hook no other phase does, and is kept a
      // separate component type so hook order never has to survive the change.
      if (props.phase === 'preparing') return h(ActionRowPreparing, props);
      return h(ActionRowSettled, props);
    }

    /**
     * The row before its arguments have finished streaming.
     * @param props - the tool view props.
     * @returns the row element.
     */
    function ActionRowPreparing(props) {
      const partial = props.useToolCallArgumentsPartial();
      return h(
        'div',
        { style: s.row, 'data-tool': TOOL_NAME, 'data-state': 'preparing' },
        h(BoltGlyph, { size: 13 }),
        h('span', { style: s.rowText }, 'Preparing an action…'),
        partial.length > 0 && h('span', { style: s.rowAside }, '…'),
      );
    }

    /**
     * The settled trace: what was proposed, and the way to act on it.
     * @param props - the tool view props.
     * @returns the row element.
     */
    function ActionRowSettled(props) {
      const { callId, phase, block, sessionId, api } = props;
      const args = useMemo(() => parseCall(block, phase), [block, phase]);
      const meta = phase === 'result' ? block?.meta : undefined;
      const item = useMemo(() => modelOf(callId, args, meta, phase), [callId, args, meta, phase]);

      const [stored, setStored] = useState(null);
      useEffect(() => {
        if (sessionId === undefined || api === undefined) return undefined;
        let live = true;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        api
          .readItem(sessionId, item.storePath, item.id, controller?.signal)
          .then((record) => {
            if (live) setStored(record);
          })
          .catch(() => {
            // The row still reads; it just cannot report a status.
          });
        return () => {
          live = false;
          controller?.abort();
        };
      }, [api, sessionId, item.storePath, item.id]);

      const status = typeof stored?.status === 'string' ? stored.status : 'pending';
      const tone = statusTone(status);
      const label = typeof stored?.title === 'string' && stored.title.length > 0 ? stored.title : item.title;
      const failed = phase === 'result' && block?.isError === true;

      return h(
        'div',
        { style: s.row, 'data-tool': TOOL_NAME, 'data-state': failed ? 'error' : status },
        h(BoltGlyph, { size: 13 }),
        h('span', { style: s.rowText, title: label }, label),
        h('span', { style: { ...s.rowStatus, color: tone.color } }, tone.label),
        h(
          'button',
          {
            type: 'button',
            style: s.rowButton,
            onClick: () => {
              try {
                api?.openPanel();
              } catch {
                // The panel is a convenience; nothing else depends on it.
              }
            },
          },
          'Open',
        ),
      );
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
      /**
       * Proposals acted on since the filter last changed.
       *
       * The default view is "Waiting", so an action that succeeds leaves it at
       * once — the card would vanish the instant it was answered, taking its own
       * outcome with it. Acting on something is exactly when you want to see what
       * happened, so the answered card stays until you move to another view.
       */
      const [pinned, setPinned] = useState([]);

      useEffect(() => {
        if (sessionId === undefined || api === undefined) {
          setStore({ phase: 'ready', items: [], error: 'Open a session first.' });
          return undefined;
        }
        let live = true;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        // Only the first load announces itself; a poll every few seconds must not
        // blink the list back to "Loading…".
        setStore((current) => (current.items.length === 0 ? { ...current, phase: 'loading' } : current));
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

      // The panel is the surface in use, so it watches the store for as long as it
      // is open rather than waiting to be asked.
      useEffect(() => {
        const handle = setInterval(reload, PANEL_POLL_MS);
        return () => clearInterval(handle);
      }, [reload]);

      const counts = useMemo(() => {
        const tally = { all: store.items.length, open: 0, applied: 0, failed: 0, delegated: 0, dismissed: 0 };
        for (const item of store.items) {
          if (isWaiting(item)) tally.open += 1;
          else if (item.status === 'applied') tally.applied += 1;
          else if (item.status === 'failed') tally.failed += 1;
          else if (item.status === 'delegated') tally.delegated += 1;
          else if (item.status === 'dismissed') tally.dismissed += 1;
        }
        return tally;
      }, [store.items]);

      const visible = useMemo(() => {
        const matches = (item) => {
          if (filter === 'all') return true;
          if (filter === 'open') return isWaiting(item);
          return item.status === filter;
        };
        // Store order is preserved, so a pinned card stays where it was rather
        // than jumping to the top.
        return store.items.filter((item) => matches(item) || pinned.includes(item.id));
      }, [store.items, filter, pinned]);

      const chips = [
        ['open', `Waiting (${counts.open})`],
        ['applied', `Applied (${counts.applied})`],
        ['failed', `Failed (${counts.failed})`],
        ['delegated', `Handed back (${counts.delegated})`],
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
            { key, type: 'button', style: filter === key ? { ...s.chip, ...s.chipActive } : s.chip, onClick: () => { setPinned([]); setFilter(key); } },
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
            h(ActionEditor, {
              item,
              sessionId,
              api,
              openFile: undefined,
              stored: item,
              compact: true,
              inPanel: true,
              onChanged: () => {
                setPinned((current) => (current.includes(item.id) ? current : [...current, item.id]));
                reload();
              },
            }),
          ),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * The review popup over the composer
     * ------------------------------------------------------------------ */

    /**
     * The review card that appears over the composer while an action waits.
     *
     * The conversation card is the place to act, but it does not survive a
     * settled turn on its own: the transcript folds a completed turn's steps into
     * one collapsed process group (`stepGrouping: 'history'` under the
     * `transcriptView: detailed` mode), which hides the card until the group is
     * expanded. That is the transcript's design, and a plugin should not fight it
     * — so this is what keeps a pending action reachable.
     *
     * It registers into `conversation.input.overlay`, the seat the slash menu and
     * the command popup use, because that is the one place a plugin can draw at
     * the composer without guessing at an offset: the slot mounts inside the
     * composer card's `overlayAnchor`, so the popup lands immediately above the
     * input and lines up with it. The earlier attempt lived in the
     * `conversation.composer.dock` row beside the stats pills. It was reachable
     * and it was in the wrong place — a message about an action reads as part of
     * the composer, and in the dock row it read as a chip off to one side.
     *
     * Collapsed it is one line: how many are waiting, what the first one is, and
     * **Review**. Review expands the same `ActionEditor` the Sidebar page uses, in
     * place, so the form is answered where the notice was — and the link out to
     * the panel stays available for the settled ones this popup does not list.
     *
     * @param props - the slot props.
     * @param props.api - the callback face built in `apply`.
     * @param props.sessionId - the Session this composer belongs to.
     * @returns the popup, or null when nothing is waiting.
     */
    function ActionsReviewPopup({ api, sessionId }) {
      const [waiting, setWaiting] = useState(null);
      /** Whether the human has opened the form, rather than only seen the notice. */
      const [expanded, setExpanded] = useState(false);
      /**
       * The count the human dismissed, if any.
       *
       * Dismissal hides the notice for *this* state rather than for good: a
       * notice you can never get back is one you stop using, and a new proposal
       * (or an agent sending one back) changes the count, which brings it back.
       */
      const [dismissedAt, setDismissedAt] = useState(null);
      /** Bumped by an action inside the popup, so its own result shows at once. */
      const [reloadToken, setReloadToken] = useState(0);
      const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

      useEffect(() => {
        let live = true;
        let busy = false;
        const tick = async () => {
          if (busy) return;
          busy = true;
          try {
            const open = await api.pendingItems(sessionId);
            if (live) setWaiting(open);
          } catch {
            // A poll that cannot read the store says nothing about the next one.
          } finally {
            busy = false;
          }
        };
        void tick();
        const handle = setInterval(tick, OVERLAY_POLL_MS);
        return () => {
          live = false;
          clearInterval(handle);
        };
      }, [api, sessionId, reloadToken]);

      const open = Array.isArray(waiting) ? waiting : [];
      if (open.length === 0) return null;
      if (dismissedAt === open.length) return null;

      const subject = typeof open[0]?.title === 'string' && open[0].title.length > 0 ? open[0].title : 'the agent proposed an action';

      return h(
        'div',
        { style: s.reviewPopup },
        h(
          'div',
          { style: s.reviewCard, role: 'status' },
          h(
            'div',
            { style: s.reviewHead },
            h(BoltGlyph, { size: 14 }),
            h('span', { style: s.reviewLabel }, open.length === 1 ? '1 action is waiting for you' : `${open.length} actions are waiting for you`),
            h('span', { style: s.reviewSubject, title: subject }, subject),
            h('span', { style: s.reviewSpacer }),
            h(
              'button',
              {
                type: 'button',
                style: s.reviewButton,
                'aria-expanded': expanded,
                onClick: () => setExpanded((current) => !current),
              },
              expanded ? 'Hide' : 'Review',
            ),
            h(
              'button',
              {
                type: 'button',
                style: s.reviewDismiss,
                'aria-label': 'Hide until the next proposal',
                title: 'Hide until the next proposal',
                onClick: () => {
                  setExpanded(false);
                  setDismissedAt(open.length);
                },
              },
              '×',
            ),
          ),
          expanded &&
            h(
              'div',
              { style: s.reviewBody },
              // Every waiting proposal, so a second one is not hidden behind a
              // control the human has to find. `inPanel` is false: from here the
              // Sidebar page is somewhere else to go, which is exactly what the
              // link is for.
              ...open.map((item) =>
                h(ActionEditor, { key: item.id, item, sessionId, api, openFile: undefined, stored: item, inPanel: false, onChanged: refresh }),
              ),
            ),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Cordis plugin
     * ------------------------------------------------------------------ */

    /**
     * Build a `/actions …` line.
     *
     * The leading slash is not decoration: `dsh-commands` recognizes an
     * invocation with `/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u`, so a line
     * without it is not a command at all — it parses to nothing and the call
     * silently does nothing. Every line this side sends goes through here so the
     * slash cannot be forgotten again.
     *
     * @param rest - the subcommand and its arguments.
     * @returns the complete command line.
     */
    function commandLine(rest) {
      return `/${COMMAND_NAME} ${rest}`;
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
      /** Set once, so a failing store read is reported a single time rather than every poll. */
      let warnedAboutRead = false;

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
         * The proposals still waiting on the human, newest first.
         *
         * The composer slot is session-scoped, so it hands over the Session that
         * authorizes the read. The fallback matters for a caller that has none:
         * it tries the Sessions the shell reports, so one unreadable Session does
         * not blind the popup.
         *
         * @param sessionId - the Session to read against, when the caller knows it.
         * @returns the waiting items, or an empty list when nothing can be read.
         */
        pendingItems: async (sessionId) => {
          const candidates = [];
          if (typeof sessionId === 'string' && sessionId.length > 0) candidates.push(sessionId);
          const snapshot = ctx.sessions?.list?.getSnapshot();
          if (Array.isArray(snapshot?.ids)) candidates.push(...snapshot.ids.slice(0, 4));
          for (const id of candidates) {
            try {
              const items = await api.list(id, undefined);
              return items.filter(isWaiting);
            } catch (error) {
              // Try the next candidate. The first failure is worth one line: a
              // popup that never appears is otherwise indistinguishable from a
              // store with nothing pending in it.
              if (!warnedAboutRead) {
                warnedAboutRead = true;
                console.warn('[action-cards] could not read the action store for the composer review popup:', messageOf(error));
              }
            }
          }
          return [];
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
          const text = await runCommand(sessionId, commandLine(`apply ${id} ${payload}`));
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
        dismiss: async (sessionId, id) => runCommand(sessionId, commandLine(`dismiss ${id}`)),
        /**
         * Hand a proposal back to the agent to carry out itself.
         * @param sessionId - the Session the command runs against.
         * @param id - the proposal identity.
         * @returns the command's text.
         */
        /**
         * Hand a proposal back to the agent, optionally saying how to proceed.
         * @param sessionId - the Session the command runs against.
         * @param id - the proposal identity.
         * @param note - how the agent should proceed, required after it asked.
         * @returns the command's text.
         */
        delegate: async (sessionId, id, note) => runCommand(sessionId, commandLine(`delegate ${id} ${JSON.stringify({ note: typeof note === 'string' ? note : '' })}`)),
        /** Reveal the Sidebar page, if this Client composed one. */
        openPanel: () => {
          const controller = optionalService(ctx, 'sidebarRight');
          if (controller === null) return;
          controller.openTab(TAB_KIND, { params: { actionId: null } });
        },
      };

      // Registration order is defensive, most-load-bearing first: a throw from
      // anything below must not cost the surfaces above it. The card is the
      // feature; the review popup over the composer and the panel are what make a
      // proposal reachable after the transcript folds a finished turn.
      // A one-line trace, not a form: a tool call folds with its turn, so a form
      // here would vanish mid-edit. See `ActionRow`.
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register(
          {
            name: 'tool.call.toolview',
            key: TOOL_NAME,
            inject: () => ({ api }),
          },
          ActionRow,
        ),
      );

      // Over the composer, outside the transcript, so it survives the fold a
      // settled turn applies to every step inside it. `conversation.input.overlay`
      // is the composer's own anchor for anything that belongs above the input —
      // the slash menu and the command popup already sit in it — so the popup
      // lands directly over the composer instead of in a corner of the dock row.
      // `order` is negative so those two paint over it: while one of them is open
      // it is the thing being read, and this must not cover it.
      ctx.slots.inject('conversation.input.overlay', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.overlay',
            id: 'action-cards-review',
            order: -10,
            inject: () => ({ api }),
          },
          ActionsReviewPopup,
        ),
      );

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

      // The Sidebar page needs a tab type as well as a body, and the registry is
      // provided inside another plugin's effect. `ctx.inject` waits for it rather
      // than reading it once, so the panel cannot be lost to an activation-order
      // race. Last, and guarded, because it is the only registration that can
      // defer.
      try {
        ctx.inject(['sidebarRightTabs'], (tabsCtx) => {
          tabsCtx.effect(() => {
            try {
              return tabsCtx.sidebarRightTabs.register({
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
        });
      } catch (error) {
        console.warn('[action-cards] could not reach the Sidebar tab registry:', error);
      }

      // Announce this bundle to the Host once, so `client.json` can prove which
      // Client version is actually loaded. Best effort, and it spends no model
      // turn: it is a Cordis command like every other write from this side.
      ctx.effect(() => {
        const handle = setTimeout(() => {
          const snapshot = ctx.sessions?.list?.getSnapshot();
          const sessionId = Array.isArray(snapshot?.ids) ? snapshot.ids[0] : undefined;
          if (typeof sessionId !== 'string' || sessionId.length === 0) return;
          void runCommand(sessionId, commandLine(`hello ${CLIENT_VERSION}`)).catch(() => {
            // A handshake that cannot land says nothing about the card or the pill.
          });
        }, HANDSHAKE_DELAY_MS);
        if (typeof handle?.unref === 'function') handle.unref();
        return () => clearTimeout(handle);
      }, 'action-cards: mount handshake');
    }

    return { name: 'action-cards', inject, apply };
  },
});
