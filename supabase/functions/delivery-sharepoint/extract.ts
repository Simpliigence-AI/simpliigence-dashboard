/**
 * Plain-text extraction for project documents, so the AI can read them.
 * Word, PowerPoint and Excel are zip files of XML (read with fflate);
 * PDFs go through unpdf (pdf.js built for serverless). Scanned PDFs, images
 * and video/audio have no text: they come back as 'none' with a reason.
 */
// @ts-expect-error npm specifier
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';
// @ts-expect-error npm specifier
import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1';

export const MAX_TEXT = 300_000; // characters kept per file
export type Extracted = { status: 'ok' | 'none' | 'error'; text?: string; reason?: string };

export const MEDIA = /\.(mp4|mov|m4v|webm|avi|mkv|wmv|mp3|m4a|wav|aac|ogg|wma)$/i;
export const IMAGE = /\.(png|jpe?g|gif|bmp|tiff?|svg|webp|heic)$/i;
const PLAIN = /\.(txt|md|markdown|csv|tsv|json|xml|log|eml|yaml|yml)$/i;
/** Formats Graph can convert to PDF for us (legacy Office, RTF, OpenDocument). */
export const CONVERT = /\.(doc|dot|ppt|pps|pot|xls|rtf|odt|odp|ods|msg)$/i;

const ent = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&amp;/g, '&');
const tidy = (s: string) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
const strip = (xml: string) => ent(xml.replace(/<[^>]+>/g, ''));

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes, { filter: (f: { name: string }) => f.name.endsWith('.xml') });
}
const num = (p: string) => parseInt(p.match(/(\d+)\.xml$/)?.[1] ?? '0', 10);

function docx(files: Record<string, Uint8Array>): string {
  const parts = ['word/document.xml', ...Object.keys(files).filter((k) => /^word\/(footnotes|endnotes|comments)\.xml$/.test(k))];
  return parts.filter((p) => files[p]).map((p) => {
    const xml = strFromU8(files[p]);
    return strip(xml
      .replace(/<w:tc[ >][\s\S]*?<\/w:tc>/g, (cell) => cell.replace(/<\/w:p>/g, ' '))
      .replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:tc>/g, ' | ').replace(/(\s\|\s)?<\/w:tr>/g, '\n').replace(/<\/w:p>/g, '\n'));
  }).join('\n\n');
}

function pptx(files: Record<string, Uint8Array>): string {
  const slides = Object.keys(files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => num(a) - num(b));
  const para = (xml: string) => strip(xml.replace(/<\/a:p>/g, '\n'));
  return slides.map((s) => {
    const notes = files[`ppt/notesSlides/notesSlide${num(s)}.xml`];
    const body = para(strFromU8(files[s]));
    const n = notes ? para(strFromU8(notes)).replace(/^\d+\s*$/gm, '').trim() : '';
    return `## Slide ${num(s)}\n${body}${n ? `\nSpeaker notes: ${n}` : ''}`;
  }).join('\n\n');
}

function xlsx(files: Record<string, Uint8Array>): string {
  const shared: string[] = [];
  const ss = files['xl/sharedStrings.xml'];
  if (ss) for (const m of strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(strip(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
  const wb = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const names = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => ent(m[1]));
  const sheets = Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => num(a) - num(b));
  return sheets.map((s, i) => {
    const rows: string[] = [];
    for (const r of strFromU8(files[s]).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= 3000) break;
      const cells: string[] = [];
      for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], inner = c[2] ?? '';
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = '';
        if (/t="s"/.test(attrs) && v != null) val = shared[parseInt(v, 10)] ?? '';
        else if (/t="inlineStr"/.test(attrs)) val = strip(inner);
        else if (v != null) val = ent(v);
        cells.push(val.replace(/\s+/g, ' ').trim());
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) rows.push(cells.join(' | '));
    }
    return `## Sheet: ${names[i] ?? `Sheet ${i + 1}`}\n${rows.join('\n')}`;
  }).join('\n\n');
}

/** WebVTT / SRT (Teams transcripts): drop cue numbers and timings, keep "Speaker: words". */
function captions(s: string): string {
  const out: string[] = [];
  for (const block of s.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter((l) => l.trim() && !/^WEBVTT/.test(l) && !/-->/.test(l) && !/^\d+$/.test(l.trim()) && !/^NOTE\b/.test(l));
    const text = lines.join(' ').replace(/<v ([^>]+)>/g, '$1: ').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    // Merge consecutive cues from the same speaker.
    const sp = text.match(/^([^:]{1,60}):\s/)?.[1];
    const prev = out[out.length - 1];
    if (sp && prev?.startsWith(`${sp}: `)) out[out.length - 1] = `${prev} ${text.slice(sp.length + 2)}`;
    else out.push(text);
  }
  return out.join('\n');
}

async function pdf(bytes: Uint8Array): Promise<string> {
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((t: string, i: number) => `[Page ${i + 1}]\n${t}`).join('\n\n');
}

export async function extract(name: string, bytes: Uint8Array): Promise<Extracted> {
  const n = name.toLowerCase();
  if (MEDIA.test(n)) return { status: 'none', reason: 'Video or audio — save the meeting transcript into the folder so the AI can read it.' };
  if (IMAGE.test(n)) return { status: 'none', reason: 'Image — no text to read.' };
  try {
    let text = '';
    if (/\.(docx|docm|dotx)$/.test(n)) text = docx(unzip(bytes));
    else if (/\.(pptx|pptm|ppsx)$/.test(n)) text = pptx(unzip(bytes));
    else if (/\.(xlsx|xlsm)$/.test(n)) text = xlsx(unzip(bytes));
    else if (n.endsWith('.pdf')) text = await pdf(bytes);
    else if (/\.(vtt|srt)$/.test(n)) text = captions(new TextDecoder().decode(bytes));
    else if (/\.html?$/.test(n)) text = strip(new TextDecoder().decode(bytes).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n'));
    else if (PLAIN.test(n)) text = new TextDecoder().decode(bytes);
    else return { status: 'none', reason: 'File type the AI can’t read.' };
    text = tidy(text);
    if (text.replace(/\[Page \d+\]/g, '').trim().length < 20) {
      return { status: 'none', reason: n.endsWith('.pdf') ? 'No text layer — looks like a scanned PDF.' : 'No text found.' };
    }
    return { status: 'ok', text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…[truncated]` : text };
  } catch (e) {
    return { status: 'error', reason: `Could not read the file: ${String((e as Error).message ?? e).slice(0, 200)}` };
  }
}
