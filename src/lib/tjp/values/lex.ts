// SPDX-License-Identifier: GPL-2.0-only
// Close translation of engine/tj/lib/taskjuggler/ProjectFileScanner.rb (TaskJuggler 3.8.4).
/**
 * A small lexer for value text, following TaskJuggler's ProjectFileScanner
 * (engine/tj/lib/taskjuggler/ProjectFileScanner.rb:24-152) for the tokens a value can hold:
 * patterns are tried in the scanner's order, anchored at the cursor, and never cross a line
 * where the scanner reads line by line. Whitespace is ASCII only (Ruby's `\s`). A line break is
 * `\n`, `\r\n` or a lone `\r`: TaskJuggler reads files through `forceUTF8Encoding`
 * (`encode('UTF-8', universal_newline: true)`, UTF8String.rb), which turns both `\r\n` and `\r`
 * into `\n` before scanning, so `.` in a Ruby pattern is `[^\r\n]` here, and a string's value has
 * `\n` for every break, as TaskJuggler reads it (the source text keeps its own breaks).
 *
 * The full-file tokenizer is `grammar/tokens.ts` (T4). This one only has to lex the slice of
 * one value, so comments and strings are handled but macro calls, environment references and
 * macro definitions simply end the value with an error (they make a value text-only, 5.4).
 */
import { raise } from './result';

export type TokenKind =
	'date' | 'time' | 'float' | 'integer' | 'id' | 'absId' | 'idColon' | 'string' | 'literal';

export type StringStyle = 'double' | 'single' | 'cut';

export interface Token {
	readonly kind: TokenKind;
	/** Source text of the token. */
	readonly text: string;
	readonly from: number;
	readonly to: number;
	/** For strings: the value TaskJuggler reads, and how it was quoted. */
	readonly str?: { readonly value: string; readonly style: StringStyle };
}

const isWs = (c: string | undefined): boolean =>
	c === ' ' || c === '\t' || c === '\n' || c === '\v' || c === '\f' || c === '\r';

const PREFIX = String.raw`(?:[-a-zA-Z_0-9>:.+]*|"(?:\\"|[^"])*?|'(?:\\'|[^'])*?)?`;
const MACRO_CALL = new RegExp(PREFIX + String.raw`\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]\w*`, 'y');
const ENV_REF = new RegExp(PREFIX + String.raw`\$\([A-Z_][A-Z_0-9]*\)`, 'y');
const MACRO_IN_TEXT = /\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]/;
const MACRO_AT = /^\$\{[ \t\n\v\f\r]*\??[a-zA-Z_]/;
const PATTERNS: ReadonlyArray<readonly [TokenKind, RegExp]> = [
	['idColon', /[a-zA-Z_]\w*:/y],
	['absId', /[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+/y],
	['id', /[a-zA-Z_]\w*/y],
	['date', /\d{4}-\d{1,2}-\d{1,2}(?:-\d{1,2}:\d{1,2}(?::\d{1,2})?(?:-[-+]?\d{4})?)?/y],
	['time', /\d{1,2}:\d{2}/y],
	['float', /\d*\.\d+/y],
	['integer', /\d+/y],
];
const CUT_END = /[ \t\n\v\f\r]*->8-/y;
const CUT_START_OK = /-8<-[ \t\n\v\f\r]*[\r\n]$/;

export class ValueLexer {
	private pos = 0;
	private peeked: Token | null | undefined;

	constructor(
		private readonly text: string,
		private readonly base = 0,
	) {}

	/** File offset just past the last consumed token (or the start). */
	get offset(): number {
		return this.base + this.pos;
	}

	/** File offset of the end of the text. */
	get end(): number {
		return this.base + this.text.length;
	}

	peek(): Token | null {
		if (this.peeked === undefined) {
			const save = this.pos;
			this.peeked = this.scan();
			this.peekEnd = this.pos;
			this.pos = save;
		}
		return this.peeked;
	}

	next(): Token | null {
		const t = this.peek();
		this.pos = this.peekEnd;
		this.peeked = undefined;
		return t;
	}

	private peekEnd = 0;

	private readonly nextCache = new Map<string, { from: number; at: number }>();

	/** `text.indexOf(ch, p)`, cached so a forward scan stays linear. */
	private findNext(ch: string, p: number): number {
		const c = this.nextCache.get(ch);
		if (c && p >= c.from && (c.at < 0 || p <= c.at)) return c.at;
		const at = this.text.indexOf(ch, p);
		this.nextCache.set(ch, { from: p, at });
		return at;
	}

	/** End of the line holding `p`, including its break (`\n`, `\r\n` or `\r`). */
	private lineEnd(p: number): number {
		const nl = this.findNext('\n', p);
		const cr = this.findNext('\r', p);
		if (cr >= 0 && (nl < 0 || cr < nl)) return cr + 1 === nl ? nl + 1 : cr + 1;
		return nl < 0 ? this.text.length : nl + 1;
	}

	/** Whether the line ending at `le` (from lineEnd) ends with a break. */
	private broken(le: number): boolean {
		const c = this.text[le - 1];
		return c === '\n' || c === '\r';
	}

	/** End of the line ending at `le`, without its break. */
	private contentEnd(le: number): number {
		const t = this.text;
		if (t[le - 1] === '\r') return le - 1;
		if (t[le - 1] !== '\n') return le;
		return t[le - 2] === '\r' ? le - 2 : le - 1;
	}

	/**
	 * Length of the sticky match of `re` at `p`, or -1. With `limit`, the match may not run past
	 * it (patterns whose classes include `\n` are confined to their line).
	 */
	private match(re: RegExp, p: number, limit?: number): number {
		const s = limit === undefined ? this.text : this.text.slice(p, limit);
		re.lastIndex = limit === undefined ? p : 0;
		const m = re.exec(s);
		return m ? m[0].length : -1;
	}

	private skipTrivia(): void {
		const t = this.text;
		for (;;) {
			const c = t[this.pos];
			if (isWs(c)) {
				this.pos++;
			} else if (c === '#' || (c === '/' && t[this.pos + 1] === '/')) {
				this.pos = this.lineEnd(this.pos);
			} else if (c === '/' && t[this.pos + 1] === '*') {
				const le = this.lineEnd(this.pos);
				const close = t.lastIndexOf('*/', le - 2);
				if (close >= this.pos + 2) {
					this.pos = close + 2; // one-line comment, greedy to the last */ on the line
				} else if (this.broken(le)) {
					this.pos = le;
					this.skipCommentLines();
				} else {
					return; // '/' then '*' as literals, as the scanner does at end of file
				}
			} else {
				return;
			}
		}
	}

	private skipCommentLines(): void {
		const start = this.pos;
		while (this.pos < this.text.length) {
			const le = this.lineEnd(this.pos);
			const close = this.text.lastIndexOf('*/', le - 2);
			if (close >= this.pos) {
				this.pos = close + 2;
				return;
			}
			this.pos = le;
		}
		raise('unterminated', this.base + start - 1, this.end);
	}

	private tok(kind: TokenKind, from: number, to: number, str?: Token['str']): Token {
		this.pos = to;
		const t = { kind, text: this.text.slice(from, to), from: this.base + from, to: this.base + to };
		return str ? { ...t, str } : t;
	}

	private scan(): Token | null {
		this.skipTrivia();
		const t = this.text;
		const p = this.pos;
		if (p >= t.length) return null;
		const le = this.lineEnd(p);
		const dollar = this.findNext('$', p);
		let n: number;
		if (dollar >= 0 && dollar < le) {
			n = this.match(MACRO_CALL, p, le);
			if (n >= 0) raise('macro-call', this.base + p, this.base + p + n);
			n = this.match(ENV_REF, p, le);
			if (n >= 0) raise('env-var', this.base + p, this.base + p + n);
		}
		for (const [kind, re] of PATTERNS) {
			n = this.match(re, p);
			if (n > 0) return this.tok(kind, p, p + n);
		}
		const c = t[p];
		if (c === '"' || c === "'") return this.quoted(p, c);
		if (t.startsWith('-8<-', p) && this.broken(le)) return this.cutHere(p, le);
		const two = t.slice(p, p + 2);
		if (two === '<=' || two === '>=' || two === '!=') return this.tok('literal', p, p + 2);
		const cp = t.codePointAt(p) ?? 0;
		return this.tok('literal', p, p + (cp > 0xffff ? 2 : 1));
	}

	private quoted(p: number, q: '"' | "'"): Token {
		const t = this.text;
		let i = p + 1;
		let value = '';
		let firstLine = true;
		/** The last `\q` escape on the current line: where it is and the value before it. */
		let lastEscape: { at: number; value: string } | null = null;
		for (;;) {
			if (i >= t.length) {
				// On a later line that ends the file without a newline, only the end pattern
				// `(\\"|[^"])*"` can match, and it backtracks: the last `\"` on the line closes the
				// string, its backslash kept (ProjectFileScanner.rb:108-112, 118-122).
				if (firstLine || lastEscape === null) raise('unterminated', this.base + p, this.end);
				const style = q === '"' ? 'double' : 'single';
				return this.tok('string', p, lastEscape.at + 2, { value: `${lastEscape.value}\\`, style });
			}
			const c = t[i];
			if (c === '\\' && t[i + 1] === q) {
				lastEscape = { at: i, value };
				value += q;
				i += 2;
			} else if (c === q) {
				break;
			} else if (c === '\r' || c === '\n') {
				// A line break: `\n`, `\r\n` or a lone `\r`, read as `\n`.
				firstLine = false;
				lastEscape = null;
				value += '\n';
				i += c === '\r' && t[i + 1] === '\n' ? 2 : 1;
			} else {
				// The scanner's in-string macro pattern (ProjectFileScanner.rb:63-66).
				if (!firstLine && c === '$' && MACRO_AT.test(t.slice(i, this.lineEnd(i)))) {
					raise('macro-call', this.base + p, this.base + this.lineEnd(i));
				}
				value += c;
				i++;
			}
		}
		return this.tok('string', p, i + 1, { value, style: q === '"' ? 'double' : 'single' });
	}

	private cutHere(p: number, le: number): Token {
		const t = this.text;
		// startStringSZR's check is unanchored (`/-8<-\s*\n$/`, ProjectFileScanner.rb:259-266): any
		// `-8<-` closing the line satisfies it, so `-8<-x-8<-` opens a string too.
		if (!CUT_START_OK.test(t.slice(p, le))) {
			raise('junk-after-cut', this.base + p, this.base + this.contentEnd(le), 'junk_after_cut');
		}
		let line = le;
		let indent: string | null = null;
		let value = '';
		for (;;) {
			if (line >= t.length) raise('unterminated', this.base + p, this.end);
			const lineEnd = this.lineEnd(line);
			const n = this.match(CUT_END, line, lineEnd);
			if (n >= 0) return this.tok('string', p, line + n, { value, style: 'cut' });
			if (MACRO_IN_TEXT.test(t.slice(line, lineEnd))) {
				raise('macro-call', this.base + line, this.base + lineEnd);
			}
			if (!this.broken(lineEnd)) raise('unterminated', this.base + p, this.end);
			// TaskJuggler sees the line with its break read as `\n`.
			const text = t.slice(line, this.contentEnd(lineEnd)) + '\n';
			if (indent === null) {
				// firstStringSZR: /(\s*)(.*\n)/ (ProjectFileScanner.rb:282-287); the indentation
				// cannot hold the line's break.
				const m = /^([ \t\v\f]*)([^\r\n]*\n)$/.exec(text);
				indent = m?.[1] ?? '';
				value += m?.[2] ?? text;
			} else {
				// midStringSZR: drop the characters that match the first line's indentation.
				let k = 0;
				while (k < indent.length && indent[k] === text[k]) k++;
				value += text.slice(k);
			}
			line = lineEnd;
		}
	}
}

/** True when `text` holds a macro call or an environment reference TaskJuggler would expand. */
export function hasExpansion(text: string): boolean {
	return MACRO_IN_TEXT.test(text) || /\$\([A-Z_][A-Z_0-9]*\)/.test(text);
}
