/**
 * Small Markdown → HTML for AI-generated project documents and summaries:
 * headings, paragraphs, bullet/numbered lists, tables, code blocks, bold,
 * italics, inline code and links. Output is sanitised with DOMPurify.
 */
import DOMPurify from 'dompurify';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1;
      out.push(`<pre data-lang="${esc(lang)}"><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i += 1; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i += 1; }
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, ''));
        i += 1;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (!line.trim()) { i += 1; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*[-*]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i])) { para.push(lines[i]); i += 1; }
    if (!para.length) { para.push(line); i += 1; }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return DOMPurify.sanitize(out.join('\n'), { ADD_ATTR: ['target'] });
}

/** Tailwind classes that make rendered Markdown readable inside a card. */
export const proseClass =
  'text-sm text-ink leading-relaxed [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-3 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-5 [&_h2]:mb-2 ' +
  '[&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 ' +
  '[&_table]:w-full [&_table]:my-3 [&_table]:text-xs [&_th]:text-left [&_th]:font-semibold [&_th]:border-b [&_th]:border-line [&_th]:px-2 [&_th]:py-1.5 ' +
  '[&_td]:border-b [&_td]:border-line/50 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_pre]:bg-surface-2 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto ' +
  '[&_code]:font-mono [&_code]:text-[0.85em] [&_a]:text-primary [&_a]:underline';
