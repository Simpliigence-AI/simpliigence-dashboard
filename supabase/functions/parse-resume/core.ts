/**
 * Shared resume-parsing core for parse-resume (prod) and parse-resume-eval.
 *
 * Cost levers (v40):
 *  1. PDFs are converted to text server-side (unpdf) and sent as text. Sending
 *     the PDF as a `document` block bills every page as an image PLUS its text,
 *     typically 3–5x the tokens. The document block is kept only as a fallback
 *     for scanned / image-only PDFs where no text layer exists.
 *  2. Claude Haiku 4.5 is the primary model ($1/$5 per MTok vs Sonnet's $3/$15).
 *     Sonnet is used only if Haiku's answer is unusable (bad JSON, no identity,
 *     no skills).
 *  3. Content-hash cache: identical file bytes are never sent to Claude twice
 *     (re-uploads, duplicates, "Retry", "Update existing with this resume").
 *  4. Text capped at 24k chars — identity + skills live at the top; the tail of
 *     very long CVs is project detail that only costs tokens.
 */

// @ts-expect-error esm.sh — JSZip for in-memory DOCX text extraction
import JSZip from 'https://esm.sh/jszip@3.10.1';
// @ts-expect-error npm specifier resolved by the Deno edge runtime
import { getDocumentProxy } from 'npm:unpdf@0.12.1';

/** Bump when extraction/prompt changes so the hash cache doesn't serve stale parses. */
export const PARSER_VERSION = 'v41';
export const HAIKU = 'claude-haiku-4-5';
export const SONNET = 'claude-sonnet-4-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TEXT_CHARS = 24000;

/** USD per million tokens. */
const PRICE: Record<string, { in: number; out: number }> = {
  [HAIKU]: { in: 1, out: 5 },
  [SONNET]: { in: 3, out: 15 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function costUsd(model: string, u: Usage): number {
  const p = PRICE[model] ?? PRICE[SONNET];
  const cw = u.cache_creation_input_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  return (u.input_tokens * p.in + cw * p.in * 1.25 + cr * p.in * 0.1 + u.output_tokens * p.out) / 1e6;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ───────────────────────────── text extraction ───────────────────────────── */

export async function pdfToText(buf: ArrayBuffer): Promise<{ text: string; pages: number; links: string[] }> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf.slice(0)));
    const pages: string[] = [];
    const links: string[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      // LinkedIn / email / phone are often clickable links whose visible text is just
      // "LinkedIn" — the URL only exists in the link annotation, not the text layer.
      try {
        // deno-lint-ignore no-explicit-any
        const ann = await page.getAnnotations() as any[];
        for (const a of ann) if (typeof a?.url === 'string') links.push(a.url);
      } catch { /* ignore */ }
      const tc = await page.getTextContent();
      let out = '';
      let lastY: number | null = null;
      let lastXEnd: number | null = null;
      // deno-lint-ignore no-explicit-any
      for (const it of tc.items as any[]) {
        if (typeof it.str !== 'string') continue;
        const x = Array.isArray(it.transform) ? it.transform[4] : null;
        const y = Array.isArray(it.transform) ? Math.round(it.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          if (!out.endsWith('\n')) out += '\n';
        } else if (lastXEnd !== null && x !== null && x - lastXEnd > 1.5 && !/\s$/.test(out) && !/^\s/.test(it.str)) {
          out += ' '; // visual gap between items on the same line
        }
        out += it.str;
        if (it.hasEOL) out += '\n';
        if (y !== null) lastY = y;
        lastXEnd = x !== null && typeof it.width === 'number' ? x + it.width : null;
      }
      pages.push(out);
    }
    const t = pages.join('\n\n')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text: t, pages: pdf.numPages, links };
  } catch (e) {
    console.warn('[parse-resume] pdfToText failed:', (e as Error).message);
    return { text: '', pages: 0, links: [] };
  }
}

/** A text layer is usable if it has enough letters and isn't mostly garbage glyphs. */
export function usableText(t: string): boolean {
  if (!t || t.length < 200) return false;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  return letters / t.length > 0.4;
}

/** External hyperlink targets from a .docx (word/_rels/document.xml.rels). */
export async function docxLinks(buf: ArrayBuffer): Promise<string[]> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const rels = await zip.file('word/_rels/document.xml.rels')?.async('string');
    if (!rels) return [];
    return [...rels.matchAll(/Target="([^"]+)"[^>]*TargetMode="External"|TargetMode="External"[^>]*Target="([^"]+)"/g)]
      .map((m) => (m[1] || m[2]).replace(/&amp;/g, '&'));
  } catch { return []; }
}

export async function docxToText(buf: ArrayBuffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) return '';
    return docXml
      .split(/<\/w:p>/i)
      .map((para: string) => para
        .replace(/<w:tab\b[^>]*\/?>/gi, '\t')
        .replace(/<w:br\b[^>]*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ''))
      .join('\n')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .trim();
  } catch (e) {
    console.warn('[parse-resume] docxToText failed:', (e as Error).message);
    return '';
  }
}

function cfbStreams(buf: ArrayBuffer): Map<string, Uint8Array> {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!sig.every((b, i) => u8[i] === b)) throw new Error('not a compound file');
  const secSize = 1 << dv.getUint16(0x1e, true);
  const miniSize = 1 << dv.getUint16(0x20, true);
  const nFat = dv.getUint32(0x2c, true);
  const firstDir = dv.getUint32(0x30, true);
  const cutoff = dv.getUint32(0x38, true);
  const firstMiniFat = dv.getUint32(0x3c, true);
  let difatSec = dv.getUint32(0x44, true);
  const secOff = (s: number) => (s + 1) * secSize;
  const fatSecs: number[] = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(0x4c + i * 4, true));
  let guard = 0;
  while (fatSecs.length < nFat && difatSec < 0xfffffffa && guard++ < 10000) {
    const o = secOff(difatSec);
    for (let i = 0; i < secSize / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(o + i * 4, true));
    difatSec = dv.getUint32(o + secSize - 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSecs) {
    const o = secOff(s);
    for (let i = 0; i < secSize / 4; i++) fat.push(o + i * 4 + 4 <= u8.length ? dv.getUint32(o + i * 4, true) : 0xfffffffe);
  }
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    let s = start;
    while (s < 0xfffffffa && out.length < table.length + 1) { out.push(s); s = table[s]; }
    return out;
  };
  const readChain = (start: number) => {
    const secs = chain(start, fat);
    const out = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => out.set(u8.subarray(secOff(s), secOff(s) + secSize), i * secSize));
    return out;
  };
  const dir = readChain(firstDir);
  const ddv = new DataView(dir.buffer);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = ddv.getUint16(o + 0x40, true);
    let name = '';
    for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({ name, type: dir[o + 0x42], start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
  }
  const root = entries.find((e) => e.type === 5);
  const miniStream = root ? readChain(root.start) : new Uint8Array(0);
  const miniFat: number[] = [];
  if (firstMiniFat < 0xfffffffa) {
    const mf = readChain(firstMiniFat);
    const mdv = new DataView(mf.buffer);
    for (let i = 0; i < mf.length / 4; i++) miniFat.push(mdv.getUint32(i * 4, true));
  }
  const streams = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.type !== 2) continue;
    if (e.size < cutoff) {
      const secs = chain(e.start, miniFat);
      const out = new Uint8Array(secs.length * miniSize);
      secs.forEach((s, i) => out.set(miniStream.subarray(s * miniSize, s * miniSize + miniSize), i * miniSize));
      streams.set(e.name, out.subarray(0, e.size));
    } else {
      streams.set(e.name, readChain(e.start).subarray(0, e.size));
    }
  }
  return streams;
}

const CP1252: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰',
  0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

function cleanWordText(s: string): string {
  return s
    .replace(/\x13[^\x13\x14\x15]*\x14/g, '')
    .replace(/\x13[^\x13\x14\x15]*\x15/g, '')
    .replace(/[\x14\x15]/g, '')
    .replace(/\x07/g, '\t')
    .replace(/[\r\x0b\x0c]/g, '\n')
    .replace(/[\x00-\x08\x0e-\x1f]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function docPieceTableText(buf: ArrayBuffer): string {
  const streams = cfbStreams(buf);
  const wd = streams.get('WordDocument');
  if (!wd || wd.length < 0x1aa) throw new Error('no WordDocument stream');
  const wdv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  if (wdv.getUint16(0, true) !== 0xa5ec) throw new Error('bad FIB');
  const flags = wdv.getUint16(0x0a, true);
  if (flags & 0x0100) throw new Error('encrypted');
  const table = streams.get(flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new Error('no table stream');
  const fcClx = wdv.getUint32(0x1a2, true);
  const lcbClx = wdv.getUint32(0x1a6, true);
  const tdv = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let p = fcClx;
  const end = fcClx + lcbClx;
  while (p < end && table[p] === 0x01) p += 3 + tdv.getInt16(p + 1, true);
  if (table[p] !== 0x02) throw new Error('no Pcdt');
  const lcb = tdv.getUint32(p + 1, true);
  const plc = p + 5;
  const n = (lcb - 4) / 12;
  let out = '';
  for (let i = 0; i < n; i++) {
    const cpStart = tdv.getUint32(plc + i * 4, true);
    const cpEnd = tdv.getUint32(plc + (i + 1) * 4, true);
    const pcd = plc + (n + 1) * 4 + i * 8;
    const fcRaw = tdv.getUint32(pcd + 2, true);
    const len = cpEnd - cpStart;
    if (fcRaw & 0x40000000) {
      const fc = (fcRaw & 0x3fffffff) / 2;
      for (let j = 0; j < len && fc + j < wd.length; j++) {
        const b = wd[fc + j];
        out += CP1252[b] ?? String.fromCharCode(b);
      }
    } else {
      for (let j = 0; j < len && fcRaw + j * 2 + 1 < wd.length; j++) out += String.fromCharCode(wdv.getUint16(fcRaw + j * 2, true));
    }
  }
  lastDocLinks = [...out.matchAll(/HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/g)].map((m) => m[1]);
  return cleanWordText(out);
}
let lastDocLinks: string[] = [];

function scrapePrintable(u8: Uint8Array): string {
  const runs: string[] = [];
  let cur = '';
  for (let i = 0; i < u8.length; i++) {
    const b = u8[i];
    if ((b >= 0x20 && b < 0x7f) || b === 0x09) cur += String.fromCharCode(b);
    else { if (cur.length >= 4) runs.push(cur); cur = ''; }
  }
  if (cur.length >= 4) runs.push(cur);
  cur = '';
  for (let i = 0; i + 1 < u8.length; i += 2) {
    const c = u8[i] | (u8[i + 1] << 8);
    if (c >= 0x20 && c < 0xd800 && c !== 0xfffd) cur += String.fromCharCode(c);
    else { if (cur.length >= 4) runs.push(cur); cur = ''; }
  }
  if (cur.length >= 4) runs.push(cur);
  return runs.join('\n');
}

export function rtfToText(rtf: string): string {
  let s = rtf;
  const dropGroup = (re: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      let depth = 0; let i = m.index;
      for (; i < s.length; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '{') depth++;
        else if (s[i] === '}') { depth--; if (depth === 0) break; }
      }
      s = s.slice(0, m.index) + s.slice(i + 1);
      re.lastIndex = m.index;
    }
  };
  dropGroup(/\{\\\*/g);
  dropGroup(/\{\\(fonttbl|colortbl|stylesheet|info|pict|listtable|listoverridetable)\b/g);
  return s
    .replace(/\\u(-?\d+) ?(?:\\'[0-9a-f]{2}|\?)?/gi, (_, n) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => { const b = parseInt(h, 16); return CP1252[b] ?? String.fromCharCode(b); })
    .replace(/\\(par|line|row)\b ?/g, '\n')
    .replace(/\\(tab|cell)\b ?/g, '\t')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/\\([{}\\])/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

type Sniffed = 'pdf' | 'zip' | 'ole' | 'rtf' | 'html' | 'text' | 'unknown';
export function sniff(u8: Uint8Array): Sniffed {
  const head = new TextDecoder('latin1').decode(u8.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('%pdf')) return 'pdf';
  if (u8[0] === 0x50 && u8[1] === 0x4b) return 'zip';
  if (u8[0] === 0xd0 && u8[1] === 0xcf && u8[2] === 0x11 && u8[3] === 0xe0) return 'ole';
  if (head.startsWith('{\\rtf')) return 'rtf';
  if (head.startsWith('<') || head.includes('<html') || head.startsWith('mime-version')) return 'html';
  const sample = u8.subarray(0, 2048);
  let bad = 0;
  for (const b of sample) if (b < 0x09 || (b > 0x0d && b < 0x20)) bad++;
  return sample.length && bad / sample.length < 0.02 ? 'text' : 'unknown';
}

export function docToText(buf: ArrayBuffer): string {
  try {
    const t = docPieceTableText(buf);
    if (t.length >= 30) return t;
  } catch (e) {
    console.warn('[parse-resume] .doc piece-table read failed, scraping:', (e as Error).message);
  }
  return scrapePrintable(new Uint8Array(buf)).slice(0, 60000);
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  // @ts-expect-error btoa is global
  return btoa(binary);
}

/* ───────────────────────────── links + deterministic backstops ───────────────────────────── */

export function cleanLinks(raw: string[]): string[] {
  const out = new Set<string>();
  for (let l of raw) {
    l = (l || '').trim();
    if (!/^(https?:|mailto:|tel:|www\.)/i.test(l) && !/linkedin\.com/i.test(l)) continue;
    out.add(l.slice(0, 300));
  }
  return [...out].slice(0, 25);
}

const LI_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%.]+)/i;
/** First linkedin.com/in/<slug> in the links or text, normalised. */
export function findLinkedIn(text: string, links: string[]): string | undefined {
  for (const src of [...links, text]) {
    const m = src.match(LI_RE);
    if (m) return `https://www.linkedin.com/in/${m[1].replace(/[.\/]+$/, '')}`;
  }
  return undefined;
}

const PHONE_RES = [
  /(?:\+|00)\s?91[\s.-]*\(?0?\)?[6-9](?:[\s.-]?\d){9}(?!\d)/, // +91 98765 43210 / +91-987-654-3210
  /(?<![\d.+])0?[6-9](?:[\s.-]?\d){9}(?![\d])/,             // 98765 43210 / 9876543210
  /(?:\+1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/,   // (415) 555-2200
  /\+\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}/,               // other intl
];
/** Phone from tel: links, else the first plausible number in the header or the last section. */
export function findPhone(text: string, links: string[]): string | undefined {
  const tel = links.find((l) => /^tel:/i.test(l));
  if (tel) return decodeURIComponent(tel.slice(4)).trim();
  const zones = [text.slice(0, 3000), text.slice(-3000)];
  for (const z of zones) for (const re of PHONE_RES) {
    const m = z.match(re);
    if (m && m[0].replace(/\D/g, '').length >= 10) return m[0].trim();
  }
  return undefined;
}

/* ───────────────────────────── build Claude input ───────────────────────────── */

export type Source = 'pdf_text' | 'pdf_document' | 'docx' | 'doc' | 'rtf' | 'html' | 'text';

export interface BuiltInput {
  source: Source;
  pages?: number;
  chars?: number;
  content: unknown;
  /** Plain text sent (or '' for scanned PDFs) and embedded hyperlinks — used by the backstops. */
  text: string;
  links: string[];
}

export class UnreadableError extends Error {}

/** Long CVs: keep the head (identity, current role) AND the tail — Indian resumes
 *  often put phone/address in a "Personal Details" block at the very end. */
function clip(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS - 5000)}\n\n[… middle of resume omitted …]\n\n${text.slice(-5000)}`;
}
const linksBlock = (links: string[]) => (links.length ? `Hyperlinks embedded in the document (URLs behind clickable text — check these for LinkedIn / email / phone):\n${links.join('\n')}\n\n` : '');
const asText = (label: string, text: string, links: string[] = []) => [
  { type: 'text', text: `${linksBlock(links)}Resume text follows (extracted from ${label}). Parse per the instructions and return the JSON.\n\n---\n${clip(text)}` },
];

/** Returns Claude user content. `forceDocument` = legacy path (PDF as document block), eval only. */
export async function buildInput(buf: ArrayBuffer, fileName: string, mime: string, forceDocument = false): Promise<BuiltInput> {
  const u8 = new Uint8Array(buf);
  const kind = sniff(u8);
  const tooShort = (t: string) => !t || t.trim().length < 30;
  const isPdf = kind === 'pdf' || (kind === 'unknown' && (mime === 'application/pdf' || fileName.endsWith('.pdf')));

  if (isPdf) {
    const { text, pages, links: rawLinks } = forceDocument ? { text: '', pages: 0, links: [] as string[] } : await pdfToText(buf);
    const links = cleanLinks(rawLinks);
    if (!forceDocument && usableText(text)) return { source: 'pdf_text', pages, chars: text.length, content: asText('PDF', text, links), text, links };
    return {
      source: 'pdf_document',
      text: '', links,
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(buf) } },
        { type: 'text', text: `${linksBlock(links)}Parse this resume per the instructions and return the JSON.` },
      ],
    };
  }
  if (kind === 'zip') {
    const t = await docxToText(buf);
    if (tooShort(t)) throw new UnreadableError('.docx');
    const links = cleanLinks(await docxLinks(buf));
    return { source: 'docx', chars: t.length, content: asText('.docx', t, links), text: t, links };
  }
  if (kind === 'ole') {
    lastDocLinks = [];
    const t = docToText(buf);
    if (tooShort(t)) throw new UnreadableError('.doc');
    const links = cleanLinks(lastDocLinks);
    return { source: 'doc', chars: t.length, content: asText('legacy Word .doc', t, links), text: t, links };
  }
  if (kind === 'rtf') {
    const raw = new TextDecoder('latin1').decode(u8);
    const t = rtfToText(raw);
    if (tooShort(t)) throw new UnreadableError('.rtf');
    const links = cleanLinks([...raw.matchAll(/HYPERLINK\s+"([^"]+)"/g)].map((m) => m[1]));
    return { source: 'rtf', chars: t.length, content: asText('RTF', t, links), text: t, links };
  }
  if (kind === 'html') {
    const raw = new TextDecoder('utf-8').decode(u8);
    const t = htmlToText(raw);
    if (tooShort(t)) throw new UnreadableError('file');
    const links = cleanLinks([...raw.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
    return { source: 'html', chars: t.length, content: asText('an HTML-format Word file', t, links), text: t, links };
  }
  if (kind === 'text') {
    const t = new TextDecoder('utf-8').decode(u8);
    return { source: 'text', chars: t.length, content: asText('plain text', t), text: t, links: [] };
  }
  throw new Error(`Unsupported file type "${mime || fileName}". Upload PDF, Word (.doc/.docx), RTF or .txt.`);
}

/* ───────────────────────────── Claude call ───────────────────────────── */

export interface ParsedResult {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  currentTitle?: string;
  location?: string;
  yearsExperience?: number;
  skills: string[];
  summary: string;
}

export interface CallResult {
  model: string;
  parsed: ParsedResult | null;
  raw: string;
  usage: Usage;
  cost: number;
}

export async function callClaude(apiKey: string, model: string, content: unknown): Promise<CallResult> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      temperature: 0,
      // cache_control is honoured only above the model's minimum cacheable
      // length (Sonnet 4.5: 1024 tokens; Haiku 4.5: 4096). Harmless when below.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`Claude API ${res.status}: ${t.slice(0, 400)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const j = await res.json() as { content?: Array<{ type: string; text?: string }>; usage: Usage };
  const raw = j.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: ParsedResult | null = null;
  try { parsed = JSON.parse(cleaned); } catch { parsed = null; }
  return { model, parsed, raw, usage: j.usage, cost: costUsd(model, j.usage) };
}

/** Haiku's answer is good enough if it's JSON with some identity and some skills. */
export function acceptable(p: ParsedResult | null): boolean {
  if (!p || typeof p !== 'object') return false;
  const hasId = !!(p.fullName || p.firstName || p.email);
  const hasSkills = Array.isArray(p.skills) && p.skills.length >= 3;
  return hasId && hasSkills && typeof p.summary === 'string' && p.summary.length > 20;
}

export const SYSTEM_PROMPT = `You are a recruitment resume parser. The user message contains a candidate's resume (either as a PDF document or as text extracted from a PDF/Word/RTF/text file — extracted text may contain some formatting noise or odd line breaks; ignore it).

# Priority fields

Phone, current location and LinkedIn URL are the three fields recruiters rely on most. Search the WHOLE input for them before giving up: the contact header, page footers, a "Personal Details" / "Personal Information" / "Contact" block (often at the very END of Indian resumes), and the "Hyperlinks embedded in the document" list at the top of the input — a LinkedIn URL frequently appears only there, behind link text such as "LinkedIn" or the candidate's name.

# Output contract

Extract these fields and return ONLY valid JSON. If a field is not present, OMIT it (do not return null or empty string).

## Field rules

  - "firstName" / "lastName": split the candidate's name. If only a single name is present, put it in firstName and omit lastName. For names with three or more parts (e.g. "Anil Kumar Sharma"), put the first word in firstName and the remainder in lastName. Strip honorifics ("Mr.", "Ms.", "Dr.").

  - "fullName": optional convenience field with the full name verbatim from the resume (as it appears at the top), including any honorifics or middle initials.

  - "email": the candidate's primary email if shown. Lowercase, no spaces. If multiple emails appear, prefer the one in the contact header (top of resume) over any in employment history. Reject obvious placeholders ("email@example.com").

  - "phone": phone number as it appears (preserve country code, parens, and dashes if shown). If multiple phones, prefer the one labeled "mobile" or "cell"; else the first one in the contact header.

  - "linkedinUrl": the LinkedIn profile URL if present (check the embedded-hyperlinks list too). Only linkedin.com/in/... profile URLs count — not company pages. Always normalize to start with "https://" (add it if missing). Accept formats: "linkedin.com/in/jane-doe", "www.linkedin.com/in/jane-doe", or full URL.

  - "currentTitle": the candidate's CURRENT job title — the most recent role. Examples: "Senior Salesforce Developer", "Lead Data Engineer", "Principal SDET". If the most recent role is "Present" / undated, that's the current one. Skip historical titles.

  - "location": the candidate's CURRENT location (city + state/country). Examples: "Bangalore, India", "Pune, MH, India", "New York, NY, USA", "Remote — IST". If only a city is visible, just return the city. Skip historical/past locations. If the resume says "willing to relocate to X", the CURRENT location is still wherever they currently live — record that, not the relocation target. Sources in order of preference: an explicit "Current Location" / "Location" label; the address or city in the contact header; the "Address" line in a Personal Details block (reduce a full street address to city, state, country); the city of the current employer/role when it is explicitly stated. A "Preferred location" is NOT the current location. Use the full city name ("Bangalore", "Hyderabad"); include ", India" / ", USA" when the country is clear.

  - "yearsExperience": integer total years of professional experience if inferable. Look for an explicit statement ("8+ years of experience") first; otherwise compute from earliest professional-role start year to now. Cap at 40.

  - "skills": array of 8–25 distinct technical skills, tools, languages, frameworks, methodologies, certifications. Each item must be a short noun phrase ("TypeScript", "AWS Lambda", "PMP", "Stakeholder management"). Deduplicate aggressively — "JavaScript" and "JS" → "JavaScript". Skip generic soft skills (Communication, Teamwork, Leadership) unless the candidate has a specific cert or specialty there. Prefer canonical product names: "Salesforce Service Cloud" over "Service Cloud"; "AWS Lambda" over "Lambda"; "Apache Kafka" over "Kafka". Preserve case for proper nouns. Order by prominence (skills mentioned in current role first).

  - "summary": 2–4 sentence third-person professional summary. Cover: total years of experience, primary specialization (e.g. "Salesforce platform", "data engineering on AWS"), notable strengths or recent achievements, and seniority level if inferable. Plain text, no markdown, no first-person, no quotation marks around the summary itself.

# Worked examples

## Example 1 — Indian Salesforce developer

Resume input (excerpted):
  Priya Sharma
  priya.sharma@gmail.com  |  +91 98765 43210  |  Bangalore, KA
  https://linkedin.com/in/priya-sharma-sf
  Senior Salesforce Developer at Infosys (Jun 2020–Present)
  Salesforce Developer at Wipro (Aug 2017–May 2020)
  Skills: Apex, LWC, Visualforce, SOQL, Salesforce Service Cloud, Field Service Lightning, Salesforce Marketing Cloud, REST APIs, Jenkins, Git

Expected JSON:
  {
    "firstName": "Priya",
    "lastName": "Sharma",
    "fullName": "Priya Sharma",
    "email": "priya.sharma@gmail.com",
    "phone": "+91 98765 43210",
    "linkedinUrl": "https://linkedin.com/in/priya-sharma-sf",
    "currentTitle": "Senior Salesforce Developer",
    "location": "Bangalore, KA, India",
    "yearsExperience": 7,
    "skills": ["Apex", "Lightning Web Components", "Visualforce", "SOQL", "Salesforce Service Cloud", "Field Service Lightning", "Salesforce Marketing Cloud", "REST APIs", "Jenkins", "Git"],
    "summary": "Senior Salesforce developer with 7+ years across Infosys and Wipro, specializing in Service Cloud and Field Service Lightning. Strong on Apex, LWC, and integration work. Currently based in Bangalore."
  }

## Example 2 — Single-name profile, US-based

Resume input (excerpted):
  Akash
  akash@protonmail.com  ·  (415) 555-2200  ·  San Francisco, CA
  Principal Data Engineer · Snowflake Inc. (2021–Present)
  Lead Data Engineer · Airbnb (2017–2021)
  10+ years experience.
  Stack: Snowflake, Spark, Airflow, dbt, Kafka, Python, SQL, AWS

Expected JSON:
  {
    "firstName": "Akash",
    "fullName": "Akash",
    "email": "akash@protonmail.com",
    "phone": "(415) 555-2200",
    "currentTitle": "Principal Data Engineer",
    "location": "San Francisco, CA, USA",
    "yearsExperience": 10,
    "skills": ["Snowflake", "Apache Spark", "Apache Airflow", "dbt", "Apache Kafka", "Python", "SQL", "AWS"],
    "summary": "Principal data engineer with 10+ years at top-tier data-heavy companies including Snowflake and Airbnb. Deep expertise in modern data-stack tooling — Snowflake, Spark, Airflow, dbt, Kafka. Currently based in San Francisco."
  }

## Example 3 — Sparse contact info

Resume input (excerpted):
  Karthik R
  karthik.r@yahoo.com
  Salesforce Admin at TCS (3 yrs)
  Skills: Salesforce CRM, reports & dashboards, validation rules, flows

Expected JSON:
  {
    "firstName": "Karthik",
    "lastName": "R",
    "email": "karthik.r@yahoo.com",
    "currentTitle": "Salesforce Admin",
    "yearsExperience": 3,
    "skills": ["Salesforce CRM", "Salesforce Reports & Dashboards", "Validation Rules", "Salesforce Flow"],
    "summary": "Salesforce administrator with 3 years at TCS focused on declarative configuration — flows, validation rules, reports, and dashboards."
  }

# Final notes

  - Response MUST be a single JSON object. No prose before or after. No markdown code fences.
  - When unsure between two interpretations, prefer the more specific one (e.g. "Salesforce Service Cloud" over plain "Salesforce").
  - Never hallucinate a value. If the field genuinely isn't in the resume, OMIT it.`;
