/**
 * Supabase Edge Function: format-resume
 *
 * Sends a candidate resume (PDF / Word / RTF file, raw text, or a prior formatted
 * markdown draft) to Claude with the Simpliigence house format + any
 * user-supplied refinement instructions, and returns formatted markdown
 * the TA can preview / save-as-PDF / copy / download.
 *
 * Optional `targetFormatFileBase64` lets the TA upload a SAMPLE resume
 * that shows the desired format — Claude is instructed to match that
 * layout instead of the default Simpliigence template.
 *
 * Required secrets:
 *   ANTHROPIC_API_KEY
 *
 * Request body:
 *   {
 *     fileBase64?: string,              // resume file: PDF, .docx, .doc, .rtf, .txt (type sniffed)
 *     fileName?: string,
 *     resumeText?: string,              // plain text resume
 *     priorDraft?: string,              // prior formatted markdown to refine
 *     targetFormatFileBase64?: string,  // sample showing the target format (same types)
 *     targetFormatFileName?: string,
 *     instructions?: string,
 *     // Legacy aliases, still accepted: pdfBase64, targetFormatPdfBase64
 *   }
 *
 * Response:
 *   { ok: true, markdown: string }
 *   { error: string, detail?: string }
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

import JSZip from 'https://esm.sh/jszip@3.10.1';

// @ts-expect-error Deno global provided by edge runtime
const env = (name: string) => Deno.env.get(name);

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const CLAUDE_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

/* ── Word / RTF support (Sep 2026) ─────────────────────────────────────────
 * PDFs go to Claude as native document blocks. Everything else (.docx,
 * legacy .doc, .rtf, HTML-saved ".doc", .txt) is converted to text here,
 * with the type decided by magic bytes, not the file extension. The .doc /
 * RTF readers below are the same ones parse-resume uses (v39).
 *
 * .docx is converted to light markdown rather than flat text — headings,
 * bold/italic runs, bullets and table rows survive — so a Word
 * TARGET-FORMAT sample still tells Claude what the layout looks like. */


const xmlDecode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const ON = '(?:\\s+w:val="(?:1|true|on)")?\\s*\\/>';
const BOLD_RE = new RegExp(`<w:b${ON}`, 'i');
const ITALIC_RE = new RegExp(`<w:i${ON}`, 'i');

/** One <w:p> body → one markdown line ('' for an empty paragraph). */
function docxParaToLine(inner: string): string {
  const style = (inner.match(/<w:pStyle\s+w:val="([^"]+)"/i)?.[1] || '').toLowerCase();
  const isList = /<w:numPr\b/i.test(inner) || style.includes('list');
  let text = '';
  const runRe = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/gi;
  let r: RegExpExecArray | null;
  while ((r = runRe.exec(inner))) {
    const run = r[1];
    const rPr = run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/i)?.[1] || '';
    let t = '';
    const partRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/gi;
    let q: RegExpExecArray | null;
    while ((q = partRe.exec(run))) {
      if (q[1] !== undefined) t += xmlDecode(q[1]);
      else if (/^<w:tab/i.test(q[0])) t += '\t';
      else t += '\n';
    }
    if (!t) continue;
    if (t.trim() && BOLD_RE.test(rPr)) t = t.replace(/^(\s*)(.*?)(\s*)$/s, '$1**$2**$3');
    else if (t.trim() && ITALIC_RE.test(rPr)) t = t.replace(/^(\s*)(.*?)(\s*)$/s, '$1*$2*$3');
    text += t;
  }
  text = text.replace(/\*\*\*\*/g, '').trim();
  if (!text) return '';
  const plain = text.replace(/\*\*/g, '');
  const h = style.match(/^heading(\d)/);
  if (style === 'title') return `# ${plain}`;
  if (h) return `${'#'.repeat(Math.min(6, Number(h[1]) + 1))} ${plain}`;
  if (isList) return `- ${text}`;
  return text;
}

async function docxToMarkdown(buf: ArrayBuffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) return '';
    const paras = (xml: string) => {
      const out: string[] = [];
      const re = /<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml))) out.push(docxParaToLine(m[1] || ''));
      return out;
    };
    const body = docXml.replace(/^[\s\S]*?<w:body[^>]*>/i, '').replace(/<w:sectPr[\s\S]*$/i, '');
    const lines: string[] = [];
    // Walk body: tables become "a | b | c" rows, everything else paragraph by paragraph.
    const tblRe = /<w:tbl\b[\s\S]*?<\/w:tbl>/gi;
    let last = 0;
    let t: RegExpExecArray | null;
    while ((t = tblRe.exec(body))) {
      lines.push(...paras(body.slice(last, t.index)));
      const rows = t[0].match(/<w:tr\b[\s\S]*?<\/w:tr>/gi) || [];
      for (const row of rows) {
        const cells = (row.match(/<w:tc\b[\s\S]*?<\/w:tc>/gi) || [])
          .map((c) => paras(c).filter(Boolean).join(' / '));
        if (cells.some(Boolean)) lines.push(`| ${cells.join(' | ')} |`);
      }
      lines.push('');
      last = t.index + t[0].length;
    }
    lines.push(...paras(body.slice(last)));
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    console.warn('[format-resume] docxToMarkdown failed:', (e as Error).message);
    return '';
  }
}


/* ── Legacy Word (.doc, Word 97–2003) and RTF text extraction ──────────────
 * Naukri and older vendor CVs still arrive as .doc. A .doc is an OLE
 * compound file; the text lives in the WordDocument stream and is located
 * through the piece table (Clx) stored in the 0Table/1Table stream.
 * If anything in that walk fails we fall back to scraping printable runs,
 * which is noisy but good enough for Claude to pull identity + skills from.
 * Some ".doc" files are really RTF, HTML or a renamed .docx — sniff()
 * routes those by magic bytes instead of trusting the extension. */

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
    // Field codes: \x13 instruction \x14 result \x15 — keep only the result.
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
  while (p < end && table[p] === 0x01) p += 3 + tdv.getInt16(p + 1, true); // skip Prc
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
  return cleanWordText(out);
}

/** Last resort: printable ASCII / UTF-16LE runs of 4+ chars. */
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

function rtfToText(rtf: string): string {
  let s = rtf;
  // Drop ignorable destinations ({\*\...}), font/colour/style tables, pictures.
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
    // \uN is followed by a one-char ANSI fallback (\'hh or ?) — consume it.
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

function htmlToText(html: string): string {
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
function sniff(u8: Uint8Array): Sniffed {
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

/** Legacy .doc → text. Piece table first, printable scrape as fallback. */
function docToText(buf: ArrayBuffer): string {
  try {
    const t = docPieceTableText(buf);
    if (t.length >= 30) return t;
  } catch (e) {
    console.warn('[format-resume] .doc piece-table read failed, scraping:', (e as Error).message);
  }
  return scrapePrintable(new Uint8Array(buf)).slice(0, 60000);
}


type ResolvedFile =
  | { kind: 'pdf'; base64: string }
  | { kind: 'text'; text: string; label: string }
  | { kind: 'error'; message: string };

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^,]*,/, ''));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** Decide what an uploaded file is and turn it into something Claude reads. */
async function resolveFile(b64: string, filename = ''): Promise<ResolvedFile> {
  const u8 = b64ToBytes(b64);
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  const kind = sniff(u8);
  let text = '';
  let label = 'file';
  if (kind === 'pdf') return { kind: 'pdf', base64: b64.replace(/^data:[^,]*,/, '') };
  if (kind === 'zip') { text = await docxToMarkdown(buf); label = 'Word (.docx)'; }
  else if (kind === 'ole') { text = docToText(buf); label = 'Word (.doc)'; }
  else if (kind === 'rtf') { text = rtfToText(new TextDecoder('latin1').decode(u8)); label = 'RTF'; }
  else if (kind === 'html') { text = htmlToText(new TextDecoder('utf-8').decode(u8)); label = 'HTML/Word'; }
  else if (kind === 'text') { text = new TextDecoder('utf-8').decode(u8); label = 'text'; }
  else return { kind: 'error', message: `Unsupported file type${filename ? ` for "${filename}"` : ''}. Use PDF, Word (.docx/.doc), RTF or .txt.` };
  text = text.trim().slice(0, 80000);
  if (text.length < 30) {
    return { kind: 'error', message: `Couldn't read any text from ${filename || 'the file'} (${label}). If it's a scanned image or password-protected, save it as PDF and try again.` };
  }
  return { kind: 'text', text, label };
}

const SIMPLIIGENCE_SYSTEM_PROMPT = `You are a professional recruitment resume editor for Simpliigence. Your job is to take an incoming candidate resume and rewrite it into the Simpliigence house format — a clean, recruiter-friendly markdown document a hiring manager can scan in 30 seconds.

# The Simpliigence house format

Output exactly these sections, in this order, using markdown. Skip any section if the source has no content for it (do NOT invent).

  # {SPECIALIZATION HEADLINE IN ALL CAPS}
    A single \`#\` H1 line: the candidate's primary specialization in ALL CAPS, e.g. "SENIOR LEAD ANALYTICS", "PRINCIPAL SALESFORCE DEVELOPER", "STAFF DATA ENGINEER". This is the resume's headline — NOT the candidate's name.

  ## Professional Summary
    1–2 paragraphs in third person, italicized via blockquote (\`> *…*\`). Cover years of experience, primary specialization, and 1–2 standout strengths.

  ## Highlights
    Bullet list of 6–10 items. Each item starts with a **bold theme phrase**, followed by a colon and a 1-line achievement.
    Examples:
      - **Insights-powered strategy:** Led a data-to-strategy initiative that quantified 30% increase in customer engagement rate.
      - **Customer-centric analytics:** Built a customer-centric analytics program integrating behavior, market trends, and risk of redemption.
      - **Value creation:** Identified revenue streams that drove a 10% inflow increase.

  ## Technical Skills
    Categorized bullet list. Use **bold category labels** followed by a dash and comma-separated items:
      - **Languages —** SQL, Python, R
      - **BI & Data Visualization —** Tableau, Power BI, Qlik
      - **Cloud —** AWS (Athena, QuickSight), Hadoop, Spark
      - **Machine Learning —** Supervised (Classification, Regression), Unsupervised (Clustering)

  ## Current Role
    A single role-title line, then a 3–6 bullet list of what the candidate does in that role.

  ## Selected Projects
    Grouped sub-sections. Each group is a bold sub-heading followed by 3–5 bullets:
      **Advanced Analytics, Business Intelligence and Product Optimization:**
      - Deep-dive exploration to understand advisor clusters impacted by market conditions; drove proactive outreach that improved CSAT.
      - Cohort comparisons + descriptive/prescriptive analytics that improved customer retention by 10%.

  ## Work History
    Bullet list, most-recent first. Each item:
      \`- {Job Title} — *{Company} ({Month YYYY – Month YYYY or Present})*\`

  ## Education
    For each degree:
      \`{Degree} — {YYYY}\`
      \`> *{Institution}*\`
    (Institution on its own indented italic line via blockquote.)

# Rules — every time

  1. **Strip personal details inappropriate for Western hiring**: date of birth, marital status, father's name, religion, blood group, photograph, full home address (city / state / country is fine). NEVER include these.
  2. **Third person throughout.** No "I" / "my".
  3. **Concise bullets** — 12–22 words each, starting with strong action verbs (Led, Built, Designed, Migrated, Reduced, Owned, Shipped, Drove).
  4. **No emoji, no decorative characters, no horizontal rules.**
  5. **Quantify when the source gives numbers.** Don't fabricate metrics.
  6. **The H1 title is the specialization headline in ALL CAPS** — not the candidate's full name. Do NOT include name, email, phone, or LinkedIn in the body (those go on a cover sheet, not in this profile).
  7. **Italicized blockquotes (\`> *…*\`)** for: the Professional Summary paragraph, the Education institution line. Nothing else.
  8. **Bold (\`**…**\`)** for: Highlights theme phrases, Technical Skills category labels, Selected Projects sub-headings.
  9. Output MUST be valid Markdown only. No prose introduction, no closing remark, no \`\`\`fences\`\`\`.

# Target-format override

The user may attach a TARGET-FORMAT sample (a PDF, or a Word/RTF file converted to markdown) showing the layout they want. When present, that takes priority: study the section order, headings, italic/bold usage, and bullet style in the sample, and rewrite the source resume to match THAT layout instead of the default Simpliigence template above. The "Rules — every time" still apply.

# User refinement instructions

The user message may include free-form instructions ("emphasize Salesforce platform expertise", "drop the customer-service roles", "tighten to 1 page"). Follow them faithfully on top of the format above.

# If you're given a prior formatted draft

The user may pass an already-formatted markdown draft instead of a raw resume. In that case, refine THAT draft per the new instructions — don't re-extract from scratch, just edit.`;

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY secret is not set');
    }

    const body = await req.json() as {
      fileBase64?: string;
      fileName?: string;
      pdfBase64?: string;
      resumeText?: string;
      priorDraft?: string;
      targetFormatFileBase64?: string;
      targetFormatFileName?: string;
      targetFormatPdfBase64?: string;
      instructions?: string;
    };

    const { resumeText, priorDraft, instructions } = body;
    const fileBase64 = body.fileBase64 || body.pdfBase64;
    const targetB64 = body.targetFormatFileBase64 || body.targetFormatPdfBase64;
    const sources = [fileBase64, resumeText, priorDraft].filter(Boolean).length;
    if (sources === 0) {
      return new Response(
        JSON.stringify({ error: 'Provide one of: fileBase64, resumeText, priorDraft' }),
        { status: 400, headers: corsHeaders },
      );
    }

    const instr = instructions && instructions.trim()
      ? `User refinement instructions:\n${instructions.trim()}\n\n`
      : '';

    // Build user message content
    const userContent: unknown[] = [];

    // If a target-format sample was uploaded, attach it first with a label
    if (targetB64) {
      const target = await resolveFile(targetB64, body.targetFormatFileName);
      if (target.kind === 'error') {
        return new Response(JSON.stringify({ error: `Target format: ${target.message}` }), { status: 400, headers: corsHeaders });
      }
      if (target.kind === 'pdf') {
        userContent.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: target.base64 },
        });
        userContent.push({
          type: 'text',
          text: 'The PDF above is a TARGET-FORMAT SAMPLE — study its layout, section order, headings, italics, bold, and bullet style. Rewrite the candidate resume below to match THIS format. The Simpliigence default in your system prompt is a fallback only.',
        });
      } else {
        userContent.push({
          type: 'text',
          text:
            (target.label === 'Word (.docx)'
              ? 'Below is a TARGET-FORMAT SAMPLE, converted from a Word (.docx) file to markdown (headings as #, bold as **, bullets as -, table rows as | a | b |). '
              : `Below is a TARGET-FORMAT SAMPLE, extracted as plain text from a ${target.label} file (bold/italics are lost; infer structure from section order and line layout). `) +
            'Study its section order, headings, bold/italic usage and bullet style, and rewrite the candidate resume to match THIS format. Ignore the sample\'s own content. The Simpliigence default in your system prompt is a fallback only.\n\n' +
            `--- BEGIN TARGET-FORMAT SAMPLE ---\n${target.text.slice(0, 30000)}\n--- END TARGET-FORMAT SAMPLE ---`,
        });
      }
    }

    const ask = 'Rewrite the resume into the Simpliigence house format' +
      (targetB64 ? ' (matching the target-format sample)' : '') +
      ' per the system instructions. Return ONLY the formatted markdown.';

    if (priorDraft) {
      userContent.push({
        type: 'text',
        text:
          `Below is a prior formatted draft. Refine it per the new instructions, keeping the house format intact.\n\n` +
          instr +
          `--- BEGIN PRIOR DRAFT ---\n${priorDraft}\n--- END PRIOR DRAFT ---\n\n` +
          'Return ONLY the revised markdown.',
      });
    } else if (fileBase64) {
      const src = await resolveFile(fileBase64, body.fileName);
      if (src.kind === 'error') {
        return new Response(JSON.stringify({ error: src.message }), { status: 400, headers: corsHeaders });
      }
      if (src.kind === 'pdf') {
        userContent.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: src.base64 },
        });
        userContent.push({ type: 'text', text: instr + ask.replace('the resume', 'the resume above') });
      } else {
        userContent.push({
          type: 'text',
          text:
            instr +
            `Resume text follows, extracted from a ${src.label} file (it may contain some formatting noise — ignore it). ${ask}\n\n` +
            `--- BEGIN RESUME ---\n${src.text}\n--- END RESUME ---`,
        });
      }
    } else if (resumeText) {
      userContent.push({
        type: 'text',
        text:
          instr +
          `Resume text follows. ${ask}\n\n` +
          `--- BEGIN RESUME ---\n${resumeText}\n--- END RESUME ---`,
      });
    }

    const claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SIMPLIIGENCE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      return new Response(
        JSON.stringify({ error: 'Claude API failed', detail: text.slice(0, 500) }),
        { status: 502, headers: corsHeaders },
      );
    }
    const claudeJson = await claudeRes.json() as { content?: Array<{ type: string; text?: string }> };
    const reply = claudeJson.content?.find((b) => b.type === 'text')?.text?.trim() || '';
    const cleaned = reply
      .replace(/^```(?:markdown|md)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    return new Response(JSON.stringify({ ok: true, markdown: cleaned }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[format-resume]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
