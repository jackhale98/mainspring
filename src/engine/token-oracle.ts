// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The token oracle's result (phase-1 spec 5.1 and 6.9, task T19): TaskJuggler's own scanner run
 * over one text by `NodeEngine.tokens(text)` (runtime.ts). It is a test oracle for the TypeScript
 * scanner port; the worker never exposes it. engine/bridge/tokens.rb documents the shape and how
 * the scanner's modes appear in it; engine/golden/README.md has the summary.
 *
 * `checkTokenStream` checks a result against its text: the items tile the text, and each item's
 * `text` is what its offsets slice from the text. The smoke test, engine/golden/run-wasm.mjs
 * `--tokens` and engine/golden/check-tokens.mjs use it. Relative imports name their `.ts` file
 * so that Node's type stripping can load this module directly.
 */

/** TaskJuggler's token types (ProjectFileScanner). */
export type OracleTokenType =
	| 'ID'
	| 'ABSOLUTE_ID'
	| 'ID_WITH_COLON'
	| 'DATE'
	| 'TIME'
	| 'FLOAT'
	| 'INTEGER'
	| 'STRING'
	| 'MACRO'
	| 'LITERAL';

/** A `${...}` macro call or `$(NAME)` reference, which the oracle reads as one `_`. */
export interface OracleMacroCall {
	kind: 'macro' | 'env';
	/** From `${` (or `$(`) to after `}` (or `)`), without the glued prefix. */
	from: number;
	to: number;
	/** Without the `?` of an optional call. */
	name: string;
	optional: boolean;
	/** The quoted call arguments, unescaped. */
	args: string[];
}

interface OracleItemBase {
	/** UTF-16 offsets in the text (JavaScript string indices); `to` is exclusive. */
	from: number;
	to: number;
	/** What the scanner read: the slice with CRLF and CR as LF and each macro call as `_`. */
	text: string;
}

export interface OracleToken extends OracleItemBase {
	kind: 'token';
	type: OracleTokenType;
	/** Number for INTEGER, FLOAT, TIME (seconds) and DATE (epoch seconds), else a string. */
	value: string | number;
	/** TaskJuggler's own line number for the token. */
	line: number;
	/** The macro calls inside this token, in order. */
	macros: OracleMacroCall[];
}

export interface OracleTrivia extends OracleItemBase {
	kind: 'whitespace' | 'comment' | 'bom';
}

export type OracleItem = OracleToken | OracleTrivia;

/** A scanner error (runaway_token, junk_after_cut, time_bad_hour, ...). Nothing follows it. */
export interface OracleScanError {
	id: string;
	message: string;
	line: number | null;
	/** Start of the unfinished token, comment or macro call. */
	from: number;
	/** Where scanning stopped. */
	to: number;
}

export interface TokenOracleResult {
	units: 'utf16';
	/** Tokens and trivia in text order, tiling the text up to `scanError.from` or its end. */
	tokens: OracleItem[];
	scanError: OracleScanError | null;
}

const lineEnds = (s: string): string => s.replace(/\r\n?/g, '\n');

/** What the scanner should have read for `item`: its slice, line ends as LF, calls as `_`. */
export function expectedScannedText(text: string, item: OracleItem): string {
	if (item.kind !== 'token' || item.macros.length === 0) {
		return lineEnds(text.slice(item.from, item.to));
	}
	let out = '';
	let at = item.from;
	for (const call of item.macros) {
		out += `${lineEnds(text.slice(at, call.from))}_`;
		at = call.to;
	}
	return out + lineEnds(text.slice(at, item.to));
}

/** Problems with `result` as the oracle's answer for `text`; empty when it is consistent. */
export function checkTokenStream(text: string, result: TokenOracleResult): string[] {
	const problems: string[] = [];
	const end = result.scanError ? result.scanError.from : text.length;
	let at = 0;
	result.tokens.forEach((item, i) => {
		const where = `item ${i} (${item.kind} ${item.from}-${item.to})`;
		if (item.from !== at) problems.push(`${where} starts at ${item.from}, expected ${at}`);
		if (item.to <= item.from) problems.push(`${where} is empty`);
		if (item.kind === 'bom' && (item.from !== 0 || text[0] !== '\uFEFF')) {
			problems.push(`${where} is not a leading U+FEFF`);
		}
		if (item.kind === 'token') {
			let last = item.from;
			for (const call of item.macros) {
				const slice = text.slice(call.from, call.to);
				if (call.from < last || call.to > item.to || !/^\$[{(][^]*[})]$/.test(slice)) {
					problems.push(`${where} has a macro call at ${call.from}-${call.to}: ${JSON.stringify(slice)}`);
				}
				last = call.to;
			}
		}
		const expected = expectedScannedText(text, item);
		if (expected !== item.text) {
			problems.push(`${where} text ${JSON.stringify(item.text)}, slice gives ${JSON.stringify(expected)}`);
		}
		at = item.to;
	});
	if (at !== end) problems.push(`items end at ${at}, expected ${end}`);
	const error = result.scanError;
	if (error && (error.to < error.from || error.to > text.length)) {
		problems.push(`scanError ${error.id} has range ${error.from}-${error.to}`);
	}
	return problems;
}
