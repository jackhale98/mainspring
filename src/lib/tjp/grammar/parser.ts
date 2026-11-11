// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The TJP parser and the node vocabulary that the document layer (T7, spec 6.1 and 5.4) and the
 * index (T8) read. `tjpParser(top)` parses a file with the top context of its include site
 * (spec 5.2): 'global' for an entry file or a file included after the project header, 'project'
 * for one included inside the header, 'prolog' for one included before it.
 *
 * Tree shape:
 * - `File` holds statements. Every statement node ends in `Statement`. Typed statements
 *   (TYPED_STATEMENTS) are named after their keyword (`TaskStatement`, `EffortStatement`);
 *   the others are OPAQUE_STATEMENTS.
 * - A statement starts with an optional `ScenarioPrefix`, then its head: a `Keyword`, an
 *   `AttributeName` (extension attribute), a statement-level `MacroCall`/`MacroWord`/`EnvRef`, or
 *   an `Identifier` in a body whose context is unknown. A `Body` (`OpenBrace` … `CloseBrace`)
 *   holds nested statements.
 * - Declarations: `Id` (literal `Identifier` or a macro token) and `Name`/`Version` (strings).
 *   Typed values: `WorkingDuration`, `CalendarDuration` (number and `Unit`), `Date`, `DateExpr`
 *   (`%{ … }`), `Interval`, `DepItem` (`TaskRef` with `Bang`s, optional `Body`), `AllocItem`
 *   (`ResourceRef`, optional `Body`), `ResourceRef`, `Flag`, `Ref`, `Leave` (`LeaveType`, `Name`,
 *   `Interval`), `WeekdayRange`, `TimeInterval`.
 * - Every byte is in a leaf except whitespace, so leaves plus whitespace gaps print the input.
 * - Unterminated constructs are a `ScanError` token, which no rule accepts, so they sit in an
 *   error node; so does anything else TaskJuggler would reject at that point.
 *
 * Incremental reparses should take their fragments from `reuseFragments` (fragments.ts), which
 * makes the result equal to a fresh parse also next to syntax errors.
 */
import type { SyntaxNode } from '@lezer/common';
import type { LRParser } from '@lezer/lr';
import type { TopContextName } from '../syntax/keywords';
import { tjpContextFor } from './context';
import { parser } from './parser.generated';
import { TYPED_KEYWORDS } from './terms';

export { parser as tjpGlobalParser } from './parser.generated';
export { EXTRA_KEYWORDS } from './keyword-extras';
export { reuseFragments } from './fragments';
export { stringTemplate, type StringTemplate } from './props';
export { requiresArgument } from './lexer';

const configured = new Map<TopContextName, LRParser>([['global', parser]]);

/** The parser for files whose top level is `top`. */
export function tjpParser(top: TopContextName = 'global'): LRParser {
	let p = configured.get(top);
	if (!p) {
		p = parser.configure({ contextTracker: tjpContextFor(top) });
		configured.set(top, p);
	}
	return p;
}

/** Statement nodes whose values are typed (spec 5.3). */
export const TYPED_STATEMENTS: ReadonlySet<string> = new Set(
	parser.nodeSet.types
		.map((t) => t.name)
		.filter(
			(n) =>
				n.endsWith('Statement') &&
				n !== 'OpaqueStatement' &&
				n !== 'MacroCallStatement' &&
				n !== 'ExtensionStatement',
		),
);

/**
 * Statement nodes with opaque values: other keywords, statement-level macro calls (the
 * `macro-in-body` rule of 5.4) and extension attributes. Edits never target them (X7).
 */
export const OPAQUE_STATEMENTS: ReadonlySet<string> = new Set([
	'OpaqueStatement',
	'MacroCallStatement',
	'ExtensionStatement',
]);

const MACRO_HEADS: ReadonlySet<string> = new Set(['MacroCall', 'MacroWord', 'EnvRef']);

/**
 * Whether a statement node is an artefact of error recovery. When a statement cannot start at
 * some token (`effrot 5d` after a typed statement, the `3h` in `effort 5d 3h`), Lezer inserts a
 * statement head and builds a MacroCallStatement whose head is an error node instead of a
 * MacroCall, MacroWord or EnvRef. Such a node is not a statement-level macro call (5.4) and lies
 * inside a syntax error (X6).
 */
export function isRecoveryStatement(node: SyntaxNode): boolean {
	if (node.name !== 'MacroCallStatement') return false;
	let head = node.firstChild;
	if (head?.name === 'ScenarioPrefix') head = head.nextSibling;
	return !head || !MACRO_HEADS.has(head.name);
}

/**
 * Leaf nodes whose text TaskJuggler's scanner expands, so their ranges are text-only (5.4 X2):
 * macro calls, glued macro words, `$(NAME)` references and strings that contain either.
 * `MacroBody` ranges are text-only too (X1). On a `TemplateString`,
 * `node.type.prop(stringTemplate)` tells whether it holds `${…}`, `$(…)` or both (props.ts),
 * for the `macro-call` and `env-var` reasons.
 */
export const MACRO_TOKENS: ReadonlySet<string> = new Set([
	'MacroCall',
	'MacroWord',
	'EnvRef',
	'TemplateString',
]);

/**
 * The typed statement node for a scoped keyword id ('effort' → 'EffortStatement'), or null when
 * the keyword's statements are opaque.
 */
export function typedStatementOf(keyword: string): string | null {
	const t = TYPED_KEYWORDS.get(keyword);
	return t ? (parser.nodeSet.types[t.statement]?.name ?? null) : null;
}

/** The scoped keyword ids that have typed statements. */
export const TYPED_KEYWORD_IDS: readonly string[] = [...TYPED_KEYWORDS.keys()];
