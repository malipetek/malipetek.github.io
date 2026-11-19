/*
 * A small, deliberately limited Markdown reader for text the app did not write
 * (agent reports, run summaries). It returns data, never HTML, so callers build
 * React elements and React escapes every string: unclosed markers, HTML tags
 * and links stay plain text instead of becoming markup.
 *
 * Supported blocks: paragraphs, "- " / "* " / "+ " bullet lists, "1." ordered
 * lists, ATX headings and ``` fenced code. Supported inline: `code`, **bold**,
 * *emphasis*, [label](url) and <https://…> autolinks. Links are reported as a
 * label plus a URL and are meant to be shown as text, not followed from here.
 */

const MAX_INLINE_DEPTH = 4;

/**
 * Split Markdown inline text into spans: `text`, `strong`, `em`, `code` and
 * `link` (`{ href, spans }`). Unpaired markers stay literal text.
 */
export function markdownInline(input, depth = 0) {
  const text = String(input ?? '');
  if (!text) return [];
  if (depth >= MAX_INLINE_DEPTH) return [{ type: 'text', text }];
  // A fresh RegExp per call: recursive inline parsing must not disturb the
  // outer scan's lastIndex. Token order matters: code, bold, emphasis, links.
  const token = /`([^`\n]+)`|\*\*([^\s*](?:[^*\n]*[^\s*])?)\*\*|\*([^\s*](?:[^*\n]*[^\s*])?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)|<((?:https?|mailto):[^>\s]+)>|\\([\\`*_[\]()<>])/g;
  const spans = [];
  const pushText = (value) => {
    if (!value) return;
    const last = spans[spans.length - 1];
    if (last?.type === 'text') last.text += value;
    else spans.push({ type: 'text', text: value });
  };
  let match;
  let at = 0;
  while ((match = token.exec(text))) {
    pushText(text.slice(at, match.index));
    at = token.lastIndex;
    const [, code, strong, em, label, href, autolink, escaped] = match;
    if (code != null) spans.push({ type: 'code', text: code });
    else if (strong != null) spans.push({ type: 'strong', spans: markdownInline(strong, depth + 1) });
    else if (em != null) spans.push({ type: 'em', spans: markdownInline(em, depth + 1) });
    else if (label != null) spans.push({ type: 'link', href: href ?? '', spans: markdownInline(label, depth + 1) });
    else if (autolink != null) spans.push({ type: 'link', href: autolink, spans: [{ type: 'text', text: autolink }] });
    else if (escaped != null) pushText(escaped);
    else pushText(match[0]);
  }
  pushText(text.slice(at));
  return spans;
}

const LIST_ITEM = /^\s{0,3}(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}```([\w-]*)\s*$/;

/**
 * Parse Markdown into blocks the evidence view can render:
 * `{type:'paragraph',spans}`, `{type:'heading',level,spans}`,
 * `{type:'list',ordered,items:[{spans}]}` and `{type:'code',lang,text}`.
 */
export function markdownBlocks(input) {
  const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    blocks.push({ type: 'paragraph', spans: markdownInline(paragraph.join(' ')) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const body = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: 'code', lang: fence[1] || null, text: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length, spans: markdownInline(heading[2]) });
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) {
      flush();
      const ordered = item[2] != null;
      const last = blocks[blocks.length - 1];
      const target = last?.type === 'list' && last.ordered === ordered ? last : null;
      if (target) target.items.push({ spans: markdownInline(item[3]) });
      else blocks.push({ type: 'list', ordered, items: [{ spans: markdownInline(item[3]) }] });
      continue;
    }
    // A quote is a paragraph that keeps its text; the marker adds nothing here.
    paragraph.push(line.replace(/^\s{0,3}>\s?/, ''));
  }
  flush();
  return blocks;
}
