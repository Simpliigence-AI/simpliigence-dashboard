/**
 * CSV export — one implementation.
 *
 * Extracted verbatim from src/pages/TeamTimePage.tsx, where this exact
 * escape/join/Blob/anchor sequence had been copy-pasted to several other
 * pages. Behaviour is deliberately unchanged: RFC 4180 escaping, CRLF row
 * separator, `text/csv;charset=utf-8`, and an anchor that is appended, clicked,
 * removed, with the object URL revoked afterwards.
 *
 * Usage:
 *   exportRowsToCsv(`time-entries-${tab}-${csvDateStamp()}.csv`, visibleRows, [
 *     { label: 'Date', value: (r) => r.workDate },
 *     ...
 *   ]);
 */

export interface CsvColumn<T> {
  label: string;
  value: (row: T) => string;
}

/** RFC 4180: quote fields containing comma, quote, or newline; double internal quotes. */
export function escapeCsvField(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: readonly T[], cols: readonly CsvColumn<T>[]): string {
  const header = cols.map((c) => c.label).join(',');
  const body = rows.map((r) => cols.map((c) => escapeCsvField(c.value(r))).join(','));
  return [header, ...body].join('\r\n');
}

/** Today as YYYY-MM-DD, for filenames ("…-2026-08-21.csv"). */
export function csvDateStamp(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Hand the browser a file to save. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Build and download in one call — what every call site actually wants. */
export function exportRowsToCsv<T>(
  filename: string,
  rows: readonly T[],
  cols: readonly CsvColumn<T>[],
): void {
  downloadCsv(filename, toCsv(rows, cols));
}
