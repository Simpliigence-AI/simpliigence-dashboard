/**
 * Generates a .docx Statement of Work from structured SOW sections.
 *
 * Visual design matches the Simpliigence Marnoa template:
 *   - Title page with "STATEMENT OF WORK" + "Prepared for" + client name
 *   - Section headings in Simpliigence orange (#F97316), uppercase
 *   - Numbered bullet lists inside sections
 *   - Acceptance signature block
 *   - Footer on every page with the Dover, DE registered office
 *
 * Returns a Blob ready to download or upload to Supabase Storage.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType, PageNumber, Header, Footer,
} from 'docx';

export interface SowSectionInput {
  heading: string;
  body: string;
  bullets?: string[];
  /** Sub-sections — used for the premium template's Discovery / Build categories
   *  where each area has a label + nested bullets. */
  subSections?: Array<{ heading: string; body?: string; bullets?: string[] }>;
  /** Tabular content — used for Summary of Deliverables, Testing Deliverables,
   *  Training Deliverables, and Pricing Milestones. */
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

function p(text: string, opts: { size?: number; bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    children: [new TextRun({ text, size: opts.size ?? 22, bold: opts.bold, color: opts.color ?? SLATE_DARK, font: 'Calibri' })],
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
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

/** Generic 2- or 3-column table for Deliverables / Testing / Training / Pricing
 *  Milestones. Header row in slate-50; body rows alternate with light slate
 *  border. Bullet-list cells: if a cell contains \n-separated lines, render
 *  each as a bullet inside that cell. */
function buildTable(headers: string[], rows: string[][]): Table {
  const cellBorder = { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0' };
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
  const colCount = headers.length;
  const colWidth = Math.floor(100 / colCount);

  const headerCells = headers.map((h) => new TableCell({
    width: { size: colWidth, type: WidthType.PERCENTAGE },
    borders,
    shading: { fill: 'F1F5F9' },
    children: [new Paragraph({
      children: [new TextRun({ text: h, bold: true, size: 20, color: SLATE_DARK, font: 'Calibri' })],
    })],
  }));

  const bodyRows = rows.map((cells) => new TableRow({
    children: cells.slice(0, colCount).map((cell) => {
      // If cell has multiple lines, render as bullets.
      const lines = (cell || '').split(/\n/).map((l) => l.trim()).filter(Boolean);
      const paragraphs = lines.length > 1
        ? lines.map((line) => new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({ text: '•  ', color: ORANGE, size: 20, font: 'Calibri' }),
              new TextRun({ text: line, size: 20, color: SLATE_DARK, font: 'Calibri' }),
            ],
          }))
        : [new Paragraph({
            children: [new TextRun({ text: lines[0] || '', size: 20, color: SLATE_DARK, font: 'Calibri' })],
          })];
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
        new Paragraph({
          children: [new TextRun({ text: label, color: SLATE_MID, size: 18, font: 'Calibri' })],
        }),
      ],
    });
  }

  function headerCell(text: string) {
    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders,
      shading: { fill: 'F1F5F9' },
      children: [new Paragraph({
        children: [new TextRun({ text, bold: true, size: 22, font: 'Calibri' })],
      })],
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

export async function buildSowDocxBlob(meta: SowDocxMeta, sections: SowSectionInput[]): Promise<Blob> {
  // Cover page
  const cover: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: 1200, after: 200 },
      children: [new TextRun({ text: 'STATEMENT OF WORK', bold: true, size: 56, color: SLATE_DARK, font: 'Calibri' })],
    }),
    new Paragraph({
      border: { bottom: { color: ORANGE, size: 18, space: 4, style: BorderStyle.SINGLE } },
      spacing: { after: 600 },
      children: [],
    }),
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Prepared for', color: SLATE_MID, size: 22, font: 'Calibri' })],
    }),
    new Paragraph({
      spacing: { after: 600 },
      children: [new TextRun({ text: meta.clientName, bold: true, size: 36, color: SLATE_DARK, font: 'Calibri' })],
    }),
    new Paragraph({
      children: [new TextRun({ text: `Effective Date: ${meta.effectiveDate}`, color: SLATE_MID, size: 22, font: 'Calibri' })],
    }),
    new Paragraph({ children: [new TextRun({ text: '', break: 30 })] }),  // page break-ish spacer
  ];

  // Section bodies
  const bodyParas: (Paragraph | Table)[] = [];
  for (const sec of sections) {
    bodyParas.push(heading(sec.heading));
    if (sec.body && sec.body.trim()) {
      // Allow paragraph splits on double newlines.
      const paras = sec.body.split(/\n\n+/);
      for (const para of paras) {
        bodyParas.push(p(para.trim(), { size: 22 }));
      }
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
        if (sub.body && sub.body.trim()) {
          bodyParas.push(p(sub.body, { size: 22 }));
        }
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

  // Acceptance + footer
  bodyParas.push(...signatureBlock(meta));

  const doc = new Document({
    creator: 'Simpliigence Inc.',
    title: `SOW — ${meta.clientName}`,
    description: 'Statement of Work',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [
      {
        headers: {
          default: new Header({
            children: [new Paragraph({
              border: { bottom: { color: ORANGE, size: 18, space: 4, style: BorderStyle.SINGLE } },
              children: [new TextRun({ text: 'Simpliigence', bold: true, color: SLATE_DARK, size: 24, font: 'Calibri' })],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({ text: 'Simpliigence Inc. · 8 The Green, Ste A, Dover, DE-19901', color: SLATE_MID, size: 18, font: 'Calibri' }),
                  new TextRun({ text: '          Page ', color: SLATE_MID, size: 18, font: 'Calibri' }),
                  new TextRun({ children: [PageNumber.CURRENT], color: SLATE_MID, size: 18, font: 'Calibri' }),
                  new TextRun({ text: ' of ', color: SLATE_MID, size: 18, font: 'Calibri' }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], color: SLATE_MID, size: 18, font: 'Calibri' }),
                ],
              }),
            ],
          }),
        },
        children: [...cover, ...bodyParas],
      },
    ],
  });

  return Packer.toBlob(doc);
}
