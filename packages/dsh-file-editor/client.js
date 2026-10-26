/**
 * File editor — the Client half of `@malipetek/dsh-file-editor`.
 *
 * A right-Sidebar page type that is the shipped file tree's editable sibling: it
 * lists the session workspace one level at a time, creates files and folders,
 * renames and deletes entries, and opens a text editor that saves back through
 * the Host's `/editor` command.
 *
 * Reads never touch that command: listing, stat, complete-file bytes and change
 * watches all come from the shipped `workspaceFiles` Remote, which is already
 * live and already bounded. Only mutations are commands, because a mutation is
 * the thing the Host has to authorize — and because a command is the one
 * Client-callable Host entry point a third-party bundle is allowed to add.
 *
 * State is plain React state, and the tab type sets `keepMounted: true`, so
 * switching Sidebar tabs does not lose the open file, the expanded tree or an
 * unsaved edit. That is why this plugin declares no slot store: retention is the
 * job `keepMounted` already does, and it costs no Harness Client package import.
 *
 * @module @malipetek/dsh-file-editor/client
 */
window.__ModuleLoader__.load({
  id: '@malipetek/dsh-file-editor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } = React;

    /** This client half's package name; also the sidebar tab type's registry id and seat key. */
    const TAB_ID = '@malipetek/dsh-file-editor';
    /** The tab `kind` a page is opened by. Its own kind, so the shipped tree stays available. */
    const TAB_KIND = 'file-editor';
    /** This plugin's locale namespace. */
    const NS = 'fileEditor';
    /** The Host command mutations go through. */
    const COMMAND = 'editor';
    /** How long a burst of watch events is coalesced before one reload. */
    const REFRESH_DEBOUNCE_MS = 300;

    /* ------------------------------------------------------------------ *
     * Copy
     * ------------------------------------------------------------------ */

    const en = {
      'guide.title': 'Files (edit)',
      'guide.description': 'Browse, edit, create, rename and delete workspace files',
      'shortcut.noSession': 'Select a session first',
      'title.fallback': 'Files',
      'action.newFile': 'New file',
      'action.newFolder': 'New folder',
      'action.refresh': 'Reload',
      'action.rename': 'Rename',
      'action.delete': 'Delete',
      'action.save': 'Save',
      'action.revert': 'Revert',
      'action.close': 'Close editor',
      'action.cancel': 'Cancel',
      'action.confirm': 'Confirm',
      'action.overwrite': 'Overwrite',
      'action.reload': 'Reload from disk',
      'placeholder.name': 'Name',
      'placeholder.fileName': 'file name',
      'placeholder.folderName': 'folder name',
      'label.loading': 'Loading…',
      'label.empty': 'empty folder',
      'label.truncated': 'listing cut short by the entry cap',
      'label.noWorkspace': 'This session has no workspace directory.',
      'label.into': 'into {path}',
      'label.lines': '{n} lines',
      'label.unsaved': 'unsaved',
      'error.read': 'Could not read this file: {message}',
      'error.save': 'Could not save: {message}',
      'error.binary': 'This file is not UTF-8 text, so the editor cannot open it.',
      'error.tooLarge': 'This file is larger than the read cap, so the editor cannot open it.',
      'error.failed': 'The file could not be read.',
      'error.separator': 'A name cannot contain a path separator.',
      'confirm.deleteFile': 'Delete “{name}”? This cannot be undone.',
      'confirm.deleteFolder': 'Delete the folder “{name}” and everything inside it? This cannot be undone.',
      'conflict.title': 'This file changed on disk after you opened it.',
      'conflict.body': 'Your edits are still here. Overwrite replaces the file with them; reloading discards them.',
    };

    const zh = {
      'guide.title': '文件（可编辑）',
      'guide.description': '浏览、编辑、新建、重命名和删除工作区文件',
      'shortcut.noSession': '请先选择一个会话',
      'title.fallback': '文件',
      'action.newFile': '新建文件',
      'action.newFolder': '新建文件夹',
      'action.refresh': '重新加载',
      'action.rename': '重命名',
      'action.delete': '删除',
      'action.save': '保存',
      'action.revert': '还原',
      'action.close': '关闭编辑器',
      'action.cancel': '取消',
      'action.confirm': '确认',
      'action.overwrite': '覆盖',
      'action.reload': '从磁盘重新加载',
      'placeholder.name': '名称',
      'placeholder.fileName': '文件名',
      'placeholder.folderName': '文件夹名',
      'label.loading': '加载中…',
      'label.empty': '空文件夹',
      'label.truncated': '条目过多，列表已被截断',
      'label.noWorkspace': '此会话没有工作区目录。',
      'label.into': '到 {path}',
      'label.lines': '{n} 行',
      'label.unsaved': '未保存',
      'error.read': '无法读取此文件：{message}',
      'error.save': '无法保存：{message}',
      'error.binary': '此文件不是 UTF-8 文本，编辑器无法打开。',
      'error.tooLarge': '此文件超过读取上限，编辑器无法打开。',
      'error.failed': '无法读取该文件。',
      'error.separator': '名称中不能包含路径分隔符。',
      'confirm.deleteFile': '删除“{name}”？此操作无法撤销。',
      'confirm.deleteFolder': '删除文件夹“{name}”及其中所有内容？此操作无法撤销。',
      'conflict.title': '打开后该文件在磁盘上发生了变化。',
      'conflict.body': '你的修改仍然保留。覆盖会用你的修改替换该文件；重新加载会丢弃它们。',
    };

    /* ------------------------------------------------------------------ *
     * Styles
     * ------------------------------------------------------------------ */

    /**
     * Every value is a theme token with a light-theme fallback, so the panel
     * follows light/dark switching and survives a renamed token. Class names
     * carry this plugin's prefix and collide with no host stylesheet.
     */
    const CSS = `
.dfe-root{display:flex;flex-direction:column;height:100%;min-height:0;font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#0f1115);background:var(--dsw-alias-bg-base,#fff)}
.dfe-root *,.dfe-root *::before,.dfe-root *::after{box-sizing:border-box}
.dfe-bar{display:flex;align-items:center;gap:2px;flex:0 0 auto;padding:4px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a)}
.dfe-scope{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c);padding:0 2px}
.dfe-main{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
.dfe-tree{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:2px 0}
.dfe-tree.dfe-split{flex:0 0 40%;min-height:110px;border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a)}
.dfe-editor{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}
.dfe-icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:none;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer;flex:0 0 auto}
.dfe-icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.dfe-icon:disabled{opacity:.4;cursor:default}
.dfe-icon.dfe-danger{color:var(--dsw-alias-state-error-primary,#ec1313)}
.dfe-icon.dfe-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,#ec13130d)}
.dfe-icon:focus-visible,.dfe-btn:focus-visible,.dfe-row-main:focus-visible,.dfe-twisty:focus-visible,.dfe-input:focus-visible,.dfe-textarea:focus-visible,.dfe-mini:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:-1px}
.dfe-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm,8px);background:none;color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:12px;cursor:pointer;flex:0 0 auto}
.dfe-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.dfe-btn.dfe-primary{background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}
.dfe-btn.dfe-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#333)}
.dfe-btn:disabled{opacity:.4;cursor:default}
.dfe-row{display:flex;align-items:center;gap:2px;width:100%;padding:0 4px 0 0;border-radius:var(--dsw-radius-sm,8px);color:var(--dsw-alias-label-primary,#0f1115)}
.dfe-row:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.dfe-row.dfe-active{background:var(--dsw-alias-button-ghost-active-fill,#ebeef2);box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border,#00000014)}
.dfe-row.dfe-selected{background:var(--dsw-specific-sidebar-nav-item-active,#ebeef2)}
.dfe-twisty{display:inline-flex;align-items:center;justify-content:center;width:16px;height:22px;flex:0 0 auto;padding:0;border:0;background:none;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer;border-radius:var(--dsw-radius-xs,4px)}
.dfe-twisty:hover{color:var(--dsw-alias-label-primary,#0f1115)}
.dfe-twisty.dfe-leaf{cursor:default}
.dfe-row-main{display:flex;align-items:center;gap:5px;flex:1 1 auto;min-width:0;height:22px;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;border-radius:var(--dsw-radius-xs,4px)}
.dfe-glyph{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:0 0 auto;color:var(--dsw-alias-label-tertiary,#81858c)}
.dfe-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfe-row.dfe-other .dfe-name{color:var(--dsw-alias-label-tertiary,#81858c)}
.dfe-row-actions{display:none;align-items:center;gap:0;flex:0 0 auto}
.dfe-row:hover .dfe-row-actions,.dfe-row:focus-within .dfe-row-actions{display:inline-flex}
.dfe-mini{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);background:none;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}
.dfe-mini:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.dfe-mini.dfe-danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger,#ec13130d);color:var(--dsw-alias-state-error-primary,#ec1313)}
.dfe-note{padding:1px 8px 1px 26px;font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c)}
.dfe-note.dfe-error{color:var(--dsw-alias-state-error-primary,#ec1313)}
.dfe-empty{padding:16px 12px;font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c);text-align:center}
.dfe-head{display:flex;align-items:center;gap:6px;flex:0 0 auto;padding:4px 6px 4px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-1,#fff)}
.dfe-head-path{flex:1;min-width:0;display:flex;align-items:center;gap:5px}
.dfe-head-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-primary,#0f1115)}
.dfe-dirty{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dfe-meta{flex:0 0 auto;padding:3px 10px;border-top:.5px solid var(--dsw-alias-border-l2,#0000001a);font-size:11px;color:var(--dsw-alias-label-tertiary,#81858c);display:flex;gap:8px}
.dfe-textarea{flex:1 1 auto;min-height:0;width:100%;border:0;outline-offset:-2px;resize:none;padding:8px 10px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12.5px;line-height:20px;tab-size:2;white-space:pre;overflow:auto}
.dfe-banner{display:flex;flex-direction:column;gap:6px;flex:0 0 auto;padding:8px 10px;background:var(--dsw-alias-state-warn-tertiary,#f59e0b1a);border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a)}
.dfe-banner-title{font-size:12px;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary,#b45309))}
.dfe-banner-body{font-size:11.5px;color:var(--dsw-alias-label-secondary,#61666b)}
.dfe-banner-actions{display:flex;gap:6px}
.dfe-notice{flex:0 0 auto;padding:6px 10px;font-size:12px;border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a);color:var(--dsw-alias-label-secondary,#61666b);background:var(--dsw-alias-bg-layer-2,#fff);word-break:break-word}
.dfe-notice.dfe-error{color:var(--dsw-alias-state-error-primary,#ec1313);background:var(--dsw-alias-interactive-bg-hover-danger,#ec13130d)}
.dfe-prompt{display:flex;align-items:center;gap:4px;padding:3px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2,#0000001a);background:var(--dsw-alias-bg-layer-2,#fff)}
.dfe-input{flex:1;min-width:0;height:26px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l4,#00000029);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:12px}
.dfe-input::placeholder{color:var(--dsw-alias-label-dimmed,#9aa0aa)}
.dfe-mask{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1,#0000003d)}
.dfe-dialog{width:min(360px,100%);padding:16px;border:.5px solid var(--dsw-alias-border-l3,#0000001f);border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:var(--dsw-elevation-prominent,0 8px 32px #0003);font-size:13px;color:var(--dsw-alias-label-primary,#0f1115)}
.dfe-dialog-body{margin:0 0 14px}
.dfe-dialog-actions{display:flex;justify-content:flex-end;gap:6px}
.dfe-title{display:inline-flex;align-items:center;gap:5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
        tag.dataset.plugin = 'file-editor';
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
      file: ['M4 1.5h5l3 3v10H4z', 'M9 1.5v3h3'],
      fileEdit: ['M4 1.5h5l3 3v4.2', 'M9 1.5v3h3', 'M11.6 8.4l2 2-4.6 4.6H7v-2z'],
      folder: ['M1.5 3.5h4.2l1.4 2H14.5v7.5h-13z'],
      chevronRight: ['M6 3.5l4.5 4.5L6 12.5'],
      chevronDown: ['M3.5 6L8 10.5 12.5 6'],
      plus: ['M8 3v10', 'M3 8h10'],
      folderPlus: ['M1.5 3.5h4.2l1.4 2H14.5v7.5h-13z', 'M8 8.5v3.5', 'M6.25 10.25h3.5'],
      refresh: ['M13.5 8a5.5 5.5 0 1 1-1.7-3.97', 'M13.5 2v3.2h-3.2'],
      pencil: ['M11.2 2.3l2.5 2.5-8.2 8.2H3v-2.5z', 'M9.6 3.9l2.5 2.5'],
      trash: ['M2.5 4.5h11', 'M6 4.5V2.5h4v2', 'M4 4.5l.8 9.5h6.4l.8-9.5'],
      x: ['M4 4l8 8', 'M12 4l-8 8'],
      check: ['M3 8.5l3.5 3.5L13 5'],
    };

    /**
     * One glyph, stroked with `currentColor` so it inherits its button's state.
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
     * Small shared helpers
     * ------------------------------------------------------------------ */

    /**
     * Join a parent and a child with the separator this tree uses everywhere.
     * @param parent - absolute parent path.
     * @param name - the child's basename.
     * @returns the absolute child path.
     */
    function joinPath(parent, name) {
      return `${String(parent).replace(/[/\\]+$/, '')}/${name}`;
    }

    /**
     * The parent directory of a path.
     * @param path - any path.
     * @returns its parent.
     */
    function parentOf(path) {
      const text = String(path ?? '');
      return text.slice(0, Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\')));
    }

    /**
     * The last segment of a path.
     * @param path - any path.
     * @returns its basename.
     */
    function baseName(path) {
      const parts = String(path ?? '').split(/[/\\]/).filter((part) => part.length > 0);
      return parts.length > 0 ? parts[parts.length - 1] : String(path ?? '');
    }

    /**
     * Format one byte count for the meta line.
     * @param bytes - the count, when known.
     * @returns the formatted size, or an empty string.
     */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * Split a failed command's `CODE: message` text.
     * @param text - the settled text.
     * @returns the stable code and the human-readable message.
     */
    function classify(text) {
      const match = /^([A-Z][A-Z0-9_]*):\s*([\s\S]*)$/.exec(String(text ?? ''));
      if (match === null) return { code: '', message: String(text ?? '') };
      return { code: match[1], message: match[2] };
    }

    /* ------------------------------------------------------------------ *
     * The Host command, and the reads that do not use it
     * ------------------------------------------------------------------ */

    /**
     * Run one `/editor` request and return its success line.
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
     * List one directory through the shipped workspace-files Remote.
     * @param remote - the client Remote face.
     * @param sessionId - the authorizing session.
     * @param path - the absolute directory.
     * @param signal - caller lifetime.
     * @returns `{ ok }` with entries, or the failure.
     */
    async function listDirectory(remote, sessionId, path, signal) {
      const result = await remote.workspaceFiles.list(sessionId, path, signal);
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, entries: result.value?.entries ?? [], truncated: result.value?.truncated === true };
    }

    /**
     * Stat one file through the shipped Remote.
     * @param remote - the client Remote face.
     * @param sessionId - the authorizing session.
     * @param path - the absolute file.
     * @returns `{ ok }` with the stat, or the failure.
     */
    async function statFile(remote, sessionId, path) {
      const result = await remote.workspaceFiles.stat(sessionId, path);
      if (!result.ok) return { ok: false, error: result.error };
      return { ok: true, value: result.value };
    }

    /**
     * Read a complete file and decode it as UTF-8.
     *
     * A file that is not valid UTF-8 is reported as binary rather than decoded
     * with replacement characters: silently corrupting a file on the next save
     * is worse than refusing to open it.
     *
     * @param remote - the client Remote face.
     * @param sessionId - the authorizing session.
     * @param path - the absolute file.
     * @returns `{ ok: true, text }` or `{ ok: false, reason }`.
     */
    async function readTextFile(remote, sessionId, path) {
      const result = await remote.workspaceFiles.readBytes(sessionId, path, {});
      if (!result.ok) {
        const code = result.error?.code ?? '';
        return {
          ok: false,
          reason: code === 'workspace-file/too-large' ? 'too-large' : 'failed',
          message: typeof result.error?.message === 'string' ? result.error.message : code,
        };
      }
      const data = result.value?.data;
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
      try {
        return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
      } catch {
        return { ok: false, reason: 'binary' };
      }
    }

    /* ------------------------------------------------------------------ *
     * Live updates
     * ------------------------------------------------------------------ */

    /**
     * Follow one file or one directory's direct entries.
     *
     * The subscription is one supervised Remote stream per path, the same shape
     * the shipped tree uses. A watch that cannot start only means this panel
     * stops updating by itself, so its failure is swallowed and the reload
     * control stays available.
     *
     * @param props - `{ remote, sessionId, path, onChange }`.
     * @returns nothing; it renders no element.
     */
    function WatchedPath({ remote, sessionId, path, onChange }) {
      const handler = useRef(onChange);
      handler.current = onChange;

      useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined;
        if (typeof path !== 'string' || path.length === 0) return undefined;
        let stopped = false;
        const stream = remote.$stream({
          name: `file-editor watch ${path}`,
          open: (lifetime) => remote.workspaceFiles.changes(sessionId, path, lifetime),
          ended: () => new Error(`the watch on ${path} ended`),
        });
        (async () => {
          try {
            for await (const item of stream) {
              if (stopped) return;
              if (item?.kind === 'ready') continue;
              handler.current?.();
            }
          } catch {
            // A watch is an optimization here, never a requirement.
          }
        })();
        return () => {
          stopped = true;
          try {
            stream.dispose();
          } catch {
            // Disposal races the iterator ending; either way the stream is gone.
          }
        };
      }, [remote, sessionId, path]);

      return null;
    }

    /** A module-level label the tab chip reads, so the chip can name the open file. */
    const titleState = { label: '', listeners: new Set() };

    /**
     * Publish the open file's name to the tab chip.
     * @param label - the new chip label, or an empty string for the fallback.
     */
    function publishTitle(label) {
      if (titleState.label === label) return;
      titleState.label = label;
      for (const listener of Array.from(titleState.listeners)) listener();
    }

    /**
     * Subscribe a component to the chip label.
     * @returns the current label.
     */
    function useTitleLabel() {
      return useSyncExternalStore(
        (listener) => {
          titleState.listeners.add(listener);
          return () => titleState.listeners.delete(listener);
        },
        () => titleState.label,
      );
    }

    /* ------------------------------------------------------------------ *
     * The tree
     * ------------------------------------------------------------------ */

    /**
     * Flatten the loaded levels into the rows to draw: directories first, then
     * entries by natural, case-insensitive name order, with a note row wherever a
     * level is loading, empty, failed or cut short.
     * @param levels - the per-path level state.
     * @param expanded - the expanded directory paths.
     * @param root - the tree's root path.
     * @returns the rows, each with its depth.
     */
    function flattenTree(levels, expanded, root) {
      const rows = [];
      if (typeof root !== 'string' || root.length === 0) return rows;

      const compare = (left, right) => {
        const leftDir = left.type === 'directory';
        const rightDir = right.type === 'directory';
        if (leftDir !== rightDir) return leftDir ? -1 : 1;
        return String(left.name).localeCompare(String(right.name), undefined, { numeric: true, sensitivity: 'base' });
      };

      const walk = (path, depth) => {
        const level = levels[path];
        if (level === undefined) return;
        if (level.status === 'loading' && level.entries === undefined) {
          rows.push({ kind: 'note', key: `${path}:loading`, depth, mode: 'loading' });
          return;
        }
        if (level.status === 'failed') {
          rows.push({ kind: 'note', key: `${path}:failed`, depth, mode: 'error', text: level.error });
          return;
        }
        const entries = Array.isArray(level.entries) ? level.entries : [];
        if (entries.length === 0) rows.push({ kind: 'note', key: `${path}:empty`, depth, mode: 'empty' });
        for (const entry of entries.slice().sort(compare)) {
          const child = joinPath(path, entry.name);
          const type = entry.type === 'directory' ? 'directory' : entry.type === 'file' ? 'file' : 'other';
          rows.push({ kind: 'entry', key: child, depth, path: child, name: entry.name, type });
          if (type === 'directory' && expanded.has(child)) walk(child, depth + 1);
        }
        if (level.truncated === true) rows.push({ kind: 'note', key: `${path}:truncated`, depth, mode: 'truncated' });
      };

      walk(root, 0);
      return rows;
    }

    /**
     * One tree row: a twisty, the entry, and the hover-revealed row actions.
     * @param props - the row, its selection, and the handlers the tree owns.
     * @returns the row element.
     */
    function TreeRow({ row, isActive, isSelected, isExpanded, onOpen, onToggle, onRename, onDelete, t }) {
      const indent = 4 + row.depth * 12;

      if (row.kind === 'note') {
        const text = row.mode === 'loading'
          ? t('label.loading')
          : row.mode === 'empty'
            ? t('label.empty')
            : row.mode === 'truncated'
              ? t('label.truncated')
              : t('error.read', { message: String(row.text ?? '') });
        return h('div', {
          className: `dfe-note${row.mode === 'error' ? ' dfe-error' : ''}`,
          style: { paddingLeft: indent + 18 },
        }, text);
      }

      const isDirectory = row.type === 'directory';
      const classes = [
        'dfe-row',
        isActive ? 'dfe-active' : '',
        isSelected ? 'dfe-selected' : '',
        row.type === 'other' ? 'dfe-other' : '',
      ].filter((value) => value.length > 0).join(' ');

      return h('div', {
        className: classes,
        style: { paddingLeft: indent },
        role: 'treeitem',
        'aria-expanded': isDirectory ? isExpanded : undefined,
        'aria-selected': isActive,
      },
        isDirectory
          ? h('button', {
            type: 'button',
            className: 'dfe-twisty',
            'aria-label': isExpanded ? 'collapse' : 'expand',
            onClick: () => onToggle(row.path),
          }, h(Icon, { name: isExpanded ? 'chevronDown' : 'chevronRight', size: 14 }))
          : h('span', { className: 'dfe-twisty dfe-leaf' }),
        h('button', {
          type: 'button',
          className: 'dfe-row-main',
          title: row.path,
          onClick: () => (isDirectory ? onToggle(row.path) : onOpen(row.path)),
        },
          h('span', { className: 'dfe-glyph' }, h(Icon, { name: isDirectory ? 'folder' : 'file', size: 15 })),
          h('span', { className: 'dfe-name' }, row.name)),
        h('span', { className: 'dfe-row-actions' },
          h('button', {
            type: 'button',
            className: 'dfe-mini',
            title: t('action.rename'),
            'aria-label': `${t('action.rename')} ${row.name}`,
            onClick: () => onRename(row),
          }, h(Icon, { name: 'pencil', size: 13 })),
          h('button', {
            type: 'button',
            className: 'dfe-mini dfe-danger',
            title: t('action.delete'),
            'aria-label': `${t('action.delete')} ${row.name}`,
            onClick: () => onDelete(row),
          }, h(Icon, { name: 'trash', size: 13 }))));
    }

    /* ------------------------------------------------------------------ *
     * The body
     * ------------------------------------------------------------------ */

    /**
     * The sidebar page: the workspace tree, and the editor for the open file.
     * @param props - the session-scoped slot props, the Remote face, and `t`.
     * @returns the page element.
     */
    function EditorBody({ remote, useSessions, sessionId, t }) {
      const root = useSessions((state) => state.byId[sessionId]?.cwd);

      const [levels, setLevels] = useState({});
      const [expanded, setExpanded] = useState(() => new Set());
      const [selectedDir, setSelectedDir] = useState(null);
      const [doc, setDoc] = useState(null);
      const [prompt, setPrompt] = useState(null);
      const [confirming, setConfirming] = useState(null);
      const [notice, setNotice] = useState(null);
      const [busy, setBusy] = useState(false);
      const [token, setToken] = useState(0);

      const alive = useRef(true);
      const refreshTimer = useRef(null);
      useEffect(() => () => {
        alive.current = false;
      }, []);

      /** Coalesce a burst of watch events into one reload. */
      const scheduleRefresh = useCallback(() => {
        if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
          refreshTimer.current = null;
          setToken((value) => value + 1);
        }, REFRESH_DEBOUNCE_MS);
      }, []);
      useEffect(() => () => {
        if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
      }, []);

      // A different session or workspace is a different tree: drop everything so
      // no row from the previous workspace can be acted on in the new one.
      useEffect(() => {
        setLevels({});
        setExpanded(new Set());
        setSelectedDir(null);
        setDoc(null);
        setPrompt(null);
        setConfirming(null);
        setNotice(null);
      }, [sessionId, root]);

      /** Fetch one directory level. */
      const loadLevel = useCallback(async (path) => {
        if (typeof path !== 'string' || path.length === 0) return;
        const result = await listDirectory(remote, sessionId, path);
        if (!alive.current) return;
        setLevels((prev) => ({
          ...prev,
          [path]: result.ok
            ? { status: 'ready', entries: result.entries, truncated: result.truncated }
            : { status: 'failed', error: result.error?.message ?? result.error?.code ?? 'failed' },
        }));
      }, [remote, sessionId]);

      /** Load the root and every expanded directory. */
      useEffect(() => {
        if (typeof root !== 'string' || root.length === 0) return;
        void loadLevel(root);
        for (const path of Array.from(expanded)) void loadLevel(path);
      }, [root, expanded, token, loadLevel]);

      /** Reload everything displayed, keeping what is on screen until it arrives. */
      const reload = useCallback(() => setToken((value) => value + 1), []);

      /** Expand a directory without collapsing it. */
      const expand = useCallback((path) => {
        setExpanded((prev) => {
          if (prev.has(path)) return prev;
          const next = new Set(prev);
          next.add(path);
          return next;
        });
      }, []);

      const rows = useMemo(() => flattenTree(levels, expanded, root), [levels, expanded, root]);
      const watchedPaths = useMemo(() => {
        if (typeof root !== 'string' || root.length === 0) return [];
        return [root, ...Array.from(expanded)];
      }, [root, expanded]);

      /** Open, or reload, one file into the editor. */
      const openFile = useCallback(async (path, announce) => {
        setNotice(null);
        setBusy(true);
        setDoc({ path, status: 'loading' });
        try {
          const stat = await statFile(remote, sessionId, path);
          if (stat.ok !== true) {
            if (alive.current) {
              setDoc(null);
              setNotice({
                kind: 'error',
                text: t('error.read', { message: stat.error?.message ?? stat.error?.code ?? 'failed' }),
              });
            }
            return;
          }
          const read = await readTextFile(remote, sessionId, path);
          if (!alive.current) return;
          if (read.ok !== true) {
            setDoc({ path, status: read.reason, message: read.message });
            return;
          }
          setDoc({
            path,
            status: 'ready',
            text: read.text,
            saved: read.text,
            version: stat.value?.version,
            bytes: stat.value?.bytes,
            external: false,
          });
          if (typeof announce === 'string' && announce.length > 0) setNotice({ kind: 'info', text: announce });
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [remote, sessionId, t]);

      /** Save the open file, or deliberately overwrite a file that changed underneath. */
      const save = useCallback(async (force) => {
        if (doc === null || doc.status !== 'ready') return;
        setBusy(true);
        setNotice(null);
        try {
          const payload = force === true
            ? { op: 'write', path: doc.path, content: doc.text, force: true }
            : { op: 'write', path: doc.path, content: doc.text, version: doc.version };
          const text = await runHost(remote, sessionId, payload);
          const stat = await statFile(remote, sessionId, doc.path);
          if (alive.current) {
            setDoc((prev) => (prev === null || prev.path !== doc.path ? prev : {
              ...prev,
              saved: prev.text,
              version: stat.ok === true ? stat.value?.version : prev.version,
              bytes: stat.ok === true ? stat.value?.bytes : prev.bytes,
              external: false,
            }));
            setNotice({ kind: 'info', text });
          }
          scheduleRefresh();
        } catch (error) {
          const { code, message } = classify(error?.message ?? String(error));
          if (!alive.current) return;
          if (code === 'STALE') {
            // Not a wall of text: the panel turns this into a choice.
            setDoc((prev) => (prev === null ? prev : { ...prev, external: true }));
          } else {
            setNotice({ kind: 'error', text: t('error.save', { message }) });
          }
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [remote, sessionId, doc, scheduleRefresh, t]);

      /** Update the open document's text. */
      const edit = useCallback((value) => {
        setDoc((prev) => (prev === null ? prev : { ...prev, text: value }));
      }, []);

      // Publish the open file's name to the tab chip.
      useEffect(() => {
        publishTitle(doc !== null && typeof doc.path === 'string' ? baseName(doc.path) : '');
      }, [doc?.path]);

      /** Reconcile the open document with the file on disk. */
      const syncFromDisk = useCallback(async () => {
        const current = doc;
        if (current === null || current.status !== 'ready') return;
        const stat = await statFile(remote, sessionId, current.path);
        if (!alive.current || stat.ok !== true) return;
        if (stat.value?.version === current.version) return;
        if (current.text === current.saved) {
          // Nothing of the user's is at stake: take the disk's copy.
          const read = await readTextFile(remote, sessionId, current.path);
          if (!alive.current || read.ok !== true) return;
          setDoc((prev) => (prev === null || prev.path !== current.path ? prev : {
            ...prev,
            text: read.text,
            saved: read.text,
            version: stat.value?.version,
            bytes: stat.value?.bytes,
            external: false,
          }));
          return;
        }
        setDoc((prev) => (prev === null || prev.path !== current.path ? prev : { ...prev, external: true }));
      }, [remote, sessionId, doc]);

      /** Toggle one directory, and treat it as the target for new entries. */
      const toggleDirectory = useCallback((path) => {
        setSelectedDir(path);
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
      }, []);

      /** Where a new entry goes: the selected directory, else the open file's, else the root. */
      const targetDir = selectedDir
        ?? (doc !== null && typeof doc.path === 'string' ? parentOf(doc.path) : null)
        ?? root;

      /** Submit the inline name prompt. */
      const submitPrompt = useCallback(async () => {
        if (prompt === null) return;
        const name = String(prompt.value ?? '').trim();
        if (name.length === 0) return;
        if (/[/\\]/.test(name)) {
          setNotice({ kind: 'error', text: t('error.separator') });
          return;
        }
        const base = prompt.parent;
        setBusy(true);
        setNotice(null);
        try {
          if (prompt.kind === 'new-file') {
            const path = joinPath(base, name);
            const text = await runHost(remote, sessionId, { op: 'write', path, content: '' });
            if (!alive.current) return;
            setPrompt(null);
            expand(base);
            reload();
            await openFile(path, text);
          } else if (prompt.kind === 'new-folder') {
            const path = joinPath(base, name);
            const text = await runHost(remote, sessionId, { op: 'mkdir', path });
            if (!alive.current) return;
            setPrompt(null);
            expand(base);
            reload();
            setNotice({ kind: 'info', text });
          } else {
            const to = joinPath(base, name);
            const text = await runHost(remote, sessionId, { op: 'rename', from: prompt.path, to });
            if (!alive.current) return;
            setPrompt(null);
            reload();
            // The editor follows the file it was showing.
            setDoc((prev) => (prev === null || prev.path !== prompt.path ? prev : { ...prev, path: to, external: false }));
            setNotice({ kind: 'info', text });
          }
        } catch (error) {
          if (alive.current) setNotice({ kind: 'error', text: classify(error?.message ?? String(error)).message });
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [remote, sessionId, prompt, expand, reload, openFile, t]);

      /** Delete the entry the confirmation names. */
      const confirmDelete = useCallback(async () => {
        if (confirming === null) return;
        setBusy(true);
        setNotice(null);
        try {
          const text = await runHost(remote, sessionId, {
            op: 'delete',
            path: confirming.path,
            recursive: confirming.isDirectory === true,
          });
          if (!alive.current) return;
          setConfirming(null);
          reload();
          setDoc((prev) => {
            if (prev === null || typeof prev.path !== 'string') return prev;
            return prev.path === confirming.path || prev.path.startsWith(`${confirming.path}/`) ? null : prev;
          });
          setNotice({ kind: 'info', text });
        } catch (error) {
          if (!alive.current) return;
          setConfirming(null);
          setNotice({ kind: 'error', text: classify(error?.message ?? String(error)).message });
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [remote, sessionId, confirming, reload]);

      // Escape cancels whichever transient surface is open. Capture phase, so the
      // sidebar's own handlers cannot swallow it first.
      useEffect(() => {
        if (prompt === null && confirming === null) return undefined;
        const onKey = (event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          if (confirming !== null) setConfirming(null);
          else setPrompt(null);
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
      }, [prompt, confirming]);

      if (typeof root !== 'string' || root.length === 0) {
        return h('div', { className: 'dfe-root' }, h('div', { className: 'dfe-empty' }, t('label.noWorkspace')));
      }

      const dirty = doc !== null && doc.status === 'ready' && doc.text !== doc.saved;
      const lineCount = doc !== null && doc.status === 'ready' ? doc.text.split('\n').length : 0;
      const relative = doc !== null && typeof doc.path === 'string'
        ? doc.path.slice(root.length).replace(/^[/\\]/, '') || baseName(doc.path)
        : '';

      return h('div', { className: 'dfe-root' },
        h('div', { className: 'dfe-bar' },
          h('button', {
            type: 'button',
            className: 'dfe-icon',
            title: t('action.newFile'),
            'aria-label': t('action.newFile'),
            disabled: busy,
            onClick: () => setPrompt({ kind: 'new-file', parent: targetDir, value: '' }),
          }, h(Icon, { name: 'plus', size: 15 })),
          h('button', {
            type: 'button',
            className: 'dfe-icon',
            title: t('action.newFolder'),
            'aria-label': t('action.newFolder'),
            disabled: busy,
            onClick: () => setPrompt({ kind: 'new-folder', parent: targetDir, value: '' }),
          }, h(Icon, { name: 'folderPlus', size: 15 })),
          h('button', {
            type: 'button',
            className: 'dfe-icon',
            title: t('action.refresh'),
            'aria-label': t('action.refresh'),
            disabled: busy,
            onClick: reload,
          }, h(Icon, { name: 'refresh', size: 15 })),
          h('span', { className: 'dfe-scope', title: targetDir }, t('label.into', { path: baseName(targetDir) || targetDir }))),

        prompt !== null
          ? h('div', { className: 'dfe-prompt' },
            h('input', {
              className: 'dfe-input',
              value: prompt.value,
              placeholder: prompt.kind === 'new-folder'
                ? t('placeholder.folderName')
                : prompt.kind === 'rename'
                  ? t('placeholder.name')
                  : t('placeholder.fileName'),
              autoFocus: true,
              disabled: busy,
              'aria-label': t('placeholder.name'),
              onChange: (event) => setPrompt((prev) => (prev === null ? prev : { ...prev, value: event.target.value })),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submitPrompt();
                }
              },
            }),
            h('button', { type: 'button', className: 'dfe-icon', title: t('action.confirm'), disabled: busy, onClick: () => void submitPrompt() }, h(Icon, { name: 'check', size: 15 })),
            h('button', { type: 'button', className: 'dfe-icon', title: t('action.cancel'), onClick: () => setPrompt(null) }, h(Icon, { name: 'x', size: 15 })))
          : null,

        notice !== null
          ? h('div', { className: `dfe-notice${notice.kind === 'error' ? ' dfe-error' : ''}` }, notice.text)
          : null,

        h('div', { className: 'dfe-main' },
          h('div', { className: `dfe-tree${doc !== null ? ' dfe-split' : ''}`, role: 'tree' },
            rows.map((row) => h(TreeRow, {
              key: row.key,
              row,
              t,
              isActive: row.kind === 'entry' && doc !== null && doc.path === row.path,
              isSelected: row.kind === 'entry' && row.type === 'directory' && selectedDir === row.path,
              isExpanded: row.kind === 'entry' && expanded.has(row.path),
              onOpen: (path) => void openFile(path),
              onToggle: toggleDirectory,
              onRename: (target) => setPrompt({ kind: 'rename', path: target.path, parent: parentOf(target.path), value: target.name }),
              onDelete: (target) => setConfirming({ path: target.path, name: target.name, isDirectory: target.type === 'directory' }),
            }))),

          doc !== null
            ? h('div', { className: 'dfe-editor' },
              h('div', { className: 'dfe-head' },
                h('span', { className: 'dfe-head-path' },
                  h('span', { className: 'dfe-glyph' }, h(Icon, { name: 'fileEdit', size: 14 })),
                  h('span', { className: 'dfe-head-name', title: doc.path }, relative)),
                dirty ? h('span', { className: 'dfe-dirty' }, t('label.unsaved')) : null,
                doc.status === 'ready'
                  ? h('button', {
                    type: 'button',
                    className: 'dfe-btn',
                    disabled: busy || !dirty,
                    onClick: () => setDoc((prev) => (prev === null ? prev : { ...prev, text: prev.saved, external: false })),
                  }, t('action.revert'))
                  : null,
                doc.status === 'ready'
                  ? h('button', {
                    type: 'button',
                    className: 'dfe-btn dfe-primary',
                    disabled: busy || !dirty,
                    onClick: () => void save(false),
                  }, t('action.save'))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'dfe-icon',
                  title: t('action.close'),
                  'aria-label': t('action.close'),
                  onClick: () => setDoc(null),
                }, h(Icon, { name: 'x', size: 15 }))),

              doc.status === 'ready' && doc.external === true
                ? h('div', { className: 'dfe-banner' },
                  h('div', { className: 'dfe-banner-title' }, t('conflict.title')),
                  h('div', { className: 'dfe-banner-body' }, t('conflict.body')),
                  h('div', { className: 'dfe-banner-actions' },
                    h('button', { type: 'button', className: 'dfe-btn dfe-primary', disabled: busy, onClick: () => void save(true) }, t('action.overwrite')),
                    h('button', {
                      type: 'button',
                      className: 'dfe-btn',
                      disabled: busy,
                      onClick: async () => {
                        const read = await readTextFile(remote, sessionId, doc.path);
                        const stat = await statFile(remote, sessionId, doc.path);
                        if (!alive.current || read.ok !== true) return;
                        setDoc((prev) => (prev === null ? prev : {
                          ...prev,
                          text: read.text,
                          saved: read.text,
                          version: stat.ok === true ? stat.value?.version : prev.version,
                          bytes: stat.ok === true ? stat.value?.bytes : prev.bytes,
                          external: false,
                        }));
                      },
                    }, t('action.reload'))))
                : null,

              doc.status === 'ready'
                ? h('textarea', {
                  className: 'dfe-textarea',
                  value: doc.text,
                  spellCheck: false,
                  'aria-label': relative,
                  onChange: (event) => edit(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Tab' && event.shiftKey !== true) {
                      event.preventDefault();
                      const element = event.target;
                      const start = element.selectionStart;
                      const end = element.selectionEnd;
                      edit(`${doc.text.slice(0, start)}  ${doc.text.slice(end)}`);
                      requestAnimationFrame(() => {
                        element.selectionStart = start + 2;
                        element.selectionEnd = start + 2;
                      });
                      return;
                    }
                    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                      event.preventDefault();
                      void save(false);
                    }
                  },
                })
                : h('div', { className: 'dfe-empty' },
                  doc.status === 'binary'
                    ? t('error.binary')
                    : doc.status === 'too-large'
                      ? t('error.tooLarge')
                      : doc.status === 'loading'
                        ? t('label.loading')
                        : t('error.failed')),

              doc.status === 'ready'
                ? h('div', { className: 'dfe-meta' },
                  h('span', null, t('label.lines', { n: lineCount })),
                  formatBytes(doc.bytes).length > 0 ? h('span', null, formatBytes(doc.bytes)) : null)
                : null)
            : null),

        watchedPaths.map((path) => h(WatchedPath, {
          key: `w:${path}`,
          remote,
          sessionId,
          path,
          onChange: scheduleRefresh,
        })),
        doc !== null && typeof doc.path === 'string'
          ? h(WatchedPath, {
            key: `f:${doc.path}`,
            remote,
            sessionId,
            path: doc.path,
            onChange: () => void syncFromDisk(),
          })
          : null,

        confirming !== null
          ? h('div', {
            className: 'dfe-mask',
            onPointerDown: (event) => {
              if (event.target === event.currentTarget) setConfirming(null);
            },
          },
            h('div', { className: 'dfe-dialog', role: 'dialog', 'aria-modal': 'true' },
              h('div', { className: 'dfe-dialog-body' },
                confirming.isDirectory === true
                  ? t('confirm.deleteFolder', { name: confirming.name })
                  : t('confirm.deleteFile', { name: confirming.name })),
              h('div', { className: 'dfe-dialog-actions' },
                h('button', { type: 'button', className: 'dfe-btn', onClick: () => setConfirming(null) }, t('action.cancel')),
                h('button', {
                  type: 'button',
                  className: 'dfe-btn dfe-primary',
                  disabled: busy,
                  onClick: () => void confirmDelete(),
                }, t('action.delete')))))
          : null);
    }

    /**
     * The tab chip: the open file's name, or the page's own name.
     * @param props - the session-scoped slot props plus the bound translator.
     * @returns the chip element.
     */
    function EditorTitle({ t }) {
      const label = useTitleLabel();
      return h('span', { className: 'dfe-title' },
        h(Icon, { name: 'fileEdit', size: 14 }),
        label.length > 0 ? label : t('title.fallback'));
    }

    /* ------------------------------------------------------------------ *
     * Registration
     * ------------------------------------------------------------------ */

    /**
     * Register the tab type, its seats, its dictionaries and its shortcut.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      /** Held once: the Remote face is stable, and the body receives it as a prop. */
      const remote = ctx.remote;

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'file-editor: dictionaries');
      ctx.effect(installStyles, 'file-editor: styles');

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        priority: 'extension',
        // The tree, the open file and an unsaved edit survive switching tabs.
        keepMounted: true,
        title: () => titleState.label || t('title.fallback'),
        guide: [{
          id: 'editor',
          order: 11,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
          icon: () => h('span', { style: { color: 'var(--dsw-alias-state-business-primary,#4176e6)' } }, h(Icon, { name: 'fileEdit', size: 16 })),
        }],
      }), 'file-editor: tab type');

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
        locale: NS,
      }, (props) => h(EditorBody, { ...props, remote }))), 'file-editor: tab body');

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: TAB_ID,
        locale: NS,
      }, EditorTitle)), 'file-editor: tab title');

      ctx.inject(['shortcuts'], (shortcutsCtx) => {
        shortcutsCtx.effect(() => shortcutsCtx.shortcuts.register({
          id: 'workspace.editor',
          label: () => t('guide.title'),
          aliases: ['workspace editor', 'edit files'],
          defaults: {
            'desktop:macos': { code: 'KeyE', modifiers: ['primary', 'shift'] },
            'desktop:windows': { code: 'KeyE', modifiers: ['primary', 'shift'] },
            'desktop:linux': { code: 'KeyE', modifiers: ['primary', 'shift'] },
            'web:macos': { code: 'KeyE', modifiers: ['primary', 'shift'] },
            'web:windows': { code: 'KeyE', modifiers: ['primary', 'shift'] },
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
        }), 'file-editor: shortcut');
      });
    }

    return {
      name: 'file-editor',
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles', 'remote.commands'],
      apply,
    };
  },
});
