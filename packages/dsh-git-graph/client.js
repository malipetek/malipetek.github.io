/**
 * Git panel — the Client half of `@malipetek/dsh-git-graph`.
 *
 * A right-Sidebar page type with three views over one repository: the working
 * tree with staging and committing, the commit graph, and branches with the
 * remote operations. Everything it knows comes from the Host's authenticated
 * `/api/git-graph.*` read routes; every change it makes goes through the
 * `/git-graph` session command, because a mutation is the Host's to authorize
 * and the transcript should show it.
 *
 * The panel polls only what the visible view needs: the status route every few
 * seconds on Changes, branches every five, and history every eight. Polling
 * stops when the page type is not the visible tab.
 *
 * @module @malipetek/dsh-git-graph/client
 */
window.__ModuleLoader__.load({
  id: '@malipetek/dsh-git-graph',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } = React;

    /** This client half's package name; also the sidebar tab type's registry id and seat key. */
    const TAB_ID = '@malipetek/dsh-git-graph';
    /** The tab `kind` a page is opened by. */
    const TAB_KIND = 'git-graph';
    /** This plugin's locale namespace. */
    const NS = 'gitGraph';
    /** The Host command mutations go through. */
    const COMMAND = 'git-graph';

    /** Document-relative read routes; see the Host half for the same literals. */
    const ROUTE_STATE = 'api/git-graph.state';
    const ROUTE_DIFF = 'api/git-graph.diff';
    const ROUTE_COMMIT = 'api/git-graph.commit';
    const ROUTE_AGENT = 'api/git-graph.agent';

    /** How often each view refreshes, in milliseconds. */
    const POLL_STATUS_MS = 3000;
    const POLL_BRANCHES_MS = 5000;
    const POLL_HISTORY_MS = 8000;

    /** Lane colours for the commit graph; artwork, so they carry their own values. */
    const LANE_COLORS = ['#4176e6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6'];
    /** Pixels per lane and per row in the graph cell. */
    const LANE_WIDTH = 10;
    const ROW_HEIGHT = 24;

    /* ------------------------------------------------------------------ *
     * Copy
     * ------------------------------------------------------------------ */

    const en = {
      'guide.title': 'Source control',
      'guide.description': 'Changes, commits, branches, and push',
      'shortcut.noSession': 'Select a session first',
      'title.fallback': 'Git',
      'view.changes': 'Changes',
      'view.history': 'History',
      'view.branches': 'Branches',
      'action.refresh': 'Refresh',
      'action.fetch': 'Fetch',
      'action.pull': 'Pull',
      'action.push': 'Push',
      'action.stage': 'Stage',
      'action.unstage': 'Unstage',
      'action.discard': 'Discard changes',
      'action.stageAll': 'Stage all',
      'action.unstageAll': 'Unstage all',
      'action.commit': 'Commit',
      'action.commitPush': 'Commit and push',
      'action.back': 'Back',
      'action.switch': 'Switch to this branch',
      'action.deleteBranch': 'Delete branch',
      'action.init': 'Initialise repository',
      'action.cancel': 'Cancel',
      'action.confirmDelete': 'Delete',
      'action.createBranch': 'Create',
      'label.noRepo': 'This workspace is not a git repository.',
      'label.noChanges': 'No changes. The working tree is clean.',
      'label.staged': 'Staged',
      'label.unstaged': 'Changes',
      'label.untracked': 'Untracked',
      'label.conflicted': 'Conflicted',
      'label.loading': 'Loading…',
      'label.detached': 'detached',
      'label.ahead': '{n} ahead',
      'label.behind': '{n} behind',
      'label.noUpstream': 'no upstream',
      'label.commitMessage': 'Commit message',
      'label.allTracked': 'include tracked changes',
      'label.amend': 'amend',
      'label.newBranch': 'New branch name',
      'label.local': 'Local',
      'label.remote': 'Remotes',
      'label.noRemotes': 'No remotes.',
      'label.files': '{n} files',
      'label.agentTurn': 'The agent changed {n} files last turn',
      'label.truncated': 'output was cut short by the shell output cap',
      'error.state': 'Could not read the repository: {message}',
      'error.action': 'The git command failed: {message}',
      'confirm.discardFile': 'Discard the changes in “{name}”? This cannot be undone.',
      'confirm.deleteBranch': 'Delete the branch “{name}”?',
    };

    const zh = {
      'guide.title': '源代码管理',
      'guide.description': '更改、提交、分支和推送',
      'shortcut.noSession': '请先选择一个会话',
      'title.fallback': 'Git',
      'view.changes': '更改',
      'view.history': '历史',
      'view.branches': '分支',
      'action.refresh': '刷新',
      'action.fetch': '获取',
      'action.pull': '拉取',
      'action.push': '推送',
      'action.stage': '暂存',
      'action.unstage': '取消暂存',
      'action.discard': '放弃更改',
      'action.stageAll': '全部暂存',
      'action.unstageAll': '全部取消暂存',
      'action.commit': '提交',
      'action.commitPush': '提交并推送',
      'action.back': '返回',
      'action.switch': '切换到此分支',
      'action.deleteBranch': '删除分支',
      'action.init': '初始化仓库',
      'action.cancel': '取消',
      'action.confirmDelete': '删除',
      'action.createBranch': '创建',
      'label.noRepo': '此工作区不是 git 仓库。',
      'label.noChanges': '没有更改，工作区是干净的。',
      'label.staged': '已暂存',
      'label.unstaged': '更改',
      'label.untracked': '未跟踪',
      'label.conflicted': '冲突',
      'label.loading': '加载中…',
      'label.detached': '游离',
      'label.ahead': '领先 {n}',
      'label.behind': '落后 {n}',
      'label.noUpstream': '无上游',
      'label.commitMessage': '提交信息',
      'label.allTracked': '包含已跟踪的更改',
      'label.amend': '修补',
      'label.newBranch': '新分支名称',
      'label.local': '本地',
      'label.remote': '远程',
      'label.noRemotes': '没有远程仓库。',
      'label.files': '{n} 个文件',
      'label.agentTurn': '上一轮代理改动了 {n} 个文件',
      'label.truncated': '输出已被 shell 输出上限截断',
      'error.state': '无法读取仓库：{message}',
      'error.action': 'git 命令失败：{message}',
      'confirm.discardFile': '放弃“{name}”中的更改？此操作无法撤销。',
      'confirm.deleteBranch': '删除分支“{name}”？',
    };

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    /**
     * All values are theme tokens with light-theme fallbacks, so the panel
     * follows light/dark switching and survives a renamed token.
     */
    const CSS = `
.dgg-root{display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#0f1115);background:var(--dsw-alias-bg-base,#fff)}
.dgg-root *,.dgg-root *::before,.dgg-root *::after{box-sizing:border-box}
.dgg-head{display:flex;align-items:center;gap:4px;flex:0 0 auto;padding:4px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a)}
.dgg-branch{display:inline-flex;align-items:center;gap:4px;min-width:0;flex:1 1 auto;height:24px;padding:0 8px;border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-button-ghost-active-fill,#ebeef2);color:var(--dsw-alias-label-primary,#0f1115);font-size:12px}
.dgg-branch-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dgg-track{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c)}
.dgg-icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:none;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer;flex:0 0 auto}
.dgg-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.dgg-icon:disabled{opacity:.4;cursor:default}
.dgg-icon.dgg-danger{color:var(--dsw-alias-state-error-primary,#ec1313)}
.dgg-icon.dgg-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,#ec13130d)}
.dgg-icon:focus-visible,.dgg-btn:focus-visible,.dgg-tab:focus-visible,.dgg-row:focus-visible,.dgg-input:focus-visible,.dgg-textarea:focus-visible,.dgg-mini:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:-1px}
.dgg-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm,8px);background:none;color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:12px;cursor:pointer;flex:0 0 auto}
.dgg-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.dgg-btn.dgg-primary{background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}
.dgg-btn.dgg-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#333)}
.dgg-btn:disabled{opacity:.4;cursor:default}
.dgg-tabs{display:flex;gap:2px;flex:0 0 auto;padding:4px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a)}
.dgg-tab{flex:1 1 0;height:26px;padding:0 6px;border:0;border-radius:var(--dsw-radius-sm,8px);background:none;color:var(--dsw-alias-label-secondary,#61666b);font:inherit;font-size:12px;cursor:pointer}
.dgg-tab:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.dgg-tab[aria-selected="true"]{background:var(--dsw-alias-button-ghost-active-fill,#ebeef2);color:var(--dsw-alias-label-primary,#0f1115);font-weight:600}
.dgg-body{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-gutter:stable}
.dgg-section{display:flex;flex-direction:column}
.dgg-section-head{display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#81858c);background:var(--dsw-alias-bg-layer-2,#fff);border-bottom:.5px solid var(--dsw-alias-border-l1,#0000000a)}
.dgg-section-title{flex:1 1 auto;min-width:0}
.dgg-row{display:flex;align-items:center;gap:6px;width:100%;padding:2px 6px 2px 10px;border:0;border-radius:var(--dsw-radius-sm,8px);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dgg-row:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.dgg-status{flex:0 0 auto;width:14px;text-align:center;font-family:var(--ds-font-family-code,monospace);font-size:11px;font-weight:700}
.dgg-status.dgg-added{color:var(--dsw-alias-state-success-primary,#22c55e)}
.dgg-status.dgg-modified{color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dgg-status.dgg-deleted{color:var(--dsw-alias-state-error-primary,#ec1313)}
.dgg-path{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,monospace);font-size:11.5px}
.dgg-path-dir{color:var(--dsw-alias-label-tertiary,#81858c)}
.dgg-row-actions{display:none;align-items:center;gap:0;flex:0 0 auto}
.dgg-row:hover .dgg-row-actions,.dgg-row:focus-within .dgg-row-actions{display:inline-flex}
.dgg-mini{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);background:none;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}
.dgg-mini:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.dgg-mini.dgg-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,#ec13130d);color:var(--dsw-alias-state-error-primary,#ec1313)}
.dgg-commit-box{display:flex;flex-direction:column;gap:6px;padding:8px;border-top:.5px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-1,#fff)}
.dgg-textarea{width:100%;min-height:54px;max-height:140px;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l4,#00000029);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:12px;resize:vertical}
.dgg-textarea::placeholder{color:var(--dsw-alias-label-dimmed,#9aa0aa)}
.dgg-input{flex:1 1 auto;min-width:0;height:26px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4,#00000029);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:12px}
.dgg-input::placeholder{color:var(--dsw-alias-label-dimmed,#9aa0aa)}
.dgg-input:focus-visible,.dgg-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#4176e6)}
.dgg-box-row{display:flex;align-items:center;gap:6px}
.dgg-check{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer}
.dgg-note{padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c)}
.dgg-note.dgg-error{color:var(--dsw-alias-state-error-primary,#ec1313)}
.dgg-notice{flex:0 0 auto;padding:6px 10px;font-size:12px;border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a);color:var(--dsw-alias-label-secondary,#61666b);background:var(--dsw-alias-bg-layer-2,#fff);word-break:break-word}
.dgg-notice.dgg-error{color:var(--dsw-alias-state-error-primary,#ec1313);background:var(--dsw-alias-interactive-bg-hover-danger,#ec13130d)}
.dgg-diff{flex:1 1 auto;min-height:0;overflow:auto;margin:0;padding:8px 10px;background:var(--dsw-alias-bg-layer-1,#fff);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px;line-height:18px;white-space:pre;tab-size:2}
.dgg-diff-line{display:block;white-space:pre}
.dgg-diff-add{color:var(--dsw-alias-state-success-primary,#22c55e)}
.dgg-diff-del{color:var(--dsw-alias-state-error-primary,#ec1313)}
.dgg-diff-hunk{color:var(--dsw-alias-state-business-primary,#4176e6)}
.dgg-diff-meta{color:var(--dsw-alias-label-tertiary,#81858c)}
.dgg-commit{display:flex;align-items:flex-start;gap:6px;width:100%;padding:3px 8px 3px 4px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:var(--dsw-radius-sm,8px)}
.dgg-commit:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.dgg-graph{flex:0 0 auto;height:${ROW_HEIGHT}px}
.dgg-commit-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px;padding-top:1px}
.dgg-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.dgg-meta{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c);overflow:hidden;white-space:nowrap}
.dgg-ref{display:inline-flex;align-items:center;height:15px;padding:0 5px;border-radius:999px;font-size:10px;background:var(--dsw-alias-state-business-primary,#4176e6);color:#fff}
.dgg-ref.dgg-head{background:var(--dsw-alias-state-success-primary,#22c55e)}
.dgg-ref.dgg-tag{background:var(--dsw-alias-label-tertiary,#81858c)}
.dgg-detail{display:flex;flex-direction:column;gap:6px;padding:8px}
.dgg-detail-head{display:flex;align-items:center;gap:6px}
.dgg-detail-title{flex:1 1 auto;min-width:0;font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dgg-kv{font-size:11.5px;color:var(--dsw-alias-label-secondary,#61666b);word-break:break-word}
.dgg-title{display:inline-flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dgg-agent{display:flex;flex-direction:column;border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-2,#fff)}
.dgg-agent-head{display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#61666b)}
.dgg-agent-count{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dgg-plus{color:var(--dsw-alias-state-success-primary,#22c55e)}
.dgg-minus{color:var(--dsw-alias-state-error-primary,#ec1313)}
`;

    /**
     * Append this plugin's stylesheet once, tagged so a second activation cannot
     * duplicate it and so teardown removes exactly this element.
     * @returns a disposer that removes the element.
     */
    function installStyles() {
      const tagId = `${TAB_ID}/styles`;
      const selector = `style[data-plugin-css="${tagId}"]`;
      if (document.querySelector(selector) === null) {
        const tag = document.createElement('style');
        tag.dataset.plugin = 'git-graph';
        tag.dataset.pluginCss = tagId;
        tag.textContent = CSS;
        document.head.appendChild(tag);
      }
      return () => {
        document.querySelector(selector)?.remove();
      };
    }

    /* ------------------------------------------------------------------ *
     * Icons
     * ------------------------------------------------------------------ */

    /** Every glyph this panel draws, as 16×16 path data. */
    const GLYPHS = {
      branch: ['M5 4.5v11', 'M11 4.5v3a2.5 2.5 0 0 1-2.5 2.5H5'],
      refresh: ['M13.5 8a5.5 5.5 0 1 1-1.7-3.97', 'M13.5 2v3.2h-3.2'],
      download: ['M8 2.5v7', 'M4.8 6.6L8 9.8l3.2-3.2', 'M2.8 12.5h10.4'],
      upload: ['M8 10.5v-7', 'M4.8 6.6L8 3.4l3.2 3.2', 'M2.8 12.5h10.4'],
      plus: ['M8 3v10', 'M3 8h10'],
      minus: ['M3 8h10'],
      check: ['M3 8.5l3.5 3.5L13 5'],
      x: ['M4 4l8 8', 'M12 4l-8 8'],
      trash: ['M2.5 4.5h11', 'M6 4.5V2.5h4v2', 'M4 4.5l.8 9.5h6.4l.8-9.5'],
      undo: ['M4.5 6.5h6a3 3 0 0 1 0 6H7', 'M6.8 4.2L4.5 6.5l2.3 2.3'],
      file: ['M4 1.5h5l3 3v10H4z', 'M9 1.5v3h3'],
      git: ['M5 4.5v11', 'M11 4.5v3a2.5 2.5 0 0 1-2.5 2.5H5'],
      left: ['M10 3.5L5.5 8l4.5 4.5'],
      dot: ['M8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3'],
    };

    /**
     * One glyph, stroked with `currentColor`.
     * @param props - `{ name, size? }`.
     * @returns the svg element.
     */
    function Icon({ name, size = 16 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, (GLYPHS[name] ?? []).map((d, index) => h('path', { key: index, d })));
    }

    /* ------------------------------------------------------------------ *
     * Reads and the command
     * ------------------------------------------------------------------ */

    /**
     * Fetch one authenticated read route.
     * @param route - the document-relative route.
     * @param params - the query parameters.
     * @returns the decoded payload.
     * @throws when the route answers with a transport failure.
     */
    async function getJson(route, params) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) query.set(key, String(value));
      }
      const response = await fetch(`${route}?${query.toString()}`, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      return response.json();
    }

    /**
     * Run one `/git-graph` mutation and return its success line.
     * @param remote - the client Remote face.
     * @param sessionId - the session the command runs against.
     * @param payload - the request object.
     * @returns the Host's success line.
     * @throws an Error whose message is `CODE: message`.
     */
    async function runHost(remote, sessionId, payload) {
      const line = `/${COMMAND} ${JSON.stringify(payload)}`;
      const result = await remote.commands.execute(sessionId, line, []);
      if (result?.ok !== true) {
        const error = result?.error ?? {};
        throw new Error(`${error.code ?? 'command-failed'}${typeof error.message === 'string' ? `: ${error.message}` : ''}`);
      }
      const settled = result.value?.result;
      if (settled?.kind !== 'success') {
        throw new Error(typeof settled?.text === 'string' ? settled.text : 'command-failed: the command failed');
      }
      return typeof settled.text === 'string' ? settled.text : '';
    }

    /**
     * Split a failed message into its stable code and its text.
     * @param text - the message.
     * @returns the code and message.
     */
    function classify(text) {
      const match = /^([A-Z][A-Z0-9_]*):\s*([\s\S]*)$/.exec(String(text ?? ''));
      if (match === null) return { code: '', message: String(text ?? '') };
      return { code: match[1], message: match[2] };
    }

    /**
     * The status letter shown beside one path.
     * @param status - the git status letter.
     * @returns the letter and its tone.
     */
    function statusCell(status) {
      if (status === '?') return { letter: 'U', tone: 'dgg-added' };
      if (status === 'A') return { letter: 'A', tone: 'dgg-added' };
      if (status === 'D') return { letter: 'D', tone: 'dgg-deleted' };
      if (status === 'U') return { letter: '!', tone: 'dgg-deleted' };
      if (status === 'R') return { letter: 'R', tone: 'dgg-modified' };
      return { letter: 'M', tone: 'dgg-modified' };
    }

    /**
     * Render one path with its directory dimmed.
     * @param props - `{ path }`.
     * @returns the element.
     */
    function PathLabel({ path }) {
      const text = String(path ?? '');
      const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
      if (cut < 0) return h('span', { className: 'dgg-path' }, text);
      return h('span', { className: 'dgg-path' },
        h('span', { className: 'dgg-path-dir' }, text.slice(0, cut + 1)),
        text.slice(cut + 1));
    }

    /**
     * Format a commit date as a short local string.
     * @param iso - the ISO date.
     * @returns the formatted date or the raw string.
     */
    function shortDate(iso) {
      const time = Date.parse(String(iso ?? ''));
      if (Number.isNaN(time)) return String(iso ?? '');
      const date = new Date(time);
      const pad = (value) => String(value).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /* ------------------------------------------------------------------ *
     * The commit graph
     * ------------------------------------------------------------------ */

    /**
     * Assign each commit a lane, so the graph column can be drawn.
     *
     * This is the usual swimlane pass: a commit takes the lane already waiting
     * for it, its first parent inherits that lane, and any further parent opens
     * or joins another lane. Lanes that nothing is waiting for are released.
     *
     * @param commits - the commit list, newest first, each with `parents`.
     * @returns rows of `{ commit, lane, before, after }`.
     */
    function assignLanes(commits) {
      /** `lanes[i]` is the hash that lane i is waiting for, or null. */
      const lanes = [];
      const rows = [];

      for (const commit of commits) {
        const before = lanes.slice();
        let lane = lanes.indexOf(commit.hash);
        if (lane === -1) {
          lane = lanes.indexOf(null);
          if (lane === -1) {
            lanes.push(null);
            lane = lanes.length - 1;
          }
        }
        // A commit can be awaited by more than one lane; the extras are folded
        // into this one.
        for (let index = 0; index < lanes.length; index += 1) {
          if (index !== lane && lanes[index] === commit.hash) lanes[index] = null;
        }

        const [first, ...rest] = commit.parents ?? [];
        lanes[lane] = first ?? null;
        for (const parent of rest) {
          if (parent === undefined || parent === null) continue;
          if (lanes.includes(parent)) continue;
          const free = lanes.indexOf(null);
          if (free === -1) lanes.push(parent);
          else lanes[free] = parent;
        }

        const after = lanes.slice();
        while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
        rows.push({ commit, lane, before, after });
      }
      return rows;
    }

    /**
     * One row's graph cell: the lanes passing it, its own node, and the curves
     * into any further parents.
     * @param props - `{ row, lanes }`.
     * @returns the svg element.
     */
    function GraphCell({ row, lanes }) {
      const width = Math.max(2, lanes) * LANE_WIDTH;
      const middle = ROW_HEIGHT / 2;
      const children = [];
      const colour = (index) => LANE_COLORS[index % LANE_COLORS.length];

      for (let index = 0; index < lanes; index += 1) {
        const x = index * LANE_WIDTH + LANE_WIDTH / 2;
        const above = row.before[index] !== undefined && row.before[index] !== null;
        const below = row.after[index] !== undefined && row.after[index] !== null;
        if (above && (index !== row.lane || below)) {
          children.push(h('line', {
            key: `a${index}`,
            x1: x,
            y1: 0,
            x2: x,
            y2: row.lane === index ? middle : ROW_HEIGHT,
            stroke: colour(index),
            strokeWidth: 1.4,
            opacity: 0.75,
          }));
        }
        if (below && index !== row.lane) {
          children.push(h('line', {
            key: `b${index}`,
            x1: x,
            y1: middle,
            x2: x,
            y2: ROW_HEIGHT,
            stroke: colour(index),
            strokeWidth: 1.4,
            opacity: 0.75,
          }));
        }
        if (below && index === row.lane) {
          children.push(h('line', {
            key: `c${index}`,
            x1: x,
            y1: middle,
            x2: x,
            y2: ROW_HEIGHT,
            stroke: colour(index),
            strokeWidth: 1.4,
          }));
        }
      }

      // Curves into the merge parents, drawn from this commit's node.
      const own = row.lane * LANE_WIDTH + LANE_WIDTH / 2;
      row.after.forEach((hash, index) => {
        if (hash === null || index === row.lane) return;
        if (row.before[index] !== null && row.before[index] !== undefined) return;
        const x = index * LANE_WIDTH + LANE_WIDTH / 2;
        children.push(h('path', {
          key: `m${index}`,
          d: `M${own} ${middle} C ${own} ${middle + 6}, ${x} ${middle + 4}, ${x} ${ROW_HEIGHT}`,
          fill: 'none',
          stroke: colour(index),
          strokeWidth: 1.4,
        }));
      });

      children.push(h('circle', {
        key: 'node',
        cx: own,
        cy: middle,
        r: 3.2,
        fill: colour(row.lane),
        stroke: 'var(--dsw-alias-bg-base,#fff)',
        strokeWidth: 1.2,
      }));

      return h('svg', {
        className: 'dgg-graph',
        width,
        height: ROW_HEIGHT,
        viewBox: `0 0 ${width} ${ROW_HEIGHT}`,
        'aria-hidden': 'true',
      }, children);
    }

    /**
     * A unified diff, coloured by line kind.
     * @param props - `{ text, truncated, t }`.
     * @returns the pre element.
     */
    function DiffView({ text, truncated, t }) {
      const lines = String(text ?? '').split('\n');
      return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' } },
        truncated === true ? h('div', { className: 'dgg-note' }, t('label.truncated')) : null,
        h('pre', { className: 'dgg-diff' }, lines.map((line, index) => h('span', {
          key: index,
          className: [
            'dgg-diff-line',
            line.startsWith('+') && !line.startsWith('+++') ? 'dgg-diff-add' : '',
            line.startsWith('-') && !line.startsWith('---') ? 'dgg-diff-del' : '',
            line.startsWith('@@') ? 'dgg-diff-hunk' : '',
            line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') ? 'dgg-diff-meta' : '',
          ].filter((value) => value.length > 0).join(' '),
        }, line.length === 0 ? ' ' : line))));
    }

    /* ------------------------------------------------------------------ *
     * The body
     * ------------------------------------------------------------------ */

    /**
     * The sidebar page: header, view tabs, and whichever view is selected.
     * @param props - the session-scoped slot props, the Remote face, and `t`.
     * @returns the page element.
     */
    function GitBody({ remote, useTabInfo, sessionId, t }) {
      const info = useTabInfo();
      const visible = info?.tab?.visible !== false;

      const [view, setView] = useState('changes');
      const [state, setState] = useState(null);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [busy, setBusy] = useState(false);
      const [detail, setDetail] = useState(null);
      const [agent, setAgent] = useState(null);
      const [refreshToken, setRefreshToken] = useState(0);
      const [message, setMessage] = useState('');
      const [amend, setAmend] = useState(false);
      const [commitAll, setCommitAll] = useState(false);
      const [branchName, setBranchName] = useState('');
      const [confirming, setConfirming] = useState(null);

      const alive = useRef(true);
      useEffect(() => () => {
        alive.current = false;
      }, []);

      const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

      /**
       * Load the repository state with only what the selected view needs: the
       * status route is the panel's heartbeat, and history and branches are
       * expensive enough to be asked for on demand.
       */
      useEffect(() => {
        if (!visible) return undefined;
        let cancelled = false;
        const wantHistory = view === 'history';
        const wantBranches = view === 'branches';
        const period = wantHistory ? POLL_HISTORY_MS : wantBranches ? POLL_BRANCHES_MS : POLL_STATUS_MS;

        const load = async () => {
          try {
            const payload = await getJson(ROUTE_STATE, {
              sessionId,
              history: wantHistory ? 1 : 0,
              branches: wantBranches || state === null ? 1 : 0,
            });
            if (cancelled || !alive.current) return;
            if (payload?.ok !== true) {
              setError(payload?.error?.message ?? 'failed');
              return;
            }
            setError(null);
            setState(payload.repo ?? null);
          } catch (problem) {
            if (!cancelled && alive.current) setError(String(problem?.message ?? problem));
          }
        };

        void load();
        const timer = setInterval(() => void load(), period);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [sessionId, view, visible, refreshToken, state === null]);

      /** Load the recorder's summary of the last turn the agent changed files in. */
      useEffect(() => {
        if (view !== 'changes') return undefined;
        let cancelled = false;
        void (async () => {
          try {
            const payload = await getJson(ROUTE_AGENT, { sessionId });
            if (!cancelled && alive.current) setAgent(payload?.summary ?? null);
          } catch {
            // The recorder is a bonus view; its absence is not an error state.
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [sessionId, view, refreshToken]);

      /** Run one mutation and report it. */
      const act = useCallback(async (payload, options) => {
        setBusy(true);
        setNotice(null);
        try {
          const text = await runHost(remote, sessionId, payload);
          if (!alive.current) return true;
          setNotice({ kind: 'info', text });
          if (options?.clearMessage === true) setMessage('');
          refresh();
          return true;
        } catch (problem) {
          if (alive.current) setNotice({ kind: 'error', text: t('error.action', { message: classify(problem?.message ?? String(problem)).message }) });
          return false;
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [remote, sessionId, refresh, t]);

      /** Open one file's comparison. */
      const openDiff = useCallback(async (kind, path, options) => {
        setBusy(true);
        setDetail({ mode: 'diff', title: path ?? options?.title ?? '', body: null, loading: true });
        try {
          const payload = await getJson(ROUTE_DIFF, {
            sessionId,
            kind,
            path,
            hash: options?.hash,
            index: options?.index,
          });
          if (!alive.current) return;
          setDetail({
            mode: 'diff',
            title: options?.title ?? path ?? '',
            text: payload?.diff ?? payload?.error?.message ?? '',
            truncated: payload?.truncated === true,
            message: payload?.message ?? '',
            loading: false,
          });
        } catch (problem) {
          if (alive.current) setDetail({ mode: 'diff', title: path ?? '', text: String(problem?.message ?? problem), loading: false });
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [sessionId]);

      /** Open one commit's detail. */
      const openCommit = useCallback(async (hash, subject) => {
        setBusy(true);
        setDetail({ mode: 'commit', title: subject, body: null, loading: true });
        try {
          const payload = await getJson(ROUTE_COMMIT, { sessionId, hash });
          if (!alive.current) return;
          if (payload?.ok !== true) {
            setDetail({ mode: 'commit', title: subject, body: null, loading: false, error: payload?.error?.message ?? 'failed' });
            return;
          }
          setDetail({
            mode: 'commit',
            title: subject,
            commit: payload.commit,
            files: payload.files,
            patch: payload.patch,
            truncated: payload.truncated === true,
            loading: false,
          });
        } catch (problem) {
          if (alive.current) setDetail({ mode: 'commit', title: subject, body: null, loading: false, error: String(problem?.message ?? problem) });
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [sessionId]);

      const rows = useMemo(() => (state?.commits === undefined ? [] : assignLanes(state.commits)), [state]);
      const laneCount = useMemo(() => rows.reduce((max, row) => Math.max(max, row.before.length, row.after.length), 1), [rows]);
      const repo = state;

      if (error !== null) {
        return h('div', { className: 'dgg-root' },
          h('div', { className: 'dgg-notice dgg-error' }, t('error.state', { message: error })),
          h('div', { className: 'dgg-note' }, h('button', { type: 'button', className: 'dgg-btn', onClick: refresh }, t('action.refresh'))));
      }

      if (state === null) {
        return h('div', { className: 'dgg-root' }, h('div', { className: 'dgg-note' }, t('label.loading')));
      }

      /* ---- not a repository ---- */
      if (repo.root === undefined) {
        return h('div', { className: 'dgg-root' },
          h('div', { className: 'dgg-note' }, t('label.noRepo')),
          h('div', { className: 'dgg-note' }, String(repo.reason ?? '')),
          h('div', { style: { padding: '0 12px 12px' } },
            h('button', {
              type: 'button',
              className: 'dgg-btn dgg-primary',
              disabled: busy,
              onClick: () => void act({ op: 'init' }),
            }, t('action.init'))),
          notice !== null ? h('div', { className: `dgg-notice${notice.kind === 'error' ? ' dgg-error' : ''}` }, notice.text) : null);
      }

      const tracking = repo.detached === true
        ? t('label.detached')
        : repo.upstream === undefined || repo.upstream.length === 0
          ? t('label.noUpstream')
          : [repo.ahead > 0 ? t('label.ahead', { n: repo.ahead }) : '', repo.behind > 0 ? t('label.behind', { n: repo.behind }) : ''].filter((value) => value.length > 0).join(', ') || repo.upstream;

      const stagedCount = repo.staged.length + repo.conflicted.length;
      const workCount = repo.unstaged.length + repo.untracked.length;

      /** One file row with its hover actions. */
      const fileRow = (entry, section) => h('div', { className: 'dgg-row', key: `${section}:${entry.path}`, role: 'button', tabIndex: 0,
        onClick: () => void openDiff(section === 'staged' ? 'staged' : section === 'untracked' ? 'untracked' : 'worktree', entry.path),
        onKeyDown: (event) => {
          if (event.key === 'Enter') void openDiff(section === 'staged' ? 'staged' : section === 'untracked' ? 'untracked' : 'worktree', entry.path);
        },
      },
        h('span', { className: `dgg-status ${statusCell(entry.status).tone}` }, statusCell(entry.status).letter),
        h(PathLabel, { path: entry.path }),
        h('span', { className: 'dgg-row-actions' },
          section === 'staged'
            ? h('button', {
              type: 'button',
              className: 'dgg-mini',
              title: t('action.unstage'),
              'aria-label': `${t('action.unstage')} ${entry.path}`,
              disabled: busy,
              onClick: (event) => {
                event.stopPropagation();
                void act({ op: 'unstage', paths: [entry.path] });
              },
            }, h(Icon, { name: 'minus', size: 13 }))
            : section === 'untracked' || section === 'unstaged'
              ? h('button', {
                type: 'button',
                className: 'dgg-mini',
                title: t('action.stage'),
                'aria-label': `${t('action.stage')} ${entry.path}`,
                disabled: busy,
                onClick: (event) => {
                  event.stopPropagation();
                  void act({ op: 'stage', paths: [entry.path] });
                },
              }, h(Icon, { name: 'plus', size: 13 }))
              : null,
          section === 'unstaged'
            ? h('button', {
              type: 'button',
              className: 'dgg-mini dgg-danger',
              title: t('action.discard'),
              'aria-label': `${t('action.discard')} ${entry.path}`,
              disabled: busy,
              onClick: (event) => {
                event.stopPropagation();
                setConfirming({ kind: 'discard', path: entry.path });
              },
            }, h(Icon, { name: 'undo', size: 13 }))
            : null));

      const section = (title, entries, key) => entries.length === 0
        ? null
        : h('div', { className: 'dgg-section', key },
          h('div', { className: 'dgg-section-head' },
            h('span', { className: 'dgg-section-title' }, `${title} (${entries.length})`),
            key === 'staged'
              ? h('button', { type: 'button', className: 'dgg-btn', disabled: busy, onClick: () => void act({ op: 'unstage-all' }) }, t('action.unstageAll'))
              : key === 'unstaged' || key === 'untracked'
                ? h('button', { type: 'button', className: 'dgg-btn', disabled: busy, onClick: () => void act({ op: 'stage-all' }) }, t('action.stageAll'))
                : null),
          entries.map((entry) => fileRow(entry, key)));

      /* ---- detail views ---- */
      if (detail !== null) {
        return h('div', { className: 'dgg-root' },
          h('div', { className: 'dgg-head' },
            h('button', {
              type: 'button',
              className: 'dgg-icon',
              title: t('action.back'),
              'aria-label': t('action.back'),
              onClick: () => setDetail(null),
            }, h(Icon, { name: 'left', size: 15 })),
            h('span', { className: 'dgg-branch' }, h('span', { className: 'dgg-branch-name', title: detail.title }, detail.title || t('label.loading')))),
          detail.loading === true
            ? h('div', { className: 'dgg-note' }, t('label.loading'))
            : detail.mode === 'diff'
              ? h(DiffView, { text: detail.text, truncated: detail.truncated, t })
              : h('div', { className: 'dgg-body' },
                h('div', { className: 'dgg-detail' },
                  h('div', { className: 'dgg-kv' }, `${detail.commit?.short ?? ''} · ${detail.commit?.author ?? ''} · ${shortDate(detail.commit?.date)}`),
                  h('div', { className: 'dgg-kv' }, detail.commit?.subject ?? ''),
                  detail.error !== undefined ? h('div', { className: 'dgg-note dgg-error' }, String(detail.error)) : null,
                  h('div', { className: 'dgg-section-head' }, h('span', { className: 'dgg-section-title' }, t('label.files', { n: (detail.files ?? []).length }))),
                  (detail.files ?? []).map((file) => h('div', { className: 'dgg-row', key: file.path },
                    h('span', { className: `dgg-status ${statusCell(file.status).tone}` }, file.status),
                    h(PathLabel, { path: file.path })))),
                h(DiffView, { text: detail.patch, truncated: detail.truncated, t })));
      }

      /* ---- the three views ---- */
      const body = view === 'changes'
        ? h('div', { className: 'dgg-body' },
          agent !== null && agent.total > 0
            ? h('div', { className: 'dgg-agent' },
              h('div', { className: 'dgg-agent-head' },
                h(Icon, { name: 'dot', size: 13 }),
                h('span', { className: 'dgg-agent-count' }, t('label.agentTurn', { n: agent.total })),
                h('span', { className: 'dgg-plus' }, `+${agent.added}`),
                h('span', { className: 'dgg-minus' }, `−${agent.deleted}`)))
            : null,
          repo.conflicted.length > 0 ? section(t('label.conflicted'), repo.conflicted, 'conflicted') : null,
          repo.staged.length > 0 ? section(t('label.staged'), repo.staged, 'staged') : null,
          repo.unstaged.length > 0 ? section(t('label.unstaged'), repo.unstaged, 'unstaged') : null,
          repo.untracked.length > 0 ? section(t('label.untracked'), repo.untracked, 'untracked') : null,
          stagedCount === 0 && workCount === 0 ? h('div', { className: 'dgg-note' }, t('label.noChanges')) : null,
          h('div', { className: 'dgg-commit-box' },
            h('textarea', {
              className: 'dgg-textarea',
              value: message,
              placeholder: t('label.commitMessage'),
              'aria-label': t('label.commitMessage'),
              onChange: (event) => setMessage(event.target.value),
            }),
            h('div', { className: 'dgg-box-row' },
              h('label', { className: 'dgg-check' },
                h('input', { type: 'checkbox', checked: commitAll, onChange: (event) => setCommitAll(event.target.checked) }),
                t('label.allTracked')),
              h('label', { className: 'dgg-check' },
                h('input', { type: 'checkbox', checked: amend, onChange: (event) => setAmend(event.target.checked) }),
                t('label.amend')),
              h('span', { style: { flex: '1 1 auto' } }),
              h('button', {
                type: 'button',
                className: 'dgg-btn',
                disabled: busy || message.trim().length === 0,
                onClick: () => void act({ op: 'commit-and-push', message, all: commitAll, amend }, { clearMessage: true }),
              }, t('action.commitPush')),
              h('button', {
                type: 'button',
                className: 'dgg-btn dgg-primary',
                disabled: busy || message.trim().length === 0,
                onClick: () => void act({ op: 'commit', message, all: commitAll, amend }, { clearMessage: true }),
              }, t('action.commit')))))
        : view === 'history'
          ? h('div', { className: 'dgg-body' },
            rows.map((row) => h('div', {
              className: 'dgg-commit',
              key: row.commit.hash,
              role: 'button',
              tabIndex: 0,
              onClick: () => void openCommit(row.commit.hash, row.commit.subject),
              onKeyDown: (event) => {
                if (event.key === 'Enter') void openCommit(row.commit.hash, row.commit.subject);
              },
            },
              h(GraphCell, { row, lanes: laneCount }),
              h('span', { className: 'dgg-commit-main' },
                h('span', { className: 'dgg-subject' }, row.commit.subject || row.commit.short),
                h('span', { className: 'dgg-meta' },
                  row.commit.refs.map((ref) => h('span', {
                    key: ref,
                    className: `dgg-ref${ref.includes('HEAD') ? ' dgg-head' : ref.startsWith('tag:') ? ' dgg-tag' : ''}`,
                  }, ref.replace(/^HEAD -> /, '').replace(/^tag: /, ''))),
                  h('span', null, row.commit.short),
                  h('span', null, row.commit.author),
                  h('span', null, shortDate(row.commit.date)))))))
          : h('div', { className: 'dgg-body' },
            h('div', { className: 'dgg-section' },
              h('div', { className: 'dgg-section-head' }, h('span', { className: 'dgg-section-title' }, t('label.local'))),
              (repo.branches ?? []).map((branch) => h('div', { className: 'dgg-row', key: branch.name },
                h('span', { className: 'dgg-status', style: { color: branch.current ? 'var(--dsw-alias-state-success-primary,#22c55e)' : 'var(--dsw-alias-label-tertiary,#81858c)' } }, branch.current ? '●' : '○'),
                h('span', { className: 'dgg-path' }, branch.name),
                h('span', { className: 'dgg-row-actions' },
                  branch.current
                    ? null
                    : h('button', {
                      type: 'button',
                      className: 'dgg-mini',
                      title: t('action.switch'),
                      'aria-label': `${t('action.switch')} ${branch.name}`,
                      disabled: busy,
                      onClick: () => void act({ op: 'branch-switch', name: branch.name }),
                    }, h(Icon, { name: 'git', size: 13 })),
                  branch.current
                    ? null
                    : h('button', {
                      type: 'button',
                      className: 'dgg-mini dgg-danger',
                      title: t('action.deleteBranch'),
                      'aria-label': `${t('action.deleteBranch')} ${branch.name}`,
                      disabled: busy,
                      onClick: () => setConfirming({ kind: 'branch', name: branch.name }),
                    }, h(Icon, { name: 'trash', size: 13 }))))),
              h('div', { className: 'dgg-box-row', style: { padding: '6px 8px' } },
                h('input', {
                  className: 'dgg-input',
                  value: branchName,
                  placeholder: t('label.newBranch'),
                  'aria-label': t('label.newBranch'),
                  onChange: (event) => setBranchName(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' && branchName.trim().length > 0) {
                      void act({ op: 'branch-create', name: branchName.trim() }).then((done) => {
                        if (done === true) setBranchName('');
                      });
                    }
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'dgg-btn dgg-primary',
                  disabled: busy || branchName.trim().length === 0,
                  onClick: () => void act({ op: 'branch-create', name: branchName.trim() }).then((done) => {
                    if (done === true) setBranchName('');
                  }),
                }, t('action.createBranch')))),
            h('div', { className: 'dgg-section' },
              h('div', { className: 'dgg-section-head' },
                h('span', { className: 'dgg-section-title' }, t('label.remote')),
                h('button', { type: 'button', className: 'dgg-btn', disabled: busy, onClick: () => void act({ op: 'fetch' }) }, t('action.fetch'))),
              (repo.remotes ?? []).length === 0
                ? h('div', { className: 'dgg-note' }, t('label.noRemotes'))
                : (repo.remotes ?? []).map((remoteEntry) => h('div', { className: 'dgg-row', key: remoteEntry.name },
                  h('span', { className: 'dgg-status' }, '⇅'),
                  h('span', { className: 'dgg-path' }, `${remoteEntry.name}  ${remoteEntry.url}`)))));

      return h('div', { className: 'dgg-root' },
        h('div', { className: 'dgg-head' },
          h('span', { className: 'dgg-branch', title: repo.upstream ?? '' },
            h(Icon, { name: 'branch', size: 14 }),
            h('span', { className: 'dgg-branch-name' }, repo.branch.length > 0 ? repo.branch : t('label.detached'))),
          h('span', { className: 'dgg-track' }, tracking),
          h('button', {
            type: 'button',
            className: 'dgg-icon',
            title: t('action.refresh'),
            'aria-label': t('action.refresh'),
            disabled: busy,
            onClick: refresh,
          }, h(Icon, { name: 'refresh', size: 15 })),
          h('button', {
            type: 'button',
            className: 'dgg-icon',
            title: t('action.fetch'),
            'aria-label': t('action.fetch'),
            disabled: busy,
            onClick: () => void act({ op: 'fetch' }),
          }, h(Icon, { name: 'download', size: 15 })),
          h('button', {
            type: 'button',
            className: 'dgg-icon',
            title: t('action.pull'),
            'aria-label': t('action.pull'),
            disabled: busy,
            onClick: () => void act({ op: 'pull' }),
          }, h(Icon, { name: 'left', size: 15 })),
          h('button', {
            type: 'button',
            className: 'dgg-icon',
            title: t('action.push'),
            'aria-label': t('action.push'),
            disabled: busy,
            onClick: () => void act({ op: 'push' }),
          }, h(Icon, { name: 'upload', size: 15 }))),

        h('div', { className: 'dgg-tabs', role: 'tablist' },
          ['changes', 'history', 'branches'].map((key) => h('button', {
            key,
            type: 'button',
            role: 'tab',
            className: 'dgg-tab',
            'aria-selected': view === key,
            onClick: () => {
              setDetail(null);
              setView(key);
            },
          }, t(`view.${key}`)))),

        notice !== null ? h('div', { className: `dgg-notice${notice.kind === 'error' ? ' dgg-error' : ''}` }, notice.text) : null,

        body,

        confirming !== null
          ? h('div', {
            className: 'dgg-mask',
            style: { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--dsw-alias-bg-mask-1,#0000003d)' },
            onPointerDown: (event) => {
              if (event.target === event.currentTarget) setConfirming(null);
            },
          },
            h('div', {
              role: 'dialog',
              'aria-modal': 'true',
              style: { width: 'min(340px,100%)', padding: 16, border: '.5px solid var(--dsw-alias-border-l3,#0000001f)', borderRadius: 'var(--dsw-radius-lg,16px)', background: 'var(--dsw-alias-bg-layer-2,#fff)', boxShadow: 'var(--dsw-elevation-prominent,0 8px 32px #0003)', fontSize: 13 },
            },
              h('div', { style: { margin: '0 0 14px' } },
                confirming.kind === 'discard'
                  ? t('confirm.discardFile', { name: confirming.path })
                  : t('confirm.deleteBranch', { name: confirming.name })),
              h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 6 } },
                h('button', { type: 'button', className: 'dgg-btn', onClick: () => setConfirming(null) }, t('action.cancel')),
                h('button', {
                  type: 'button',
                  className: 'dgg-btn dgg-primary',
                  disabled: busy,
                  onClick: () => {
                    const request = confirming.kind === 'discard'
                      ? { op: 'discard', paths: [confirming.path] }
                      : { op: 'branch-delete', name: confirming.name };
                    setConfirming(null);
                    void act(request);
                  },
                }, t('action.confirmDelete')))))
          : null);
    }

    /**
     * The tab chip.
     * @param props - the session-scoped slot props plus the bound translator.
     * @returns the chip element.
     */
    function GitTitle({ t }) {
      return h('span', { className: 'dgg-title' }, h(Icon, { name: 'git', size: 14 }), t('title.fallback'));
    }

    /* ------------------------------------------------------------------ *
     * Registration
     * ------------------------------------------------------------------ */

    /**
     * Register the page type, its seats, its dictionary and its shortcut.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      const remote = ctx.remote;

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'git-graph: dictionaries');
      ctx.effect(installStyles, 'git-graph: styles');

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'extension',
        keepMounted: true,
        title: () => t('title.fallback'),
        guide: [{
          id: 'git-graph',
          order: 12,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
          icon: () => h('span', { style: { color: 'var(--dsw-alias-state-success-primary,#22c55e)' } }, h(Icon, { name: 'git', size: 16 })),
        }],
      }), 'git-graph: tab type');

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
        locale: NS,
      }, (props) => h(GitBody, { ...props, remote }))), 'git-graph: tab body');

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: TAB_ID,
        locale: NS,
      }, GitTitle)), 'git-graph: tab title');

      ctx.inject(['shortcuts'], (shortcutsCtx) => {
        shortcutsCtx.effect(() => shortcutsCtx.shortcuts.register({
          id: 'workspace.gitGraph',
          label: () => t('guide.title'),
          aliases: ['source control', 'git', 'git graph'],
          defaults: {
            'desktop:macos': { code: 'KeyG', modifiers: ['primary', 'shift'] },
            'desktop:windows': { code: 'KeyG', modifiers: ['primary', 'shift'] },
            'desktop:linux': { code: 'KeyG', modifiers: ['primary', 'shift'] },
            'web:macos': { code: 'KeyG', modifiers: ['primary', 'shift'] },
            'web:windows': { code: 'KeyG', modifiers: ['primary', 'shift'] },
          },
          regions: ['page', 'editable', 'terminal'],
          modals: [],
          resolve: ({ target }) => {
            const anchor = shortcutsCtx.sidebarRight.commandTarget(target);
            if (anchor === undefined) return { status: 'blocked', reason: t('shortcut.noSession') };
            return {
              status: 'handled',
              run: () => shortcutsCtx.sidebarRight.openTabFromTarget(TAB_KIND, anchor),
            };
          },
        }), 'git-graph: shortcut');
      });
    }

    return {
      name: 'git-graph',
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.commands'],
      apply,
    };
  },
});
