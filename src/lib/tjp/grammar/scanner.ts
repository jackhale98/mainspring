// SPDX-License-Identifier: GPL-2.0-only
// Port of TaskJuggler's engine/tj/lib/taskjuggler/ProjectFileScanner.rb (token patterns) and
// TextParser/Scanner.rb (line-by-line scanning) at 3b36c79.
/**
 * The TJP scanner, phase-1.md 5.1.
 *
 * TaskJuggler reads one line at a time (`gets`, so lines end after `\n` only) and, in the
 * current mode, tries its patterns in order with `StringScanner#scan`: anchored at the cursor,
 * first match wins, never across the end of the line. This port runs the same regular
 * expressions, translated to ASCII classes (Ruby's `\s`, `\w`, `\d` are ASCII and `.` excludes
 * only `\n`), in the same order. It reads only as far as the patterns can look: identifiers,
 * numbers and punctuation read their own `[-a-zA-Z_0-9>:.+]*` run plus two code units (for a
 * glued `${`/`$(`), so long lines stay linear and Lezer's recorded lookahead stays short.
 *
 * TaskJuggler's multi-line constructs (strings, comments, macro definitions, macro calls) are
 * mode changes; here each one is a single token, so every token starts in TaskJuggler's default
 * `tjp` mode and the scanner needs no state between tokens. Macro calls are not expanded:
 * a macro call becomes a `MacroCall`/`MacroWord` token, or flags the string it sits in. Where
 * the expansion would decide the boundaries, the port assumes it is not empty and holds no
 * quotes, backslashes, line feeds or cut marks. (An empty expansion makes TaskJuggler drop the
 * call's prefix too, so `1d${?x}` loses its `1d` natively; here it stays one `MacroWord`.)
 *
 * For edits and formatting (T10, T12): a `MacroBody` ends at its `]`, but TaskJuggler only
 * closes a macro body on `]` immediately followed by `\n`. That line feed is load-bearing:
 * never insert text between the `]` and it, never remove it, never turn it into `\r\n`.
 */
import { endsLine, finishCall, match, runaway, token, RE_MACRO_HEAD } from './scanner-core';
import type { ScanSource, ScannedToken } from './scanner-core';
import { scanCutHere, scanQuoted } from './scanner-strings';
import { TokenFlag } from './token-kinds';

export type { ScanSource, ScannedToken } from './scanner-core';

const RE_BLOCK_ONE_LINE = /\/\*[^\n]*\*\//y;
const RE_BLOCK_END = /[^\n]*\*\//y;
const RE_PREFIX = /[-a-zA-Z_0-9>:.+]*/y;
const RE_ENV_HEAD = /\$\([A-Z_][A-Z_0-9]*\)/y;
const RE_WORD = /[a-zA-Z_]\w*/y;
const RE_ABSOLUTE_TAIL = /(?:\.[a-zA-Z_]\w*)+/y;
const RE_DATE = /\d{4}-\d{1,2}-\d{1,2}(?:-\d{1,2}:\d{1,2}(?::\d{1,2})?(?:-[-+]?\d{4})?)?/y;
const RE_TIME = /\d{1,2}:\d{2}/y;
const RE_FLOAT = /\d*\.\d+/y;
const RE_INTEGER = /\d+/y;
const RE_DEF_ONE_LINE = /\[[^\n]*\]\n/y;
const RE_DEF_END = /[^\n]*\]\n/y;

function isSpace(c: number): boolean {
	// ' ', \t, \n, \v, \f, \r
	return c === 32 || (c >= 9 && c <= 13);
}

function isLetter(c: number): boolean {
	return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95;
}

function isDigit(c: number): boolean {
	return c >= 48 && c <= 57;
}

/** `[-a-zA-Z_0-9>:.+]`, the characters of a macro call prefix. */
function isPrefixChar(c: number): boolean {
	return isLetter(c) || isDigit(c) || c === 45 || c === 62 || c === 58 || c === 46 || c === 43;
}

function scanWhitespace(src: ScanSource): ScannedToken {
	let n = 1;
	while (isSpace(src.peek(n))) n++;
	return token('Whitespace', n);
}

/** `#.*\n?` and `\/\/.*\n?`; the line feed is left to the whitespace token. */
function scanLineComment(src: ScanSource): ScannedToken {
	let n = 1;
	for (let c = src.peek(n); c >= 0 && c !== 10; c = src.peek(n)) n++;
	return token('LineComment', n);
}

function scanBlockComment(src: ScanSource): ScannedToken | null {
	const first = src.line(0);
	const one = match(RE_BLOCK_ONE_LINE, first);
	if (one >= 0) return token('BlockComment', one);
	// `/\*([^*]*[^\/]|.*)\n` matches whenever the line ends with a line feed.
	if (!endsLine(first)) return null;
	let pos = first.length;
	for (;;) {
		const line = src.line(pos);
		if (line === '') return runaway(src, 0, 'unterminated-comment');
		const n = match(RE_BLOCK_END, line);
		if (n >= 0) return token('BlockComment', pos + n);
		if (!endsLine(line)) return runaway(src, 0, 'unterminated-comment');
		pos += line.length;
	}
}

/**
 * Macro calls and `$(NAME)` references with their glued prefix (`[-a-zA-Z_0-9>:.+]*`), as the
 * `tjp`-mode patterns match them, chained while another call follows, plus any glued suffix.
 */
function scanGlued(src: ScanSource): ScannedToken | null {
	let pos = 0;
	let line = src.line(0);
	let macros = 0;
	let envs = 0;
	let glued = false;
	for (;;) {
		const prefix = match(RE_PREFIX, line);
		const head = match(RE_MACRO_HEAD, line, prefix);
		if (head >= 0) {
			const end = finishCall(src, pos + prefix + head);
			if (end < 0) return runaway(src, 0, 'unterminated-macro-call', TokenFlag.Macro);
			glued ||= prefix > 0 || macros + envs > 0;
			macros++;
			pos = end;
		} else {
			const env = match(RE_ENV_HEAD, line, prefix);
			if (env < 0) {
				if (macros + envs === 0) return null;
				if (prefix > 0) glued = true;
				pos += prefix;
				break;
			}
			glued ||= prefix > 0 || macros + envs > 0;
			envs++;
			pos += prefix + env;
		}
		line = src.line(pos);
	}
	const flags = (macros > 0 ? TokenFlag.Macro : 0) | (envs > 0 ? TokenFlag.Env : 0);
	return token(macros === 0 ? 'EnvRef' : glued ? 'MacroWord' : 'MacroCall', pos, flags);
}

/** A macro definition body `[ … ]`, single line (`\[.*\]\n`) or `macroDef` mode. */
function scanMacroBody(src: ScanSource): ScannedToken | null {
	const first = src.line(0);
	const one = match(RE_DEF_ONE_LINE, first);
	if (one >= 0) return token('MacroBody', one - 1);
	if (!endsLine(first)) return null;
	let pos = first.length;
	for (;;) {
		const line = src.line(pos);
		if (line === '') return runaway(src, 0, 'unterminated-macro-body');
		const end = match(RE_DEF_END, line);
		if (end >= 0) return token('MacroBody', pos + end - 1);
		if (!endsLine(line)) return runaway(src, 0, 'unterminated-macro-body');
		pos += line.length;
	}
}

/** `ID_WITH_COLON`, `ABSOLUTE_ID`, `ID`, on the token's prefix-character run. */
function scanWord(run: string): ScannedToken {
	const n = match(RE_WORD, run);
	if (run.charCodeAt(n) === 58) return token('ScenarioPrefix', n + 1);
	const tail = match(RE_ABSOLUTE_TAIL, run, n);
	return tail > 0 ? token('AbsoluteId', n + tail) : token('Identifier', n);
}

/** `DATE`, `TIME`, `FLOAT`, `INTEGER`; all their characters are prefix characters. */
function scanNumber(run: string): ScannedToken {
	let n = match(RE_DATE, run);
	if (n > 0) return token('Date', n);
	n = match(RE_TIME, run);
	if (n > 0) return token('Time', n);
	n = match(RE_FLOAT, run);
	if (n > 0) return token('Float', n);
	return token('Integer', match(RE_INTEGER, run));
}

function scanPunct(src: ScanSource, c: number): ScannedToken {
	// `<=?`, `>=?`, `!=?`, then `.`: one code point.
	const next = src.peek(1);
	if ((c === 60 || c === 62 || c === 33) && next === 61) return token('Punct', 2);
	const pair = c >= 0xd800 && c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
	return token('Punct', pair ? 2 : 1);
}

/**
 * Scan the token that starts at offset 0 of `src`, in TaskJuggler's `tjp` mode. `atStart` is
 * true at offset 0 of the file, where a U+FEFF is a `Bom`. Returns null at the end of input.
 * Never throws; an unterminated construct becomes an `Error` token that runs to the end.
 */
export function scanToken(src: ScanSource, atStart: boolean): ScannedToken | null {
	const c = src.peek(0);
	if (c < 0) return null;
	if (atStart && c === 0xfeff) return token('Bom', 1);
	// Pattern order: `\s+`, `#…`, `//…`, `/*…*/`, `/*…\n`, then macro call and env reference.
	if (isSpace(c)) return scanWhitespace(src);
	const next = src.peek(1);
	if (c === 35 || (c === 47 && next === 47)) return scanLineComment(src);
	if (c === 47 && next === 42) {
		const comment = scanBlockComment(src);
		if (comment) return comment;
	}
	// Quoted macro prefixes (`"…${`) are handled with strings; others are this run.
	let run = 0;
	while (isPrefixChar(src.peek(run))) run++;
	if (src.peek(run) === 36) {
		const brace = src.peek(run + 1);
		if (brace === 123 || brace === 40) {
			const glued = scanGlued(src);
			if (glued) return glued;
		}
	}
	if (isLetter(c)) return scanWord(src.slice(0, run));
	if (isDigit(c)) return scanNumber(src.slice(0, run));
	if (c === 46) {
		const n = match(RE_FLOAT, src.slice(0, run));
		if (n > 0) return token('Float', n);
	}
	if (c === 34 || c === 39) return scanQuoted(src, c === 39);
	if (c === 45 && next === 56 && src.peek(2) === 60 && src.peek(3) === 45) {
		const cut = scanCutHere(src);
		if (cut) return cut;
	}
	if (c === 91) {
		const body = scanMacroBody(src);
		if (body) return body;
	}
	return scanPunct(src, c);
}
