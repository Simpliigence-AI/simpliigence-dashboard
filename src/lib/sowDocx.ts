/**
 * Generates a .docx Statement of Work from structured SOW sections.
 *
 * The layout mirrors Simpliigence's standard SOW format:
 *   - Branded header on every page: the "simpliigence" wordmark
 *   - Branded footer on every page: small icon mark + address + page X of Y
 *   - Cover page: large STATEMENT OF WORK title with orange divider,
 *     "Prepared for:" + client name
 *   - Auto-populated Table of Contents field (Word fills it on open)
 *   - Body sections in the order returned by the caller
 *   - Acceptance signature block at the end
 *
 * Returns a Blob ready to download or upload to Supabase Storage.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType, PageNumber, Header, Footer,
  ImageRun, PageBreak, TableOfContents, StyleLevel,
} from 'docx';
import wordmarkUrl from '../assets/simpliigence-wordmark.png';
import iconUrl from '../assets/simpliigence-icon.png';

export interface SowSectionInput {
  heading: string;
  body: string;
  bullets?: string[];
  subSections?: Array<{ heading: string; body?: string; bullets?: string[] }>;
  table?: { headers: string[]; rows: string[][] };
}

export interface SowDocxMeta {
  clientName: string;
  effectiveDate: string;
  signerName: string;
  signerTitle: string;
}

const ORANGE = 'F97316';
const SLATE_DARK = '0F172A';
const SLATE_MID = '475569';

// Wordmark native dimensions: 5026×658. Render at 40px tall — keeps the
// header proportional and readable at print size (≈ 1.5 inches wide).
const WORDMARK_W = 245;
const WORDMARK_H = 32;
// Icon mark native dimensions: 304×433. Render at 18px tall.
const ICON_W = 13;
const ICON_H = 18;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function p(text: string, opts: { size?: number; bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    children: [new TextRun({ text, size: opts.size ?? 22, bold: opts.bold, color: opts.color ?? SLATE_DARK, font: 'Calibri' })],
  });
}

/** Section heading — Heading 1 so the auto-TOC picks it up. */
function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    border: { bottom: { color: 'E2E8F0', size: 6, space: 4, style: BorderStyle.SINGLE } },
    children: [new TextRun({ text, bold: true, color: ORANGE, size: 26, font: 'Calibri' })],
  });
}

function bullet(text: string, n: number): Paragraph {
  return new Paragraph({
    indent: { left: 360 },
    spacing: { after: 100 },
    children: [
      new TextRun({ text: `${n}.  `, bold: true, color: SLATE_MID, size: 22, font: 'Calibri' }),
      new TextRun({ text, color: SLATE_DARK, size: 22, font: 'Calibri' }),
    ],
  });
}

function buildTable(headers: string[], rows: string[][]): Table {
  const cellBorder = { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' };
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
  const colCount = headers.length;
  const colWidth = Math.floor(100 / colCount);

  const headerCells = headers.map((h) => new TableCell({
    width: { size: colWidth, type: WidthType.PERCENTAGE },
    borders,
    shading: { fill: 'F1F5F9' },
    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, color: SLATE_DARK, font: 'Calibri' })] })],
  }));

  const bodyRows = rows.map((cells) => new TableRow({
    children: cells.slice(0, colCount).map((cell) => {
      const lines = (cell || '').split(/\n/).map((l) => l.trim()).filter(Boolean);
      const paragraphs = lines.length > 1
        ? lines.map((line) => new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({ text: '•  ', color: ORANGE, size: 20, font: 'Calibri' }),
              new TextRun({ text: line, size: 20, color: SLATE_DARK, font: 'Calibri' }),
            ],
          }))
        : [new Paragraph({ children: [new TextRun({ text: lines[0] || '', size: 20, color: SLATE_DARK, font: 'Calibri' })] })];
      return new TableCell({
        width: { size: colWidth, type: WidthType.PERCENTAGE },
        borders,
        children: paragraphs,
      });
    }),
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: headerCells, tableHeader: true }), ...bodyRows],
  });
}

function signatureBlock(meta: SowDocxMeta): (Paragraph | Table)[] {
  const cellBorder = { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' };
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

  function sigCell(label: string, value: string = '') {
    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders,
      children: [
        new Paragraph({
          spacing: { before: 200, after: 400 },
          children: value ? [new TextRun({ text: value, bold: true, size: 22, font: 'Calibri' })] : [],
        }),
        new Paragraph({ children: [new TextRun({ text: label, color: SLATE_MID, size: 18, font: 'Calibri' })] }),
      ],
    });
  }

  function headerCell(text: string) {
    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders,
      shading: { fill: 'F1F5F9' },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 22, font: 'Calibri' })] })],
    });
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [headerCell('Client'), headerCell('Simpliigence Inc.')] }),
      new TableRow({ children: [sigCell('Signature'), sigCell('Signature')] }),
      new TableRow({ children: [sigCell('Printed Name', meta.signerName), sigCell('Printed Name')] }),
      new TableRow({ children: [sigCell('Title', meta.signerTitle), sigCell('Title')] }),
      new TableRow({ children: [sigCell('Date Signed'), sigCell('Date Signed')] }),
    ],
  });

  return [
    heading('ACCEPTED BY:'),
    table,
    new Paragraph({ spacing: { before: 320 }, children: [new TextRun({ text: 'Please return ALL PAGES of this Statement of Work via one of the following:', bold: true, size: 20, font: 'Calibri' })] }),
    p('By e-mail to: raghu.seetharam@simpliigence.com', { size: 20 }),
    p('By mail to: Simpliigence Inc., 8 The Green, Ste A, Dover, DE-19901', { size: 20 }),
  ];
}

/** Branded header: simpliigence wordmark, right-aligned, with an orange
 *  rule below. Appears on every page including the cover. */
function buildHeader(wordmark: Uint8Array): Header {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        border: { bottom: { color: ORANGE, size: 12, space: 4, style: BorderStyle.SINGLE } },
        children: [
          new ImageRun({
            data: wordmark,
            transformation: { width: WORDMARK_W, height: WORDMARK_H },
            type: 'png',
          }),
        ],
      }),
    ],
  });
}

/** Branded footer: small icon + address text on left, page X of Y on right. */
function buildFooter(icon: Uint8Array): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new ImageRun({
            data: icon,
            transformation: { width: ICON_W, height: ICON_H },
            type: 'png',
          }),
          new TextRun({ text: '  Simpliigence Inc. · 8 The Green, Ste A, Dover, DE-19901', color: SLATE_MID, size: 18, font: 'Calibri' }),
          new TextRun({ text: '          Page ', color: SLATE_MID, size: 18, font: 'Calibri' }),
          new TextRun({ children: [PageNumber.CURRENT], color: SLATE_MID, size: 18, font: 'Calibri' }),
          new TextRun({ text: ' of ', color: SLATE_MID, size: 18, font: 'Calibri' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], color: SLATE_MID, size: 18, font: 'Calibri' }),
        ],
      }),
    ],
  });
}

/** Cover page + auto-populated Table of Contents. Both end with a page
 *  break so they get their own dedicated page when Word renders. */
function coverAndToc(meta: SowDocxMeta): (Paragraph | TableOfContents)[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 240 },
      children: [new TextRun({ text: 'STATEMENT OF WORK', bold: true, size: 64, color: SLATE_DARK, font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { bottom: { color: ORANGE, size: 24, space: 8, style: BorderStyle.SINGLE } },
      spacing: { after: 800 },
      children: [],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Prepared for:', color: SLATE_MID, size: 28, font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 1200 },
      children: [new TextRun({ text: meta.clientName, bold: true, size: 40, color: SLATE_DARK, font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Prepared by: Simpliigence Inc.', color: SLATE_MID, size: 24, font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: `Effective Date: ${meta.effectiveDate}  ·  Confidential`, color: SLATE_MID, size: 22, font: 'Calibri' })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 160 },
      border: { bottom: { color: 'E2E8F0', size: 6, space: 4, style: BorderStyle.SINGLE } },
      children: [new TextRun({ text: 'TABLE OF CONTENTS', bold: true, color: ORANGE, size: 26, font: 'Calibri' })],
    }),
    new TableOfContents('Table of Contents', {
      hyperlink: true,
      headingStyleRange: '1-1',
      stylesWithLevels: [new StyleLevel('Heading 1', 1)],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

export async function buildSowDocxBlob(meta: SowDocxMeta, sections: SowSectionInput[]): Promise<Blob> {
  // Load both brand assets up-front. Both ship inside the JS bundle via
  // Vite's import-with-URL plumbing, so this is essentially free.
  const [wordmark, icon] = await Promise.all([
    fetchBytes(wordmarkUrl),
    fetchBytes(iconUrl),
  ]);

  const bodyParas: (Paragraph | Table)[] = [];
  for (const sec of sections) {
    bodyParas.push(heading(sec.heading));
    if (sec.body && sec.body.trim()) {
      const paras = sec.body.split(/\n\n+/);
      for (const para of paras) bodyParas.push(p(para.trim(), { size: 22 }));
    }
    if (sec.bullets && sec.bullets.length > 0) {
      sec.bullets.forEach((b, i) => bodyParas.push(bullet(b, i + 1)));
    }
    if (sec.subSections && sec.subSections.length > 0) {
      for (const sub of sec.subSections) {
        bodyParas.push(new Paragraph({
          spacing: { before: 240, after: 80 },
          children: [new TextRun({ text: sub.heading, bold: true, size: 22, color: SLATE_DARK, font: 'Calibri' })],
        }));
        if (sub.body && sub.body.trim()) bodyParas.push(p(sub.body, { size: 22 }));
        if (sub.bullets && sub.bullets.length > 0) {
          for (const b of sub.bullets) {
            bodyParas.push(new Paragraph({
              indent: { left: 720 },
              spacing: { after: 80 },
              children: [
                new TextRun({ text: '•  ', color: ORANGE, size: 22, font: 'Calibri' }),
                new TextRun({ text: b, size: 22, color: SLATE_DARK, font: 'Calibri' }),
              ],
            }));
          }
        }
      }
    }
    if (sec.table && sec.table.headers && sec.table.rows) {
      bodyParas.push(buildTable(sec.table.headers, sec.table.rows));
    }
  }

  bodyParas.push(...signatureBlock(meta));

  const doc = new Document({
    creator: 'Simpliigence Inc.',
    title: `SOW — ${meta.clientName}`,
    description: 'Statement of Work',
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: 'Calibri', bold: true, color: ORANGE, size: 26 },
          paragraph: { spacing: { before: 320, after: 160 } },
        },
      ],
    },
    sections: [
      {
        headers: { default: buildHeader(wordmark) },
        footers: { default: buildFooter(icon) },
        children: [...coverAndToc(meta), ...bodyParas],
      },
    ],
  });

  return Packer.toBlob(doc);
}
