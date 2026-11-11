// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Token kinds, flags and error reasons produced by the TJP scanner (`scanner.ts`), a port of
 * TaskJuggler's `ProjectFileScanner` (phase-1.md 5.1). Trivia kinds cover every byte that
 * TaskJuggler skips (whitespace, comments, a leading BOM), so the token list is lossless.
 */

/** Kinds of trivia: skipped by TaskJuggler, kept by us so that tokens cover the whole input. */
export type TjpTriviaKind =
	/** A run of ASCII whitespace `[ \t\n\v\f\r]`, across lines. */
	| 'Whitespace'
	/** `#` or `//` to the end of the line, without the line feed. */
	| 'LineComment'
	/** `/* … *\/` on one line (greedy to the last `*\/`) or across lines. */
	| 'BlockComment'
	/** A single U+FEFF at offset 0. TaskJuggler rejects it; the bridge strips it (ADR-0002 #13). */
	| 'Bom';

/** Kinds of significant tokens. The comment names TaskJuggler's token type. */
export type TjpSignificantKind =
	/** `ID_WITH_COLON`: `[a-zA-Z_]\w*:`, the colon included (`delayed:`). */
	| 'ScenarioPrefix'
	/** `ABSOLUTE_ID`: `a.b.c`. */
	| 'AbsoluteId'
	/** `ID`. Keywords are identifiers here; the grammar decides (5.2). */
	| 'Identifier'
	/** `DATE`. */
	| 'Date'
	/** `TIME`: `\d{1,2}:\d{2}`. */
	| 'Time'
	/** `FLOAT`: `\d*\.\d+`. */
	| 'Float'
	/** `INTEGER`. */
	| 'Integer'
	/** `STRING`: `"…"`, `'…'` or a cut-here string. See {@link TokenFlag}. */
	| 'String'
	/** `MACRO`: `[ … ]`. Ends at the `]`; the line feed that must follow it is whitespace. */
	| 'MacroBody'
	/** A lone macro call `${name "arg" …}`, expanded by TaskJuggler's scanner. */
	| 'MacroCall'
	/** Macro calls (and env refs) glued to other word characters: `t${major}`, `${a}${b}`. */
	| 'MacroWord'
	/** `$(NAME)`, possibly glued to word characters, with no macro call. */
	| 'EnvRef'
	/** `LITERAL`: `<=`, `>=`, `!=` or any other single character (code point). */
	| 'Punct'
	/** Unterminated construct (runs to the end of input) or junk after `-8<-`. */
	| 'Error';

export type TjpTokenKind = TjpTriviaKind | TjpSignificantKind;

/** Bit flags on tokens. */
export const TokenFlag = {
	/** Contains a macro call that TaskJuggler expands (a templated string, a MacroWord). */
	Macro: 1,
	/** Contains a `$(NAME)` reference that TaskJuggler expands. */
	Env: 2,
	/** A single-quoted string. */
	SingleQuoted: 4,
	/** A cut-here string (`-8<-` … `->8-`). */
	CutHere: 8,
} as const;

export type TjpScanError =
	| 'unterminated-string'
	| 'unterminated-comment'
	| 'unterminated-macro-body'
	| 'unterminated-macro-call'
	/** `-8<-` followed by more than blanks on its line (TaskJuggler's `junk_after_cut`). */
	| 'junk-after-cut';

/** One token. Offsets are UTF-16 offsets into the scanned text; `to` is exclusive. */
export interface TjpToken {
	readonly kind: TjpTokenKind;
	readonly from: number;
	readonly to: number;
	/** {@link TokenFlag} bits. */
	readonly flags: number;
	/** Set only on `Error` tokens. */
	readonly error: TjpScanError | null;
}

const TRIVIA: ReadonlySet<TjpTokenKind> = new Set<TjpTokenKind>([
	'Whitespace',
	'LineComment',
	'BlockComment',
	'Bom',
]);

/** True for kinds that TaskJuggler skips. */
export function isTrivia(kind: TjpTokenKind): kind is TjpTriviaKind {
	return TRIVIA.has(kind);
}

/** TaskJuggler's own token type names, as returned by `TextParser::Scanner#nextToken`. */
export type TaskJugglerTokenType =
	| 'ID_WITH_COLON'
	| 'ABSOLUTE_ID'
	| 'ID'
	| 'DATE'
	| 'TIME'
	| 'FLOAT'
	| 'INTEGER'
	| 'STRING'
	| 'MACRO'
	| 'LITERAL';

const TJ_TYPE: Partial<Record<TjpTokenKind, TaskJugglerTokenType>> = {
	ScenarioPrefix: 'ID_WITH_COLON',
	AbsoluteId: 'ABSOLUTE_ID',
	Identifier: 'ID',
	Date: 'DATE',
	Time: 'TIME',
	Float: 'FLOAT',
	Integer: 'INTEGER',
	String: 'STRING',
	MacroBody: 'MACRO',
	Punct: 'LITERAL',
};

/**
 * The TaskJuggler token type a kind corresponds to, for differential tests (T19). Null for
 * trivia, errors and macro or env tokens, which TaskJuggler expands instead of returning.
 */
export function taskJugglerType(kind: TjpTokenKind): TaskJugglerTokenType | null {
	return TJ_TYPE[kind] ?? null;
}
