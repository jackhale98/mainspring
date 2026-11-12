// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Macro checks of the refusal pipeline (refuse.ts step 2; spec 5.4, P5). The document layer sees
 * unexpanded text, and TaskJuggler splices an expansion into the token stream where the call is,
 * so text placed next to a call can join its expansion (`task a "A" { … } ${b}` where `b` is
 * `{ length 1d }` gives two bodies, a native "Unexpected token '{'"). An op is refused
 * (`text-only`) when it:
 *
 * - touches a macro node (`MacroCall`, `MacroWord`, `EnvRef`, `TemplateString`, `MacroBody`,
 *   `MacroCallStatement`) at or across its boundary without removing the node whole: text written
 *   directly before or after `${m}` glues to it (`${m}x` is one MacroWord);
 * - inserts or removes text so that the next significant token after it (blanks, line breaks and
 *   comments skipped) is a macro call, or the start of a `macro-body` or `expanded-only` range:
 *   the expansion would then follow the new text (or the text before a removed statement).
 *   Exempt: a safe statement-level call whose macro body starts with a statement keyword
 *   (`keywordLedSafeCall`, as Tutorial's `${allocate_developers}`);
 * - touches a macro definition's name (`macro name [...]`), which every call depends on;
 * - touches the line break that closes a macro body after its `]` (grammar/scanner.ts), unless it
 *   removes the body with it.
 */
import type { SyntaxNode } from '@lezer/common';
import type { TjpFile } from '../document';
import type { TextOnlyReason } from '../text-only';
import { MACRO_TOKENS } from '../grammar/parser';
import { KEYWORDS } from '../syntax/keywords';
import { breakLength, fileText } from './lines';
import { refused, type EditContext, type EditOp, type Refused, type Span } from './types';

/** Nodes whose text TaskJuggler expands or that hold expanded text. */
export const MACRO_NODES: ReadonlySet<string> = new Set([
	...MACRO_TOKENS,
	'MacroBody',
	'MacroCallStatement',
]);

/**
 * Text-only ranges whose start counts as expanded text for the next-token rule. Ranges that start
 * with a literal keyword (`effort ${len}`, an unresolved `task ${t}`) are left out: new text before
 * a literal keyword cannot join an expansion.
 */
const EXPANDED_STARTS: ReadonlySet<TextOnlyReason> = new Set<TextOnlyReason>([
	'macro-body',
	'expanded-only',
]);

const COMMENTS: ReadonlySet<string> = new Set(['LineComment', 'BlockComment']);
const SPACE = /[ \t\n\v\f\r]/;

/** The first token at or after `pos` that is not whitespace or a comment, or null at the end. */
export function nextSignificant(file: TjpFile, pos: number): SyntaxNode | null {
	const text = fileText(file);
	let i = pos;
	for (;;) {
		while (i < text.length && SPACE.test(text[i] ?? '')) i++;
		if (i >= text.length) return null;
		const leaf = file.tree.resolveInner(i, 1);
		if (COMMENTS.has(leaf.name) && leaf.from === i && leaf.to > i) {
			i = leaf.to;
			continue;
		}
		return leaf;
	}
}

const refuse = (file: TjpFile, n: Span): Refused =>
	refused('text-only', [{ file: file.path, from: n.from, to: n.to }], { textOnly: 'macro-call' });

/** Whether `op` changes text at or across `n`'s boundary without removing `n` whole. */
function touches(op: EditOp, n: Span): boolean {
	const whole = op.from <= n.from && op.to >= n.to && op.from < op.to;
	return !whole && op.from <= n.to && op.to >= n.from;
}

const KEYWORD_NAMES: ReadonlySet<string> = new Set(KEYWORDS.map((k) => k.name));
const CALL_NAME = /^\$\{\??\s*([A-Za-z_]\w*)/;

/**
 * Whether `leaf` starts a statement-level call the index treats as safe (none of its text-only
 * ranges lacks a `within`: one definition, no nested calls, nothing declared) whose macro body
 * starts with a
 * statement keyword. Its expansion is then a statement of its own and cannot join the text
 * before it; a body that starts with a continuation (`, b`, `{ … }`) can.
 */
export function keywordLedSafeCall(ctx: EditContext, file: TjpFile, leaf: SyntaxNode): boolean {
	const stmt = leaf.parent;
	if (stmt?.name !== 'MacroCallStatement') return false;
	// The index marks an unsafe call with a range of its own that has no `within` (T8); the call
	// token's range always has one.
	const ranges = ctx.index
		.textOnly(file.path)
		.filter((t) => t.reason === 'macro-call' && t.at.from === stmt.from && t.at.to === stmt.to);
	const safe = ranges.length > 0 && ranges.every((t) => t.within !== null);
	if (!safe) return false;
	const name = CALL_NAME.exec(fileText(file).slice(leaf.from, leaf.to))?.[1];
	const defs = name === undefined ? undefined : ctx.index.macros.get(name);
	const def = defs?.length === 1 ? defs[0] : undefined;
	const word = def ? /^\s*([A-Za-z_]\w*)/.exec(def.text)?.[1] : undefined;
	return word !== undefined && KEYWORD_NAMES.has(word);
}

/** The macro adjacency rules (module comment) for one op. */
export function checkMacroAdjacency(ctx: EditContext, file: TjpFile, op: EditOp): Refused | null {
	let bad: Refused | null = null;
	file.tree.iterate({
		from: Math.max(0, op.from - 1),
		to: Math.min(file.text.length, op.to + 1),
		enter(ref) {
			if (bad) return false;
			if (MACRO_NODES.has(ref.name) && touches(op, ref)) bad = refuse(file, ref);
			else if (ref.name === 'MacroStatement') {
				const stmt = ref.node;
				const name = stmt.getChild('Keyword')?.nextSibling;
				const whole = op.from <= stmt.from && op.to >= stmt.to && op.from < op.to;
				if (name && !whole && op.from <= name.to && op.to >= name.from) {
					bad = refused('text-only', [{ file: file.path, from: name.from, to: name.to }], {
						textOnly: 'macro-body',
					});
				}
			}
			return;
		},
	});
	if (bad) return bad;
	const replaces = op.from < op.to && op.insert !== '';
	if (replaces) return null;
	const next = nextSignificant(file, op.to);
	if (!next) return null;
	if (MACRO_NODES.has(next.name) || next.parent?.name === 'MacroCallStatement') {
		return keywordLedSafeCall(ctx, file, next) ? null : refuse(file, next);
	}
	const starts = ctx.index
		.textOnly(file.path)
		.find((t) => t.at.from === next.from && EXPANDED_STARTS.has(t.reason));
	return starts ? refused('text-only', [starts.at], { textOnly: starts.reason }) : null;
}

/**
 * Refuses an op that touches the line break closing a macro body: text inserted between the `]`
 * and its break, or the break removed or replaced, unless the op removes the whole body with it.
 */
export function checkMacroBreaks(file: TjpFile, op: EditOp): Refused | null {
	const text = fileText(file);
	let bad: SyntaxNode | null = null;
	file.tree.iterate({
		from: Math.max(0, op.from - 1),
		to: Math.min(text.length, op.to + 1),
		enter(ref) {
			if (bad || ref.name !== 'MacroBody') return;
			const p = ref.to;
			const n = breakLength(text, p);
			if (n === 0) return;
			const clear = op.to < p || op.from >= p + n || (op.to === p && op.from < p);
			const whole = op.from <= ref.from && op.to >= p + n;
			if (!clear && !whole) bad = ref.node;
		},
	});
	if (!bad) return null;
	const { from, to } = bad;
	return refused('text-only', [{ file: file.path, from, to }], { textOnly: 'macro-body' });
}
