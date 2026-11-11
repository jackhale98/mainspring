// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A small lexer for value text, following TaskJuggler's ProjectFileScanner
 * (engine/tj/lib/taskjuggler/ProjectFileScanner.rb:24-152) for the tokens a value can hold:
 * patterns are tried in the scanner's order, anchored at the cursor, and never cross a line
 * where the scanner reads line by line. Whitespace is ASCII only (Ruby's `\s`), and `.` in a
 * Ruby pattern is `[^\n]` here (JavaScript's `.` would also stop at `\r`).
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

	/** End of the line holding `p`, including its `\n`. */
	private lineEnd(p: number): number {
		const nl = this.text.indexOf('\n', p);
		return nl < 0 ? this.text.length : nl + 1;
	}

	private match(re: RegExp, p: number, limit: number): number {
		re.lastIndex = p;
		const m = re.exec(this.text.slice(0, limit));
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
				const line = t.slice(0, le);
				const close = line.lastIndexOf('*/');
				if (close >= this.pos + 2) {
					this.pos = close + 2; // one-line comment, greedy to the last */ on the line
				} else if (t[le - 1] === '\n') {
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
			const close = this.text.slice(0, le).lastIndexOf('*/');
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
		let n = this.match(MACRO_CALL, p, le);
		if (n >= 0) raise('macro-call', this.base + p, this.base + p + n);
		n = this.match(ENV_REF, p, le);
		if (n >= 0) raise('env-var', this.base + p, this.base + p + n);
		for (const [kind, re] of PATTERNS) {
			n = this.match(re, p, le);
			if (n > 0) return this.tok(kind, p, p + n);
		}
		const c = t[p];
		if (c === '"' || c === "'") return this.quoted(p, c);
		if (t.startsWith('-8<-', p) && t[le - 1] === '\n') return this.cutHere(p, le);
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
		for (;;) {
			if (i >= t.length) raise('unterminated', this.base + p, this.end);
			const c = t[i];
			if (c === '\\' && t[i + 1] === q) {
				value += q;
				i += 2;
			} else if (c === q) {
				break;
			} else {
				if (c === '\n') firstLine = false;
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
		for (let i = p + 4; i < le; i++) {
			if (!isWs(t[i])) raise('junk-after-cut', this.base + p, this.base + le - 1, 'junk_after_cut');
		}
		let line = le;
		let indent: string | null = null;
		let value = '';
		for (;;) {
			if (line >= t.length) raise('unterminated', this.base + p, this.end);
			const lineEnd = this.lineEnd(line);
			const n = this.match(CUT_END, line, lineEnd);
			if (n >= 0) return this.tok('string', p, line + n, { value, style: 'cut' });
			const text = t.slice(line, lineEnd);
			if (MACRO_IN_TEXT.test(text)) raise('macro-call', this.base + line, this.base + lineEnd);
			if (!text.endsWith('\n')) raise('unterminated', this.base + p, this.end);
			if (indent === null) {
				// firstStringSZR: /(\s*)(.*\n)/ (ProjectFileScanner.rb:282-287)
				const m = /^([ \t\n\v\f\r]*)([^\n]*\n)$/.exec(text);
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
