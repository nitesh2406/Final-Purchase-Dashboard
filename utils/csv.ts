// Minimal CSV builder/downloader (RFC 4180 quoting). Several screens each
// hand-roll this inline; new code should use this instead.

export type CsvCell = string | number | boolean | null | undefined;

const escapeCell = (cell: CsvCell): string => {
  if (cell === null || cell === undefined) return '';
  const s = String(cell);
  // Quote if it contains a delimiter, quote or newline; double any quotes.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: CsvCell[][]): string {
  return rows.map(r => r.map(escapeCell).join(',')).join('\r\n');
}

// Triggers a browser download. The BOM makes Excel read the file as UTF-8
// (product names contain ¥/₹ and non-ASCII characters).
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
