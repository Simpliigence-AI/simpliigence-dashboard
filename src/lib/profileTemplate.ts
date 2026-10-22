/**
 * Simpliigence standard profile template — the single source of truth for
 * how a formatted resume looks. Modelled on Vikas Rathod's profile (Sep 2026),
 * which Raghu set as the house standard for every Simpliigence resume.
 *
 *   Header  — NAME (22pt bold, centered)
 *             **Primary Title | Secondary** (11.5pt bold, centered)
 *             City, Country | phone | email (9.5pt, centered)
 *   Body    — ## SECTION (Aptos Display 13pt bold, #365F91)
 *             ### Sub-heading (10.5pt bold, #4F81BD)
 *             #### Company - Title  + *dates* line (10.5pt bold / italic)
 *             bullets, paragraphs, **Label:** skill lines (9.5pt Aptos)
 *   Footer  — "Name | Primary Title" (8pt, centered, every page)
 *   Page    — US Letter, 0.55in top/bottom, 0.7in left/right
 *
 * The format-resume edge function emits markdown in exactly this grammar;
 * parseProfile() turns it into blocks that the HTML preview/PDF and the
 * Word builder (profileDocx.ts) both render, so the two never drift.
 */

export interface Run { text: string; bold?: boolean; italic?: boolean }

export type ProfileBlock =
  | { kind: 'section'; text: string }
  | { kind: 'sub'; text: string }
  | { kind: 'entry'; text: string; dates?: string }
  | { kind: 'para'; runs: Run[] }
  | { kind: 'bullet'; runs: Run[] };

export interface ParsedProfile {
  name: string;
  title: string;
  contact: string[];
  blocks: ProfileBlock[];
  footer: string;
}

/** Template constants — shared by CSS and docx so both match the Word original. */
export const PROFILE_STYLE = {
  font: 'Aptos',
  headingFont: 'Aptos Display',
  sectionColor: '365F91',
  subColor: '4F81BD',
  bodyPt: 9.5,
  namePt: 22,
  titlePt: 11.5,
  sectionPt: 13,
  subPt: 10.5,
  entryPt: 10.5,
  footerPt: 8,
} as const;

/** **bold** / *italic* → runs. Unbalanced markers are left as literal text. */
export function parseInline(s: string): Run[] {
  const runs: Run[] = [];
  const re = /\*\*(.+?)\*\*|(?<![*\w])\*(?!\s)([^*]+?)\*(?!\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    if (m[1] !== undefined) runs.push({ text: m[1], bold: true });
    else runs.push({ text: m[2], italic: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs.map((r) => ({ ...r, text: r.text.replace(/`/g, '') })).filter((r) => r.text.length);
}

const stripMarks = (s: string) => s.replace(/\*\*/g, '').replace(/(^|\s)\*|\*(\s|$)/g, '$1$2').replace(/^\*|\*$/g, '').trim();

function titleCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s\-'.])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export function parseProfile(md: string): ParsedProfile {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let name = '';
  let title = '';
  const contact: string[] = [];
  const blocks: ProfileBlock[] = [];
  let inHeader = true;
  let sawName = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue;

    let m: RegExpMatchArray | null;

    if (inHeader) {
      if ((m = line.match(/^#\s+(.+)/)) && !sawName) { name = stripMarks(m[1]); sawName = true; continue; }
      if (!/^#{2,}\s/.test(line)) {
        if (!sawName) { name = stripMarks(line); sawName = true; continue; }
        if (!title) { title = stripMarks(line); continue; }
        contact.push(stripMarks(line));
        continue;
      }
      inHeader = false;
    }

    if ((m = line.match(/^####\s+(.+)/))) {
      const next = (lines[i + 1] ?? '').trim();
      const dm = next.match(/^\*([^*].*?)\*$/) || next.match(/^_(.+)_$/);
      if (dm) i++;
      blocks.push({ kind: 'entry', text: stripMarks(m[1]), dates: dm ? dm[1].trim() : undefined });
      continue;
    }
    if ((m = line.match(/^###\s+(.+)/))) { blocks.push({ kind: 'sub', text: stripMarks(m[1]) }); continue; }
    if ((m = line.match(/^#{1,2}\s+(.+)/))) { blocks.push({ kind: 'section', text: stripMarks(m[1]).toUpperCase() }); continue; }
    if ((m = line.match(/^(?:[-*•▸]|\d+[.)])\s+(.+)/))) { blocks.push({ kind: 'bullet', runs: parseInline(m[1]) }); continue; }
    if ((m = line.match(/^>\s*(.*)/))) { if (m[1].trim()) blocks.push({ kind: 'para', runs: parseInline(m[1]) }); continue; }
    blocks.push({ kind: 'para', runs: parseInline(line) });
  }

  const primaryTitle = title.split('|')[0].trim();
  const footer = [titleCase(name), primaryTitle].filter(Boolean).join(' | ');
  return { name: name.toUpperCase(), title, contact, blocks, footer };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const runsHtml = (runs: Run[]) =>
  runs.map((r) => {
    let t = esc(r.text);
    if (r.bold) t = `<strong>${t}</strong>`;
    if (r.italic) t = `<em>${t}</em>`;
    return t;
  }).join('');

/** HTML for the on-screen preview and the printed PDF (styled by PROFILE_CSS). */
export function profileToHtml(p: ParsedProfile): string {
  const out: string[] = [];
  if (p.name) out.push(`<div class="sp-name">${esc(p.name)}</div>`);
  if (p.title) out.push(`<div class="sp-title">${esc(p.title)}</div>`);
  for (const c of p.contact) out.push(`<div class="sp-contact">${esc(c)}</div>`);
  let list = false;
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const b of p.blocks) {
    if (b.kind === 'bullet') {
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${runsHtml(b.runs)}</li>`);
      continue;
    }
    close();
    if (b.kind === 'section') out.push(`<h2>${esc(b.text)}</h2>`);
    else if (b.kind === 'sub') out.push(`<h3>${esc(b.text)}</h3>`);
    else if (b.kind === 'entry') out.push(`<div class="sp-entry"><strong>${esc(b.text)}</strong>${b.dates ? `<br/><em>${esc(b.dates)}</em>` : ''}</div>`);
    else out.push(`<p>${runsHtml(b.runs)}</p>`);
  }
  close();
  if (p.footer) out.push(`<div class="sp-footer">${esc(p.footer)}</div>`);
  return out.join('\n');
}

/** CSS for .simpliigence-profile — mirrors the Word template's styles. */
export const PROFILE_CSS = `
.simpliigence-profile { font-family: Aptos, Calibri, "Segoe UI", Arial, sans-serif; color: #000; font-size: 9.5pt; line-height: 1.15; background: #fff; }
.simpliigence-profile .sp-name { text-align: center; font-weight: 700; font-size: 22pt; margin: 0 0 4pt; letter-spacing: 0.01em; }
.simpliigence-profile .sp-title { text-align: center; font-weight: 700; font-size: 11.5pt; margin: 0 0 4pt; }
.simpliigence-profile .sp-contact { text-align: center; margin: 0 0 8pt; }
.simpliigence-profile h2 { font-family: "Aptos Display", Aptos, Calibri, Arial, sans-serif; font-size: 13pt; font-weight: 700; color: #365F91; margin: 10pt 0 4pt; text-transform: uppercase; break-after: avoid; }
.simpliigence-profile h3 { font-family: "Aptos Display", Aptos, Calibri, Arial, sans-serif; font-size: 10.5pt; font-weight: 700; color: #4F81BD; margin: 7pt 0 2pt; break-after: avoid; }
.simpliigence-profile .sp-entry { font-size: 10.5pt; margin: 5pt 0 4pt; break-after: avoid; }
.simpliigence-profile .sp-entry em { font-size: 9.5pt; }
.simpliigence-profile p { margin: 0 0 4pt; }
.simpliigence-profile ul { list-style: disc; margin: 0 0 4pt; padding-left: 14.4pt; }
.simpliigence-profile li { margin: 0 0 1.5pt; padding-left: 4pt; }
.simpliigence-profile strong { font-weight: 700; }
.simpliigence-profile .sp-footer { margin-top: 18pt; padding-top: 6pt; border-top: 1px solid #e5e7eb; text-align: center; font-size: 8pt; color: #333; }
`;
