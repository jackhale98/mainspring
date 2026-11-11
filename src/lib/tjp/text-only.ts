// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Text-only ranges (phase-1.md 5.4): text the edit API must not change, because TaskJuggler
 * reads it through macro expansion, the engine alone knows what it declares, or the layer cannot
 * type it. The rules computed here from one file's tree:
 *
 * | Rule | Range (`at`)                                                     | Reason          | `within`      |
 * | ---- | ---------------------------------------------------------------- | --------------- | ------------- |
 * | X1   | every `MacroBody` token                                          | `macro-body`    | parent decl.  |
 * | X2   | every `MacroCall`/`MacroWord` token, templated `String` with `${` | `macro-call`   | its statement |
 * | X2   | every `EnvRef` token, templated `String` with only `$(NAME)`     | `env-var`       | its statement |
 * | X3   | a statement whose own tokens (prefix, keyword, values, not       | `macro-call`    | parent decl.  |
 * |      | nested statements) include an X2 token; for `project`, its       |                 |               |
 * |      | header up to the body                                            |                 |               |
 * | X3   | a statement-level macro call (`${children}`), unless `safeMacro` | `macro-call`    | none          |
 * | X4   | a `task`/`resource` whose id is a macro token or missing: the    | `macro-id`,     | none          |
 * |      | whole block; once resolved (engine hints), its id and name only  | `auto-id`       | the decl.     |
 * | X6   | every error node; an empty one widens to its statement or line   | `syntax-error`  | none          |
 * | X7   | every opaque statement (OPAQUE_STATEMENTS)                       | `opaque`        | parent decl.  |
 *
 * X5 (`expanded-only`, T8) has no `within`. Recovery nodes (`isRecoveryStatement`, §15.4) are
 * opaque and in a syntax error, never statement-level macros.
 *
 * Query contract (`findTextOnly`, `blocks`). Query with the element's own range (a value, a
 * statement, a block) or with the widened range an edit removes (with its line, leading comments
 * and separator). A range blocks a target that overlaps it, unless the target covers the range's
 * `within`, the enclosing construct whose removal takes the text-only text away whole: deleting a
 * task that holds `effort ${len}` is safe, removing that statement with its line is not. Ranges
 * with no `within` block every overlapping target, so a block holding an unresolved
 * `task ${t}`, an expanded-only declaration or a statement-level macro call, which may declare
 * tasks the text cannot see, is never deleted or moved. An insertion point is blocked strictly
 * inside a range.
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import type { WorkspacePath } from '../../engine/protocol';
import type { TjpFile } from './document';
import { MACRO_TOKENS, OPAQUE_STATEMENTS, isRecoveryStatement } from './grammar/parser';
import { stringTemplate } from './grammar/props';
import { enclosingStatement, isStatement, someOwnLeaf, type SourceRange } from './tree';

export type TextOnlyReason =
	| 'macro-body'
	| 'macro-call'
	| 'env-var'
	| 'macro-id'
	| 'auto-id'
	| 'expanded-only'
	| 'syntax-error'
	| 'opaque';

export interface Span {
	readonly from: number;
	readonly to: number;
}

export interface TextOnly {
	reason: TextOnlyReason;
	at: SourceRange;
	/** The construct a target must cover to remove this range safely; null: never (module comment). */
	within: Span | null;
}

/** When several ranges block a target, the first reason in this order is reported. */
export const TEXT_ONLY_PRIORITY: readonly TextOnlyReason[] = [
	'syntax-error',
	'macro-body',
	'expanded-only',
	'macro-id',
	'auto-id',
	'macro-call',
	'env-var',
	'opaque',
];

/** Declarations whose id the engine may have to supply (X4). */
const DECLARATIONS: ReadonlySet<string> = new Set(['TaskStatement', 'ResourceStatement']);

export interface TextOnlyOptions {
	/**
	 * True for a `task`/`resource` statement (by its range) whose non-literal id the engine has
	 * resolved (6.4 hints); only its id and name tokens then stay text-only (X4).
	 */
	resolved?: (decl: Span) => boolean;
	/**
	 * True for a statement-level macro call the index knows to declare nothing (T8); it then
	 * blocks like any X3 statement instead of blocking every enclosing edit.
	 */
	safeMacro?: (stmt: Span) => boolean;
}

/** The X2 reason of a leaf, or null when TaskJuggler does not expand it. */
export function expansionReason(leaf: SyntaxNode): 'macro-call' | 'env-var' | null {
	if (!MACRO_TOKENS.has(leaf.name)) return null;
	if (leaf.name === 'EnvRef') return 'env-var';
	if (leaf.name !== 'TemplateString') return 'macro-call';
	const t = leaf.type.prop(stringTemplate);
	return t && !t.macro && t.env ? 'env-var' : 'macro-call';
}

type Add = (reason: TextOnlyReason, at: Span, within: Span | null) => void;

/** The statement that holds statement `stmt` (its parent declaration), or null at the top. */
function parentStatement(stmt: SyntaxNode): SyntaxNode | null {
	return stmt.parent ? enclosingStatement(stmt.parent) : null;
}

/** The text-only ranges of one file, sorted by start (then by end, descending). */
export function textOnlyRanges(
	path: WorkspacePath,
	tree: Tree,
	text: string,
	opts: TextOnlyOptions = {},
): TextOnly[] {
	const out: TextOnly[] = [];
	const add: Add = (reason, at, within) => {
		out.push({
			reason,
			at: { file: path, from: at.from, to: at.to },
			within: within && { from: within.from, to: within.to },
		});
	};
	const cursor = tree.cursor();
	for (;;) {
		let descend = true;
		const node = cursor.node;
		if (cursor.type.isError) {
			add('syntax-error', errorRange(node, text), null);
			descend = false;
		} else if (node.name === 'MacroBody') {
			const stmt = enclosingStatement(node);
			add('macro-body', node, stmt && parentStatement(stmt));
		} else if (MACRO_TOKENS.has(node.name)) {
			add(expansionReason(node) ?? 'macro-call', node, enclosingStatement(node));
		} else if (isStatement(node)) {
			statementRules(node, opts, add);
		}
		if (descend && cursor.firstChild()) continue;
		while (!cursor.nextSibling()) {
			if (!cursor.parent()) {
				return out.sort((a, b) => a.at.from - b.at.from || b.at.to - a.at.to);
			}
		}
	}
}

function statementRules(stmt: SyntaxNode, opts: TextOnlyOptions, add: Add): void {
	const parent = parentStatement(stmt);
	if (OPAQUE_STATEMENTS.has(stmt.name)) add('opaque', stmt, parent);
	if (isRecoveryStatement(stmt)) return;
	if (stmt.name === 'MacroCallStatement') {
		add('macro-call', stmt, opts.safeMacro?.(stmt) ? parent : null);
		return;
	}
	if (DECLARATIONS.has(stmt.name)) {
		const id = stmt.getChild('Id');
		if (id?.firstChild?.name === 'Identifier') return;
		const reason = id ? 'macro-id' : 'auto-id';
		if (opts.resolved?.(stmt)) {
			if (id) add(reason, id, stmt);
			const name = stmt.getChild('Name');
			if (name) add(reason, name, stmt);
		} else {
			add(reason, stmt, null);
		}
		return;
	}
	if (!someOwnLeaf(stmt, (leaf) => MACRO_TOKENS.has(leaf.name))) return;
	const body = stmt.name === 'ProjectStatement' ? stmt.getChild('Body') : null;
	add('macro-call', { from: stmt.from, to: body ? body.from : stmt.to }, parent);
}

/** An error node's range; an empty one widens to its statement, or to its line at the top. */
function errorRange(node: SyntaxNode, text: string): Span {
	if (node.to > node.from) return node;
	const stmt = node.parent ? enclosingStatement(node.parent) : null;
	if (stmt && stmt.to > stmt.from) return stmt;
	const from = text.lastIndexOf('\n', node.from - 1) + 1;
	const nl = text.indexOf('\n', node.from);
	return { from, to: nl < 0 ? text.length : nl };
}

const cache = new WeakMap<TjpFile, readonly TextOnly[]>();

/** `textOnlyRanges` of a file without engine hints, cached per file version. */
export function textOnlyOf(file: TjpFile): readonly TextOnly[] {
	let r = cache.get(file);
	if (!r) {
		r = textOnlyRanges(file.path, file.tree, file.text.toString());
		cache.set(file, r);
	}
	return r;
}

/**
 * Whether a text-only range blocks an edit of [from, to) (module comment): it overlaps the
 * target, and the target does not cover its `within`. An insertion point (from == to) is blocked
 * strictly inside the range.
 */
export function blocks(
	r: { readonly at: Span; readonly within: Span | null },
	from: number,
	to: number,
): boolean {
	const { at, within } = r;
	if (from === to) return at.from < from && from < at.to;
	if (to <= at.from || from >= at.to) return false;
	return !(within && from <= within.from && within.to <= to);
}

/**
 * The text-only range that blocks an edit of [from, to) in `file` (by TEXT_ONLY_PRIORITY), or
 * null when the target is editable. `ranges` may hold several files' ranges.
 */
export function findTextOnly(
	ranges: readonly TextOnly[],
	file: WorkspacePath,
	from: number,
	to: number,
): TextOnly | null {
	let best: TextOnly | null = null;
	let rank = TEXT_ONLY_PRIORITY.length;
	for (const t of ranges) {
		if (t.at.file !== file || t.at.from > to) continue;
		if (!blocks(t, from, to)) continue;
		const k = TEXT_ONLY_PRIORITY.indexOf(t.reason);
		if (k < rank) {
			best = t;
			rank = k;
		}
	}
	return best;
}
