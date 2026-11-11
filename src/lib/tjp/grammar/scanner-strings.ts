// SPDX-License-Identifier: GPL-2.0-only
// Port of the string modes (dqString, sqString, szrString1, szrString) of TaskJuggler's
// engine/tj/lib/taskjuggler/ProjectFileScanner.rb at 3b36c79.
/**
 * Quoted and cut-here strings. Each is one token here; inside it the port follows TaskJuggler's
 * mode patterns line by line, skipping over macro calls (which flag the string as templated).
 */
import {
	endsLine,
	finishCall,
	match,
	runaway,
	token,
	type ScanSource,
	type ScannedToken,
} from './scanner-core';
import { TokenFlag, type TjpScanError } from './token-kinds';

const RE_CUT_START = /-8<-[^\n]*\n/y;
const RE_CUT_CLEAN = /-8<-[ \t\n\v\f\r]*\n$/;
const RE_CUT_END = /[ \t\n\v\f\r]*->8-/y;
const RE_CUT_MACRO = /[^\n]*?\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]\w*(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*/y;

/** The patterns of one string mode (`dqString` or `sqString`), without the opening quote. */
interface QuotePatterns {
	readonly quote: number;
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
	quote: 34,
	macro: /(?:\\"|[^"])*?\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]\w*(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*/y,
	env: /(?:\\"|[^"])*?\$\([A-Z_][A-Z_0-9]*\)/y,
	start: /(?:\\"|[^"])*/y,
	mid: /(?:\\"|[^"])*\n/y,
	end: /(?:\\"|[^"])*"/y,
};

const SINGLE: QuotePatterns = {
	quote: 39,
	macro: /(?:\\'|[^'])*?\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]\w*(?:[ \t\n\v\f\r]*"(?:\\"|[^"])*")*/y,
	env: /(?:\\'|[^'])*?\$\([A-Z_][A-Z_0-9]*\)/y,
	start: /(?:\\'|[^'])*/y,
	mid: /(?:\\'|[^'])*\n/y,
	end: /(?:\\'|[^'])*'/y,
};

/**
 * The text the string patterns can see from `pos`. Without a `$` before the first unescaped
 * quote, every pattern of the mode stops at that quote or at the end of the line, so reading up
 * to it gives the same matches as the whole line (and keeps a line of many short strings
 * linear). With a `$`, macro arguments may hold quotes, so the whole line is returned.
 */
function segment(src: ScanSource, pos: number, quote: number): string {
	let prev = -1;
	for (let i = 0; ; i++) {
		const c = src.peek(pos + i);
		if (c < 0) return src.slice(pos, i);
		if (c === 36) return src.line(pos);
		// A quote right after a backslash is escaped (`\\"` and `[^"]` both reach it).
		if ((c === quote && (i === 0 || prev !== 92)) || c === 10) return src.slice(pos, i + 1);
		prev = c;
	}
}

/**
 * A quoted string: `tjp` mode at the opening quote (macro call, env reference, then the start
 * pattern), then `dqString`/`sqString` mode (macro call, middle line, end).
 */
export function scanQuoted(src: ScanSource, single: boolean): ScannedToken {
	const re = single ? SINGLE : DOUBLE;
	let flags: number = single ? TokenFlag.SingleQuoted : 0;
	let pos = 1;
	// True while TaskJuggler would still be in `tjp` mode, re-reading the string from its quote.
	let opening = true;
	for (;;) {
		const line = segment(src, pos, re.quote);
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
export function scanCutHere(src: ScanSource): ScannedToken | null {
	const first = src.line(0);
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
