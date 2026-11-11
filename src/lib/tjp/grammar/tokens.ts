// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The TJP tokenizer (phase-1.md 5.1): TaskJuggler's `ProjectFileScanner` ported in
 * `scanner.ts`, exposed as a token list for plain text and as a Lezer external tokenizer for the
 * grammar (T5). Tokens, trivia included, cover the input exactly: concatenating their text
 * gives the input back.
 */
import { ExternalTokenizer, type InputStream, type Stack } from '@lezer/lr';
import { StringSource } from './scanner-core';
import { scanToken, type ScanSource, type ScannedToken } from './scanner';
import type { TjpToken } from './token-kinds';

export { scanToken, type ScanSource, type ScannedToken } from './scanner';
export {
	TokenFlag,
	isTrivia,
	taskJugglerType,
	type TaskJugglerTokenType,
	type TjpScanError,
	type TjpSignificantKind,
	type TjpToken,
	type TjpTokenKind,
	type TjpTriviaKind,
} from './token-kinds';

/** The token that starts at `pos` in `text`, which must be a token boundary; null at the end. */
export function scanTokenAt(text: string, pos: number): TjpToken | null {
	const src = new StringSource(text);
	src.base = pos;
	const t = scanToken(src, pos === 0);
	return t && { kind: t.kind, from: pos, to: pos + t.length, flags: t.flags, error: t.error };
}

/** Tokenize a whole file. Never throws; the tokens cover `text` with no gaps or overlaps. */
export function tokenizeTjp(text: string): TjpToken[] {
	const src = new StringSource(text);
	const out: TjpToken[] = [];
	let pos = 0;
	while (pos < text.length) {
		src.base = pos;
		const t = scanToken(src, pos === 0);
		// scanToken returns null only at the end and never a zero length; stay total regardless.
		const length = t && t.length > 0 ? t.length : text.length - pos;
		out.push({
			kind: t ? t.kind : 'Error',
			from: pos,
			to: pos + length,
			flags: t ? t.flags : 0,
			error: t ? t.error : 'unterminated-string',
		});
		pos += length;
	}
	return out;
}

/** A {@link ScanSource} over a Lezer input stream, relative to its current position. */
class StreamSource implements ScanSource {
	private readonly input: InputStream;
	private readonly lines = new Map<number, string>();

	constructor(input: InputStream) {
		this.input = input;
	}

	peek(offset: number): number {
		return this.input.peek(offset);
	}

	slice(offset: number, length: number): string {
		return this.read(offset, length, false);
	}

	line(offset: number): string {
		let s = this.lines.get(offset);
		if (s === undefined) {
			s = this.read(offset, Infinity, true);
			this.lines.set(offset, s);
		}
		return s;
	}

	/** Up to `length` code units from `offset`, stopping after a `\n` if `toLineEnd`. */
	private read(offset: number, length: number, toLineEnd: boolean): string {
		let out = '';
		const codes: number[] = [];
		for (let i = 0; i < length; i++) {
			const c = this.input.peek(offset + i);
			if (c < 0) break;
			codes.push(c);
			if (codes.length === 4096) {
				out += String.fromCharCode(...codes);
				codes.length = 0;
			}
			if (toLineEnd && c === 10) break;
		}
		return out + String.fromCharCode(...codes);
	}
}

/**
 * Chooses the grammar term for a scanned token, or -1 to reject it. `text` reads the token's
 * text, and `peek` the code unit at an offset from the token start (-1 at the end), for
 * lookahead past the token. The grammar uses this to map kinds and punctuation to its terms and
 * to turn an `Identifier` into a `Keyword` when the context allows (5.2).
 */
export type TjpTermFor = (
	token: ScannedToken,
	text: () => string,
	stack: Stack,
	peek: (offset: number) => number,
) => number;

/** Options passed through to Lezer's `ExternalTokenizer`. */
export type TjpTokenizerOptions = NonNullable<ConstructorParameters<typeof ExternalTokenizer>[1]>;

/**
 * A Lezer external tokenizer that produces every token, trivia included, with TaskJuggler's
 * boundaries. The scanner reads through `peek`, so Lezer records the lookahead for incremental
 * reparsing; most tokens read only themselves plus two code units. The tokenizer is
 * `contextual` by default, because `termFor` sees the parse stack (for `canShift`).
 */
export function tjpExternalTokenizer(
	termFor: TjpTermFor,
	options: TjpTokenizerOptions = {},
): ExternalTokenizer {
	return new ExternalTokenizer(
		(input, stack) => {
			if (input.next < 0) return;
			const src = new StreamSource(input);
			const t = scanToken(src, input.pos === 0);
			if (!t) return;
			const term = termFor(
				t,
				() => src.slice(0, t.length),
				stack,
				(offset) => src.peek(offset),
			);
			if (term >= 0) input.acceptToken(term, t.length);
		},
		{ contextual: true, ...options },
	);
}
