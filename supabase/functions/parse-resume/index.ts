/**
 * Supabase Edge Function: parse-resume
 *
 * Called by the dashboard's Candidates page on single-file upload AND on
 * bulk import. Downloads the resume PDF/text from Supabase Storage, sends
 * it to Claude (Anthropic Messages API), and writes the parsed identity
 * + skills + summary back onto the india_staffing_candidates row.
 *
 * Required secrets (set with `supabase secrets set ...`):
 *   ANTHROPIC_API_KEY   — claude.ai console key with messages access
 *
 * Request body:
 *   { candidateId: string }
 *
 * Response (success):
 *   {
 *     ok: true,
 *     skills: string[],
 *     summary: string,
 *     firstName?: string,
 *     lastName?: string,
 *     email?: string,
 *     phone?: string,
 *     linkedinUrl?: string,
 *     currentTitle?: string,
 *     yearsExperience?: number,
 *     parsedAt: string,
 *   }
 *
 * Identity fields (firstName/lastName/email/phone/linkedin/currentTitle)
 * are written back to the candidate row ONLY if that column is currently
 * empty — never overwrite a TA's hand-typed values. Skills + summary
 * always update (parser is the source of truth there).
 *
 * Supported file types: PDF, Word .docx, legacy Word .doc (97–2003), RTF,
 * HTML-saved .doc (Naukri exports), and plain text. Type is decided by the
 * file's magic bytes, not just the extension.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global provided by edge runtime
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh resolves at runtime in Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-expect-error esm.sh — JSZip for in-memory DOCX text extraction
import JSZip from 'https://esm.sh/jszip@3.10.1';

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface ParsedResult {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  currentTitle?: string;
  /** Current location — city + state/country if present. Used for sourcing/search. */
  location?: string;
  yearsExperience?: number;
  skills: string[];
  summary: string;
}

/** Extract plain text from a .docx file in memory. A docx is a zip whose
 *  word/document.xml contains the body — every `<w:t>` element holds a run
 *  of text. We pull those out, preserve paragraph breaks for new <w:p>, and
 *  ignore the rest of the markup.
 *  Returns "" if the file is malformed (caller falls back to "unsupported"). */
async function docxToText(buf: ArrayBuffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) return '';
    // Split on </w:p> so each paragraph becomes its own line, then strip tags.
    return docXml
      .split(/<\/w:p>/i)
      .map((para: string) => para
        .replace(/<w:tab\b[^>]*\/?>/gi, '\t')
        .replace(/<w:br\b[^>]*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
      )
      .join('\n')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  } catch (e) {
    console.warn('[parse-resume] docxToText failed:', (e as Error).message);
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
    console.warn('[parse-resume] .doc piece-table read failed, scraping:', (e as Error).message);
  }
  return scrapePrintable(new Uint8Array(buf)).slice(0, 60000);
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // @ts-expect-error btoa is globally available
  return btoa(binary);
}

const SYSTEM_PROMPT = `You are a recruitment resume parser. The user message contains a candidate's resume (either as a PDF document or as text extracted from a Word/RTF/text file — extracted text may contain some formatting noise; ignore it).

# Output contract

Extract these fields and return ONLY valid JSON. If a field is not present, OMIT it (do not return null or empty string).

## Field rules

  - "firstName" / "lastName": split the candidate's name. If only a single name is present, put it in firstName and omit lastName. For names with three or more parts (e.g. "Anil Kumar Sharma"), put the first word in firstName and the remainder in lastName. Strip honorifics ("Mr.", "Ms.", "Dr.").

  - "fullName": optional convenience field with the full name verbatim from the resume (as it appears at the top), including any honorifics or middle initials.

  - "email": the candidate's primary email if shown. Lowercase, no spaces. If multiple emails appear, prefer the one in the contact header (top of resume) over any in employment history. Reject obvious placeholders ("email@example.com").

  - "phone": phone number as it appears (preserve country code, parens, and dashes if shown). If multiple phones, prefer the one labeled "mobile" or "cell"; else the first one in the contact header.

  - "linkedinUrl": the LinkedIn profile URL if present. Always normalize to start with "https://" (add it if missing). Accept formats: "linkedin.com/in/jane-doe", "www.linkedin.com/in/jane-doe", or full URL.

  - "currentTitle": the candidate's CURRENT job title — the most recent role. Examples: "Senior Salesforce Developer", "Lead Data Engineer", "Principal SDET". If the most recent role is "Present" / undated, that's the current one. Skip historical titles.

  - "location": the candidate's CURRENT location (city + state/country). Examples: "Bangalore, India", "Pune, MH, India", "New York, NY, USA", "Remote — IST". If only a city is visible, just return the city. Skip historical/past locations. If the resume says "willing to relocate to X", the CURRENT location is still wherever they currently live — record that, not the relocation target.

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

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY secret is not set on this Supabase project');
    }

    const { candidateId, forceIdentity } = await req.json() as { candidateId?: string; forceIdentity?: boolean };
    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'candidateId is required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Look up candidate row (full row so we know what's blank)
    const { data: cand, error: candErr } = await supabase
      .from('india_staffing_candidates')
      .select('id, name, email, phone, linkedin_url, location, resume_url, resume_filename, experience')
      .eq('id', candidateId)
      .single();
    if (candErr || !cand) {
      return new Response(JSON.stringify({ error: 'Candidate not found', detail: candErr?.message }), { status: 404, headers: corsHeaders });
    }
    if (!cand.resume_url) {
      return new Response(JSON.stringify({ error: 'Candidate has no resume uploaded yet' }), { status: 400, headers: corsHeaders });
    }

    // 2. Download resume
    const { data: file, error: fileErr } = await supabase.storage
      .from('candidate-resumes')
      .download(cand.resume_url);
    if (fileErr || !file) {
      return new Response(JSON.stringify({ error: 'Could not download resume', detail: fileErr?.message }), { status: 500, headers: corsHeaders });
    }

    const fileName = (cand.resume_filename || cand.resume_url).toLowerCase();
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const kind = sniff(u8);
    const asText = (label: string, text: string) => [
      { type: 'text', text: `Resume text follows (extracted from ${label}). Parse per the instructions and return the JSON.\n\n---\n${text.slice(0, 60000)}` },
    ];
    const tooShort = (t: string) => !t || t.trim().length < 30;
    const unreadable = (what: string) => new Response(JSON.stringify({
      error: `Could not read text from this ${what} — it may be scanned, password-protected or corrupt. Re-save as PDF and re-upload.`,
    }), { status: 400, headers: corsHeaders });

    // 3. Build Claude message
    let userContent: unknown;
    if (kind === 'pdf' || (kind === 'unknown' && (file.type === 'application/pdf' || fileName.endsWith('.pdf')))) {
      userContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(buf) } },
        { type: 'text', text: 'Parse this resume per the instructions and return the JSON.' },
      ];
    } else if (kind === 'zip') {
      const text = await docxToText(buf);
      if (tooShort(text)) return unreadable('.docx');
      userContent = asText('.docx', text);
    } else if (kind === 'ole') {
      const text = docToText(buf);
      if (tooShort(text)) return unreadable('.doc');
      userContent = asText('legacy Word .doc', text);
    } else if (kind === 'rtf') {
      const text = rtfToText(new TextDecoder('latin1').decode(u8));
      if (tooShort(text)) return unreadable('.rtf');
      userContent = asText('RTF', text);
    } else if (kind === 'html') {
      const text = htmlToText(new TextDecoder('utf-8').decode(u8));
      if (tooShort(text)) return unreadable('file');
      userContent = asText('an HTML-format Word file', text);
    } else if (kind === 'text') {
      userContent = asText('plain text', new TextDecoder('utf-8').decode(u8));
    } else {
      return new Response(JSON.stringify({
        error: `Unsupported file type "${file.type || fileName}". Upload PDF, Word (.doc/.docx), RTF or .txt.`,
      }), { status: 400, headers: corsHeaders });
    }

    // 4. Call Claude
    const claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        // System prompt as a structured block with cache_control: ephemeral —
        // Anthropic caches the prefix for 5 min, so any subsequent parse-resume
        // call within that window pays ~10% of the input cost on the cached
        // portion (~30–40% saving for typical resume bulk imports).
        // Note: caching needs ≥1024 tokens to activate; the expanded prompt
        // above is sized to clear that threshold.
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      return new Response(JSON.stringify({ error: 'Claude API failed', detail: text.slice(0, 500) }), { status: 502, headers: corsHeaders });
    }
    const claudeJson = await claudeRes.json() as { content?: Array<{ type: string; text?: string }> };
    const reply = claudeJson.content?.find((b) => b.type === 'text')?.text?.trim() || '';

    // 5. Parse JSON
    const cleaned = reply
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    let parsed: ParsedResult;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({
        error: 'Claude returned non-JSON',
        detail: reply.slice(0, 500),
      }), { status: 502, headers: corsHeaders });
    }
    const skills = Array.isArray(parsed.skills) ? parsed.skills.filter((s) => typeof s === 'string').slice(0, 30) : [];
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const firstName = typeof parsed.firstName === 'string' ? parsed.firstName.trim() : '';
    const lastName = typeof parsed.lastName === 'string' ? parsed.lastName.trim() : '';
    const fullName = typeof parsed.fullName === 'string' ? parsed.fullName.trim() : [firstName, lastName].filter(Boolean).join(' ').trim();
    const email = typeof parsed.email === 'string' ? parsed.email.trim().toLowerCase() : '';
    const phone = typeof parsed.phone === 'string' ? parsed.phone.trim() : '';
    const linkedinUrl = typeof parsed.linkedinUrl === 'string' ? parsed.linkedinUrl.trim() : '';
    const currentTitle = typeof parsed.currentTitle === 'string' ? parsed.currentTitle.trim() : '';
    const location = typeof parsed.location === 'string' ? parsed.location.trim() : '';
    const yearsExperience = typeof parsed.yearsExperience === 'number' ? parsed.yearsExperience : undefined;

    // 6. Write back — skills + summary always; identity fields only when blank,
    //    placeholder-looking, or when caller passes forceIdentity=true.
    const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

    /** Strip a filename of its extension and replace separators with spaces. */
    const filenameRoot = (fn: string | null | undefined): string => {
      if (!fn) return '';
      return fn
        .replace(/\.(pdf|txt|docx?|rtf)$/i, '')
        .replace(/[._\-+]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    };
    const fileRoot = filenameRoot(cand.resume_filename);

    /** Heuristics that mark a value as "placeholder" — safe to overwrite. */
    const isNamePlaceholder = (() => {
      const n = (cand.name || '').trim();
      if (!n) return true;
      const nl = n.toLowerCase();
      if (nl.endsWith('.pdf') || nl.endsWith('.txt') || nl.endsWith('.doc') || nl.endsWith('.docx') || nl.endsWith('.rtf')) return true;
      if (nl.startsWith('imported resume') || nl.startsWith('candidate ') || nl === 'unnamed') return true;
      // Bulk-import seeds name = filename-without-ext. Detect that by comparing
      // against the resume_filename root (separators normalised). If they
      // match, the name was never hand-typed.
      if (fileRoot && filenameRoot(n) === fileRoot) return true;
      // Names that contain common resume keywords are placeholders too.
      if (/\b(resume|cv|profile|naukri|linkedin)\b/i.test(n)) return true;
      // Names with NO spaces but many hyphens/underscores are likely filenames
      if (!/\s/.test(n) && /[._\-]/.test(n)) return true;
      return false;
    })();

    const shouldWrite = (existing: unknown) =>
      forceIdentity || blank(existing);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {
      skills,
      profile_summary: summary,
      parsed_at: new Date().toISOString(),
    };
    // Name: write if forced, blank, or matches the filename root.
    if (fullName && (forceIdentity || isNamePlaceholder)) updates.name = fullName;
    if (email && shouldWrite(cand.email)) updates.email = email;
    if (phone && shouldWrite(cand.phone)) updates.phone = phone;
    if (linkedinUrl && shouldWrite(cand.linkedin_url)) updates.linkedin_url = linkedinUrl;
    if (location && shouldWrite(cand.location)) updates.location = location;
    // Use "experience" column to hold the current title if blank/forced.
    if (currentTitle && shouldWrite(cand.experience)) updates.experience = currentTitle;

    const parsedAt = updates.parsed_at;
    const { error: updErr } = await supabase
      .from('india_staffing_candidates')
      .update(updates)
      .eq('id', candidateId);
    if (updErr) {
      return new Response(JSON.stringify({ error: 'DB update failed', detail: updErr.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      ok: true,
      skills,
      summary,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      fullName: fullName || undefined,
      email: email || undefined,
      phone: phone || undefined,
      linkedinUrl: linkedinUrl || undefined,
      currentTitle: currentTitle || undefined,
      location: location || undefined,
      yearsExperience,
      parsedAt,
    }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[parse-resume]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
