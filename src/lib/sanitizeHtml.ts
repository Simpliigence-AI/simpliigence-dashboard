/**
 * Sanitizer for inbound email HTML.
 *
 * Ticket bodies come from `ticket_messages.body_html`, which desk-inbound
 * copies verbatim out of Microsoft Graph. Anyone who can email the desk
 * mailbox controls that string, so it is fully attacker-controlled and must
 * never reach `dangerouslySetInnerHTML` unsanitized.
 *
 * Two layers, on purpose:
 *   1. DOMPurify (the real path). Runs in the browser against a strict
 *      allowlist. Battle-tested upstream; this is what actually protects users.
 *   2. `fallbackSanitize` (this file). DOMPurify is a NO-OP when there is no
 *      DOM — `sanitize()` hands the input straight back and `isSupported` is
 *      false. That would be a silent hole in any non-browser context (SSR, a
 *      node script), so we detect it and run a dependency-free string
 *      tokenizer with the same allowlist instead. It is deliberately pure so
 *      it can be exercised outside a browser.
 *
 * Inline images arrive as `<img src="cid:...">`. Call `rewriteCidReferences`
 * BEFORE sanitizing: the sanitizer drops `cid:` (it resolves to nothing in a
 * browser), so any reference that was not matched to a stored attachment
 * disappears instead of rendering a broken image.
 *
 * Deliberate omissions: no `style` attribute and no `<style>` block (CSS is an
 * overlay/exfiltration surface and the drawer supplies its own typography), no
 * `data:` URL except a short list of raster image types (SVG is excluded even
 * though it is script-inert inside `<img>`), and no `class`/`id` so email CSS
 * can never collide with the app's own.
 */
import DOMPurify from 'dompurify';

/** Structural + inline tags an email body legitimately needs. */
export const ALLOWED_TAGS = [
  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li',
  'a', 'img', 'blockquote', 'pre', 'code', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
];

/** Everything else — including every `on*` handler — is dropped. */
export const ALLOWED_ATTR = ['href', 'src', 'alt', 'title'];

/** Elements dropped together with their contents (not unwrapped). */
const DROP_WITH_CONTENT = [
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form',
  'noscript', 'template', 'textarea', 'title', 'xmp', 'frame', 'frameset',
  'applet', 'base', 'link', 'meta', 'audio', 'video', 'canvas', 'select',
  'button', 'input', 'option',
];
const DROP_WITH_CONTENT_SET = new Set(DROP_WITH_CONTENT);

const VOID_TAGS = new Set(['br', 'img', 'hr']);

/** https/mailto/tel, plus data: for raster images only. */
const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|data:image\/(?:png|jpeg|jpg|gif|webp|bmp);)/i;

const ALLOWED_TAG_SET = new Set(ALLOWED_TAGS);
const ALLOWED_ATTR_SET = new Set(ALLOWED_ATTR);

function safeFromCodePoint(n: number): string {
  return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

/** Decode the entity forms a browser decodes inside an attribute value, so
 *  `javascript&#58;alert(1)` cannot smuggle a scheme past the check. */
function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    quot: '"', apos: "'", amp: '&', lt: '<', gt: '>',
    colon: ':', tab: '\t', newline: '\n', nbsp: ' ',
  };
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&(quot|apos|amp|lt|gt|colon|Tab|NewLine|nbsp);/gi,
      (_m, n: string) => named[n.toLowerCase()] ?? '');
}

/** Drop whitespace and C0/DEL control characters before a scheme check.
 *  Browsers ignore them inside a URL, so `java\tscript:` is a real payload. */
function stripBlankAndControl(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x20 || c === 0x7f) continue;
    out += ch;
  }
  return out;
}

/** True when a URL is safe to put in href/src. Whitespace and control
 *  characters are stripped first — `java\tscript:` is a real payload. */
export function isSafeUrl(raw: string): boolean {
  const v = stripBlankAndControl(decodeEntities(raw));
  if (!v) return false;
  return SAFE_URL.test(v);
}

function escapeText(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Decode-then-re-encode, so an entity-encoded payload cannot survive. */
function escapeAttr(s: string): string {
  return decodeEntities(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Index just past the `>` that closes the tag starting at `from`,
 *  respecting quoted attribute values (`<a title="a>b">`). */
function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 1; i < html.length; i++) {
    const c = html[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '>') return i + 1;
  }
  return html.length;
}

/** Skip a dropped element and everything inside it, counting nesting. */
function skipElement(html: string, tag: string, afterOpen: number): number {
  const open = new RegExp(`<\\s*${tag}\\b`, 'gi');
  const close = new RegExp(`<\\s*/\\s*${tag}\\b`, 'gi');
  let depth = 1;
  let i = afterOpen;
  while (i < html.length && depth > 0) {
    open.lastIndex = i;
    close.lastIndex = i;
    const o = open.exec(html);
    const c = close.exec(html);
    if (!c) return html.length;
    if (o && o.index < c.index) { depth += 1; i = o.index + o[0].length; continue; }
    depth -= 1;
    i = findTagEnd(html, c.index);
  }
  return i;
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

function sanitizeAttrs(tag: string, rawTag: string): string {
  // Everything between the tag name and the closing `>` / `/>`.
  const inner = rawTag.replace(/^<\s*[a-zA-Z][a-zA-Z0-9:-]*/, '').replace(/\/?>$/, '');
  const out: string[] = [];
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null = ATTR_RE.exec(inner);
  for (; m !== null; m = ATTR_RE.exec(inner)) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (name.startsWith('on')) continue;               // every handler, no exceptions
    if (!ALLOWED_ATTR_SET.has(name)) continue;
    if (name === 'href' && tag !== 'a') continue;
    if (name === 'src' && tag !== 'img') continue;
    if ((name === 'href' || name === 'src') && !isSafeUrl(value)) continue;
    out.push(`${name}="${escapeAttr(value)}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

/**
 * Dependency-free strict-allowlist sanitizer. Used when DOMPurify has no DOM
 * to work with; also the unit-testable half of this module.
 */
export function fallbackSanitize(html: string): string {
  const out: string[] = [];
  const openStack: string[] = [];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out.push(escapeText(html.slice(i))); break; }
    if (lt > i) out.push(escapeText(html.slice(i, lt)));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end < 0 ? html.length : end + 1;
      continue;
    }

    // HTML's tag-open state requires an ASCII letter immediately after `<`
    // (or after `</`). Anything else — `a < b` — is text, not a tag.
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 96));
    if (!m) { out.push('&lt;'); i = lt + 1; continue; }

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const tagEnd = findTagEnd(html, lt);
    const rawTag = html.slice(lt, tagEnd);

    if (DROP_WITH_CONTENT_SET.has(tag)) {
      i = (closing || rawTag.endsWith('/>') || VOID_TAGS.has(tag))
        ? tagEnd
        : skipElement(html, tag, tagEnd);
      continue;
    }

    if (!ALLOWED_TAG_SET.has(tag)) { i = tagEnd; continue; } // unwrap: drop tag, keep text

    if (closing) {
      const at = openStack.lastIndexOf(tag);
      if (at !== -1) {
        for (let k = openStack.length - 1; k >= at; k--) out.push(`</${openStack[k]}>`);
        openStack.length = at;
      }
      i = tagEnd;
      continue;
    }

    const attrs = sanitizeAttrs(tag, rawTag);
    if (VOID_TAGS.has(tag)) {
      out.push(`<${tag}${attrs} />`);
    } else if (rawTag.endsWith('/>')) {
      out.push(`<${tag}${attrs}></${tag}>`);
    } else {
      out.push(`<${tag}${attrs}>`);
      openStack.push(tag);
    }
    i = tagEnd;
  }

  for (let k = openStack.length - 1; k >= 0; k--) out.push(`</${openStack[k]}>`);
  return out.join('');
}

/**
 * Force every surviving link to open safely — `fallbackSanitize` output ONLY.
 *
 * That output escapes `<` to `&lt;` in every attribute value (`escapeAttr`) and
 * in every text node (`escapeText`), so the only `<a` left in the string is an
 * anchor tag this file emitted itself, and the substitution is unambiguous.
 *
 * It must NEVER be run over DOMPurify's output. HTML serialization does not
 * escape `<` inside an attribute value, so a sender's
 * `<a title="x<a onmouseover=alert(1) y">` survives sanitizing intact; matching
 * that inner `<a ` and inserting `target="_blank" rel="..."` there closes the
 * `title` value early and hands the remainder of the sender's own value to the
 * parser as attributes — event handler included. The DOMPurify path uses
 * `installDomPurifyHooks` instead, which sets the attributes on parsed nodes
 * where quoting cannot be confused.
 */
function hardenLinks(html: string): string {
  return html.replace(/<a(\s|>)/gi, '<a target="_blank" rel="noopener noreferrer nofollow"$1');
}

/**
 * The DOMPurify equivalent of `hardenLinks`, installed once.
 *
 * `afterSanitizeAttributes` runs at the end of DOMPurify's own per-node
 * attribute pass, so what it sets here is final and is not re-filtered by
 * FORBID_ATTR (which is still what strips whatever `target`/`rel` the sender
 * supplied). Working on nodes rather than on serialized text is the point.
 *
 * It also re-checks href/src against SAFE_URL: DOMPurify allows ANY `data:`
 * URL on `img` regardless of ALLOWED_URI_REGEXP — its DATA_URI_TAGS escape
 * hatch, which no config option can switch off — while this file's policy
 * allows only the raster types in SAFE_URL. That keeps the two sanitizers'
 * URL policy identical.
 */
let domPurifyHooksInstalled = false;
function installDomPurifyHooks(): void {
  if (domPurifyHooksInstalled) return;
  domPurifyHooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (typeof node.getAttribute !== 'function') return;
    for (const name of ['href', 'src']) {
      const value = node.getAttribute(name);
      if (value !== null && !isSafeUrl(value)) node.removeAttribute(name);
    }
    if (node.nodeName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
}

/**
 * Sanitize attacker-controlled email HTML. Always call this before handing a
 * string to `dangerouslySetInnerHTML`.
 */
export function sanitizeEmailHtml(html: string | null | undefined): string {
  if (!html) return '';
  // DOMPurify silently passes input through when it cannot find a DOM, so the
  // fallback is not an optimisation — it is the only safe branch there.
  // `hardenLinks` is applied to the fallback's output only; the DOMPurify path
  // hardens on nodes instead, because a string rewrite of its serialized
  // output is an attribute-injection hole (see `hardenLinks`).
  if (!DOMPurify.isSupported) return hardenLinks(fallbackSanitize(html));
  installDomPurifyHooks();
  return String(DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: SAFE_URL,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORBID_TAGS: DROP_WITH_CONTENT,
    FORBID_ATTR: ['style', 'class', 'id', 'target', 'rel'],
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
    RETURN_TRUSTED_TYPE: false,
  }));
}

/**
 * Replace `src="cid:<content-id>"` with a real URL for the matching stored
 * attachment. Keys may be given with or without the angle brackets Graph
 * reports (`<abc@01D>`); lookups are case-insensitive.
 *
 * Run this BEFORE `sanitizeEmailHtml` — unmatched `cid:` references are then
 * dropped by the sanitizer instead of rendering as broken images.
 */
export function rewriteCidReferences(html: string, cidToUrl: Record<string, string>): string {
  if (!html) return '';
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(cidToUrl)) {
    if (!k || !v) continue;
    lookup.set(k.replace(/^<|>$/g, '').trim().toLowerCase(), v);
  }
  if (lookup.size === 0) return html;
  return html.replace(
    /(\ssrc\s*=\s*)("|')\s*cid:([^"']*)\2/gi,
    (whole: string, prefix: string, quote: string, cid: string) => {
      const url = lookup.get(decodeEntities(cid).replace(/^<|>$/g, '').trim().toLowerCase());
      return url ? `${prefix}${quote}${escapeAttr(url)}${quote}` : whole;
    },
  );
}
