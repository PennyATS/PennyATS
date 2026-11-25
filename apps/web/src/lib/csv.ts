/**
 * CSV for spreadsheet downloads.
 *
 * Cells that start with = + - @ (or a tab or carriage return) are prefixed with a single
 * quote. Otherwise text a candidate typed, like a source or name, could run as a formula
 * when the file is opened in Excel or Google Sheets ("CSV injection").
 */
export function toCsv(head: string[], rows: (string | number | null)[][]): string {
  const lines = [head, ...rows].map((row) => row.map(cell).join(","));
  // Leading BOM so Excel reads UTF-8 (names with accents) correctly; CRLF per RFC 4180.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function cell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
