/**
 * Builds the Word (.docx) version of a formatted profile in the Simpliigence
 * standard template (see profileTemplate.ts). Uses real Word styles —
 * Heading 1 / Heading 2 / List Bullet — so recruiters can keep editing in
 * Word and the navigation pane works.
 */
import {
  AlignmentType, Document, Footer, LevelFormat, Packer, Paragraph, TextRun,
} from 'docx';
import { parseProfile, PROFILE_STYLE as S, type Run } from './profileTemplate';

const pt = (n: number) => Math.round(n * 2); // docx sizes are half-points

function runs(rs: Run[], size = S.bodyPt): TextRun[] {
  return rs.map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic, size: pt(size) }));
}

export async function buildProfileDocx(markdown: string): Promise<{ blob: Blob; filename: string }> {
  const p = parseProfile(markdown);
  const children: Paragraph[] = [];

  if (p.name) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: p.name, bold: true, size: pt(S.namePt) })],
    }));
  }
  if (p.title) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: p.title, bold: true, size: pt(S.titlePt) })],
    }));
  }
  p.contact.forEach((c, i) => {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: i === p.contact.length - 1 ? 160 : 40 },
      children: [new TextRun({ text: c, size: pt(S.bodyPt) })],
    }));
  });

  for (const b of p.blocks) {
    switch (b.kind) {
      case 'section':
        children.push(new Paragraph({ style: 'Heading1', children: [new TextRun(b.text)] }));
        break;
      case 'sub':
        children.push(new Paragraph({ style: 'Heading2', children: [new TextRun(b.text)] }));
        break;
      case 'entry': {
        const kids: TextRun[] = [new TextRun({ text: b.text, bold: true, size: pt(S.entryPt) })];
        if (b.dates) kids.push(new TextRun({ text: b.dates, italics: true, size: pt(S.bodyPt), break: 1 }));
        children.push(new Paragraph({ spacing: { before: 100, after: 80 }, keepNext: true, children: kids }));
        break;
      }
      case 'bullet':
        children.push(new Paragraph({
          style: 'ListBullet',
          numbering: { reference: 'sp-bullets', level: 0 },
          children: runs(b.runs),
        }));
        break;
      default:
        children.push(new Paragraph({ children: runs(b.runs) }));
    }
  }

  const doc = new Document({
    creator: 'Simpliigence',
    title: p.footer || 'Simpliigence Profile',
    styles: {
      default: {
        document: {
          run: { font: S.font, size: pt(S.bodyPt) },
          paragraph: { spacing: { after: 80, line: 276 } },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: S.headingFont, bold: true, color: S.sectionColor, size: pt(S.sectionPt) },
          paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, keepLines: true, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: S.headingFont, bold: true, color: S.subColor, size: pt(S.subPt) },
          paragraph: { spacing: { before: 140, after: 40 }, keepNext: true, keepLines: true, outlineLevel: 1 },
        },
        {
          id: 'ListBullet', name: 'List Bullet', basedOn: 'Normal',
          paragraph: { spacing: { after: 30 }, contextualSpacing: true },
        },
      ],
    },
    numbering: {
      config: [{
        reference: 'sp-bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 288, hanging: 288 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 792, bottom: 792, left: 1008, right: 1008, header: 720, footer: 720 },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 0 },
            children: [new TextRun({ text: p.footer, size: pt(S.footerPt) })],
          })],
        }),
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const base = (p.name ? p.name.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : 'Candidate')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { blob, filename: `${base}_Simpliigence_Profile.docx` };
}
