// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * CSV text as RFC 4180 writes it (phase-4.md 18.20, T18): fields with a comma, a double quote or a
 * line break are quoted and their quotes doubled, records end with CRLF, and the file starts with
 * a UTF-8 byte order mark so that a spreadsheet opens it as UTF-8 and not as the local code page.
 * Nothing here knows about plans: `tasks-csv.ts` makes the rows.
 */

/** U+FEFF: written as the three bytes EF BB BF at the start of a UTF-8 file. */
export const BOM = '﻿';

/** The media type a download of the file carries. */
export const CSV_TYPE = 'text/csv;charset=utf-8';

/** One field, quoted only when it has to be. */
export function csvField(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Records of fields as CSV text, each ended by CRLF, without the byte order mark. */
export function csvText(rows: readonly (readonly string[])[]): string {
	return rows.map((r) => `${r.map(csvField).join(',')}\r\n`).join('');
}

/** The file's contents: the rows as CSV with the byte order mark first. */
export function csvFile(rows: readonly (readonly string[])[]): string {
	return BOM + csvText(rows);
}
