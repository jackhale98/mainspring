// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Port of TaskJuggler's `ProjectFileScanner` (engine/tj/lib/taskjuggler/ProjectFileScanner.rb,
 * TextParser/Scanner.rb at 3b36c79), phase-1.md 5.1.
 *
 * TaskJuggler reads one line at a time (`gets`, so lines end after `\n` only) and, in the
 * current mode, tries its patterns in order with `StringScanner#scan`: anchored at the cursor,
 * first match wins, never across the end of the line. This port runs the same regular
 * expressions, translated to ASCII classes (Ruby's `\s`, `\w`, `\d` are ASCII and `.` excludes
 * only `\n`), on the rest of the current line, in the same order.
 *
 * TaskJuggler's multi-line constructs (strings, comments, macro definitions, macro calls) are
 * mode changes; here each one is a single token, so every token starts in TaskJuggler's default
 * `tjp` mode and the scanner needs no state between tokens. Macro calls are not expanded:
 * a macro call becomes a `MacroCall`/`MacroWord` token, or flags the string it sits in. Where
 * the expansion would decide the boundaries, the port assumes it is not empty and holds no
 * quotes, backslashes, line feeds or cut marks. (An empty expansion makes TaskJuggler drop the
 * call's prefix too, so `1d${?x}` loses its `1d` natively; here it stays one `MacroWord`.)
 */
import { TokenFlag, type TjpScanError, type TjpTokenKind } from './token-kinds';

/** Access to the input from the start of the token being scanned. */
export interface LineSource {
	/**
	 * The text from `offset` (relative to the token start) to the end of its line, including
	 * the `\n`. The empty string at the end of the input.
	 */
	line(offset: number): string;
}

/** One scanned token, relative to where scanning started. */
export interface ScannedToken {
	readonly kind: TjpTokenKind;
	/** Length in UTF-16 code units, at least 1. */
	readonly length: number;
	readonly flags: number;
	readonly error: TjpScanError | null;
}

const LF = 10;

// Ruby `\s` is [ \t\n\v\f\r]; `.` is [^\n]. All patterns are sticky: anchored at lastIndex.
const RE_BLOCK_ONE_LINE = /\/\*[^\n]*\*\//y;
const RE_BLOCK_END = /[^\n]*\*\//y;
const RE_PREFIX = /[-a-zA-Z_0-9>:.+]*/y;
const RE_MACRO_HEAD = /\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]\w*(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*/y;
const RE_ENV_HEAD = /\$\([A-Z_][A-Z_0-9]*\)/y;
const RE_CALL_END = /(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*[ \t\n\v\f\r]*\}/y;
const RE_WORD = /[a-zA-Z_]\w*/y;
const RE_ABSOLUTE_TAIL = /(?:\.[a-zA-Z_]\w*)+/y;
const RE_DATE = /\d{4}-\d{1,2}-\d{1,2}(?:-\d{1,2}:\d{1,2}(?::\d{1,2})?(?:-[-+]?\d{4})?)?/y;
const RE_TIME = /\d{1,2}:\d{2}/y;
const RE_FLOAT = /\d*\.\d+/y;
const RE_INTEGER = /\d+/y;
const RE_CUT_START = /-8<-[^\n]*\n/y;
const RE_CUT_CLEAN = /-8<-[ \t\n\v\f\r]*\n$/;
const RE_CUT_END = /[ \t\n\v\f\r]*->8-/y;
const RE_CUT_MACRO = /[^\n]*?\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]\w*(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*/y;
const RE_DEF_ONE_LINE = /\[[^\n]*\]\n/y;
const RE_DEF_END = /[^\n]*\]\n/y;

/** The patterns of one string mode (`dqString` or `sqString`), without the opening quote. */
interface QuotePatterns {
	/** Macro call before the closing quote: the `dqString` start-of-call pattern. */
	readonly macro: RegExp;
	/** `$(NAME)` before the closing quote; TaskJuggler only expands it while in `tjp` mode. */
	readonly env: RegExp;
	/** The rest of the `"(\\"|[^"])*` start pattern. */
	readonly start: RegExp;
	readonly mid: RegExp;
	readonly end: RegExp;
}

const DOUBLE: QuotePatterns = {
	macro: /(?:\\"|[^"])*?\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]\w*(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*/y,
	env: /(?:\\"|[^"])*?\$\([A-Z_][A-Z_0-9]*\)/y,
	start: /(?:\\"|[^"])*/y,
	mid: /(?:\\"|[^"])*\n/y,
	end: /(?:\\"|[^"])*"/y,
};

const SINGLE: QuotePatterns = {
	macro: /(?:\\'|[^'])*?\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]\w*(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*/y,
	env: /(?:\\'|[^'])*?\$\([A-Z_][A-Z_0-9]*\)/y,
	start: /(?:\\'|[^'])*/y,
	mid: /(?:\\'|[^'])*\n/y,
	end: /(?:\\'|[^'])*'/y,
};

/** Length of the match of sticky `re` at `index` in `s`, or -1. */
function match(re: RegExp, s: string, index = 0): number {
	re.lastIndex = index;
	return re.test(s) ? re.lastIndex - index : -1;
}

function endsLine(s: string): boolean {
	return s.charCodeAt(s.length - 1) === LF;
}

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

/** `[-a-zA-Z_0-9>:.+]`, the characters a macro call prefix may hold, or `$` itself. */
function mayStartGlued(c: number): boolean {
	return (
		isLetter(c) ||
		isDigit(c) ||
		c === 45 ||
		c === 62 ||
		c === 58 ||
		c === 46 ||
		c === 43 ||
		c === 36
	);
}

function token(kind: TjpTokenKind, length: number, flags = 0): ScannedToken {
	return { kind, length, flags, error: null };
}

/** An error token from the token start to the end of the input (`runaway_token`). */
function runaway(src: LineSource, from: number, error: TjpScanError, flags = 0): ScannedToken {
	let pos = from;
	for (let line = src.line(pos); line !== ''; line = src.line(pos)) pos += line.length;
	return { kind: 'Error', length: pos, flags, error };
}

/** `macroCall` mode from `pos`, just after the call head. Returns the end, or -1 at the end of input. */
function finishCall(src: LineSource, from: number): number {
	let pos = from;
	for (;;) {
		const line = src.line(pos);
		if (line === '') return -1;
		const n = match(RE_CALL_END, line);
		if (n >= 0) return pos + n;
		if (!endsLine(line)) return -1;
		pos += line.length;
	}
}

function scanWhitespace(src: LineSource, first: string): ScannedToken {
	let pos = 0;
	let line = first;
	for (;;) {
		let i = 0;
		while (i < line.length && isSpace(line.charCodeAt(i))) i++;
		pos += i;
		if (i === 0 || i < line.length) break;
		line = src.line(pos);
		if (line === '') break;
	}
	return token('Whitespace', pos);
}

function scanBlockComment(src: LineSource, first: string): ScannedToken | null {
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
function scanGlued(src: LineSource, first: string): ScannedToken | null {
	let pos = 0;
	let line = first;
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

/**
 * A quoted string: `tjp` mode at the opening quote (macro call, env reference, then the start
 * pattern), then `dqString`/`sqString` mode (macro call, middle line, end).
 */
function scanQuoted(src: LineSource, single: boolean): ScannedToken {
	const re = single ? SINGLE : DOUBLE;
	let flags: number = single ? TokenFlag.SingleQuoted : 0;
	let pos = 1;
	// True while TaskJuggler would still be in `tjp` mode, re-reading the string from its quote.
	let opening = true;
	for (;;) {
		const line = src.line(pos);
		if (line === '') return runaway(src, 0, 'unterminated-string', flags);
		const env: number = opening ? match(re.env, line) : -1;
		if (env >= 0) flags |= TokenFlag.Env;
		const call = match(re.macro, line);
		if (call >= 0) {
			flags |= TokenFlag.Macro;
			const end = finishCall(src, pos + call);
			if (end < 0) return runaway(src, 0, 'unterminated-macro-call', flags);
			pos = end;
			continue;
		}
		if (opening) {
			pos += env >= 0 ? env : match(re.start, line);
			opening = env >= 0;
			continue;
		}
		const mid = match(re.mid, line);
		if (mid >= 0) {
			pos += mid;
			continue;
		}
		const end = match(re.end, line);
		if (end >= 0) return token('String', pos + end, flags);
		return runaway(src, 0, 'unterminated-string', flags);
	}
}

/** A cut-here string: `-8<-.*\n`, then `szrString1`/`szrString` mode. */
function scanCutHere(src: LineSource, first: string): ScannedToken | null {
	const head = match(RE_CUT_START, first);
	if (head < 0) return null;
	// TaskJuggler reports junk first (and stops), so it wins over an unterminated string.
	const junk = head !== 5 && !RE_CUT_CLEAN.test(first.slice(0, head));
	const unterminated: TjpScanError = junk ? 'junk-after-cut' : 'unterminated-string';
	let flags: number = TokenFlag.CutHere;
	let pos = head;
	// After a call TaskJuggler rescans `prefix + expansion + rest`, so `\s*->8-` cannot match
	// right after the `}` (the expansion is assumed not to start with a cut mark).
	let afterCall = false;
	for (;;) {
		const line = src.line(pos);
		if (line === '') return runaway(src, 0, unterminated, flags);
		const close = afterCall ? -1 : match(RE_CUT_END, line);
		afterCall = false;
		if (close >= 0) {
			pos += close;
			break;
		}
		const call = match(RE_CUT_MACRO, line);
		if (call >= 0) {
			flags |= TokenFlag.Macro;
			const end = finishCall(src, pos + call);
			if (end < 0) return runaway(src, 0, junk ? unterminated : 'unterminated-macro-call', flags);
			pos = end;
			afterCall = true;
			continue;
		}
		if (!endsLine(line)) return runaway(src, 0, unterminated, flags);
		pos += line.length;
	}
	if (junk) return { kind: 'Error', length: pos, flags, error: 'junk-after-cut' };
	return token('String', pos, flags);
}

/** A macro definition body `[ … ]`, single line (`\[.*\]\n`) or `macroDef` mode. */
function scanMacroBody(src: LineSource, first: string): ScannedToken | null {
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

function scanWord(first: string): ScannedToken {
	const n = match(RE_WORD, first);
	if (first.charCodeAt(n) === 58) return token('ScenarioPrefix', n + 1);
	const tail = match(RE_ABSOLUTE_TAIL, first, n);
	return tail > 0 ? token('AbsoluteId', n + tail) : token('Identifier', n);
}

function scanNumber(first: string): ScannedToken {
	let n = match(RE_DATE, first);
	if (n > 0) return token('Date', n);
	n = match(RE_TIME, first);
	if (n > 0) return token('Time', n);
	n = match(RE_FLOAT, first);
	if (n > 0) return token('Float', n);
	return token('Integer', match(RE_INTEGER, first));
}

function scanPunct(first: string, c: number): ScannedToken {
	// `<=?`, `>=?`, `!=?`, then `.`: one code point.
	if ((c === 60 || c === 62 || c === 33) && first.charCodeAt(1) === 61) return token('Punct', 2);
	const low = first.charCodeAt(1);
	const pair = c >= 0xd800 && c <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
	return token('Punct', pair ? 2 : 1);
}

/**
 * Scan the token that starts at offset 0 of `src`, in TaskJuggler's `tjp` mode. `atStart` is
 * true at offset 0 of the file, where a U+FEFF is a `Bom`. Returns null at the end of input.
 * Never throws; an unterminated construct becomes an `Error` token that runs to the end.
 */
export function scanToken(src: LineSource, atStart: boolean): ScannedToken | null {
	const first = src.line(0);
	if (first === '') return null;
	const c = first.charCodeAt(0);
	if (atStart && c === 0xfeff) return token('Bom', 1);
	// `\s+`, `#.*\n?`, `\/\/.*\n?`: the comment's line feed is left to the whitespace token.
	if (isSpace(c)) return scanWhitespace(src, first);
	const next = first.charCodeAt(1);
	if (c === 35 || (c === 47 && next === 47)) {
		return token('LineComment', first.length - (endsLine(first) ? 1 : 0));
	}
	if (c === 47 && next === 42) {
		const comment = scanBlockComment(src, first);
		if (comment) return comment;
	}
	// Macro call and env reference with a glued prefix; quoted prefixes are handled with strings.
	if (mayStartGlued(c) && first.includes('$')) {
		const glued = scanGlued(src, first);
		if (glued) return glued;
	}
	if (isLetter(c)) return scanWord(first);
	if (isDigit(c)) return scanNumber(first);
	if (c === 46) {
		const n = match(RE_FLOAT, first);
		if (n > 0) return token('Float', n);
	}
	if (c === 34 || c === 39) return scanQuoted(src, c === 39);
	if (c === 45) {
		const cut = scanCutHere(src, first);
		if (cut) return cut;
	}
	if (c === 91) {
		const body = scanMacroBody(src, first);
		if (body) return body;
	}
	return scanPunct(first, c);
}
