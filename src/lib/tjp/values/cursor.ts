// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Token cursor shared by the value parsers. Like TaskJuggler's TextParser it never backtracks:
 * once a pattern's first token matched (e.g. a ',' in a list), the rest must follow.
 */
import { ValueLexer, type Token, type TokenKind } from './lex';
import { capture, raise, type Parsed, type ValueError } from './result';

export class Cursor {
	private readonly lex: ValueLexer;

	constructor(text: string, base = 0) {
		this.lex = new ValueLexer(text, base);
	}

	peek(): Token | null {
		return this.lex.peek();
	}

	next(): Token | null {
		return this.lex.next();
	}

	/** File offset just past the last consumed token. */
	get offset(): number {
		return this.lex.offset;
	}

	get end(): number {
		return this.lex.end;
	}

	isLiteral(text: string): boolean {
		const t = this.peek();
		return t !== null && t.kind === 'literal' && t.text === text;
	}

	isId(...names: string[]): boolean {
		const t = this.peek();
		return t !== null && t.kind === 'id' && (names.length === 0 || names.includes(t.text));
	}

	/** Consumes the literal if it is next. */
	eat(text: string): Token | null {
		return this.isLiteral(text) ? this.next() : null;
	}

	/** The next token, which must be one of `kinds`. */
	expect(...kinds: TokenKind[]): Token {
		const t = this.next();
		if (t === null) return raise('unexpected-end', this.end, this.end);
		if (!kinds.includes(t.kind)) return raise('unexpected-token', t.from, t.to);
		return t;
	}

	expectLiteral(text: string): Token {
		const t = this.next();
		if (t === null) return raise('unexpected-end', this.end, this.end);
		if (t.kind !== 'literal' || t.text !== text) return raise('unexpected-token', t.from, t.to);
		return t;
	}

	/** Fails unless every token has been consumed. */
	finish(): void {
		const t = this.peek();
		if (t !== null) raise('trailing-text', t.from, this.end);
	}
}

/**
 * Parses a whole value: `read` consumes it from a fresh cursor, then nothing may follow.
 * `extra` adds per-kind spans to the success result.
 */
export function parseWith<T, Extra extends object = object>(
	text: string,
	base: number,
	read: (c: Cursor) => T,
	extra?: (value: T) => Extra,
): Parsed<T, Extra> {
	const r = capture(() => {
		const c = new Cursor(text, base);
		const first = c.peek();
		if (first === null) return raise('unexpected-end', c.end, c.end);
		const value = read(c);
		const to = c.offset;
		c.finish();
		const more = extra ? extra(value) : ({} as Extra);
		return { ok: true as const, value, from: first.from, to, ...more };
	});
	return r as Parsed<T, Extra>;
}

export type { ValueError };
