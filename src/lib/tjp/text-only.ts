// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Text-only ranges (phase-1.md 5.4): text the edit API must not change, because TaskJuggler
 * reads it through macro expansion, the engine alone knows what it declares, or the layer cannot
 * type it. The rules computed here from one file's tree:
 *
 * | Rule | Range                                                                   | Reason            |
 * | ---- | ----------------------------------------------------------------------- | ----------------- |
 * | X1   | every `MacroBody` token                                                 | `macro-body`      |
 * | X2   | every `MacroCall`/`MacroWord` token, templated `String` with `${`       | `macro-call`      |
 * | X2   | every `EnvRef` token, templated `String` with only `$(NAME)`            | `env-var`         |
 * | X3   | a statement whose own tokens (prefix, keyword, values, not nested       | `macro-call`      |
 * |      | statements) include an X2 token: the whole statement; for `project`,    |                   |
 * |      | its header up to the body                                               |                   |
 * | X4   | a `task`/`resource` whose id is a macro token (`macro-id`) or missing   | `macro-id`        |
 * |      | (`auto-id`): the whole block, or only its id and name tokens once the   | `auto-id`         |
 * |      | engine has named it (`resolved`, from the index's engine hints, 6.4)    |                   |
 * | X6   | every error node; an empty one widens to its statement, else its line   | `syntax-error`    |
 * | X7   | every opaque statement (OPAQUE_STATEMENTS)                              | `opaque`          |
 *
 * X5 (`expanded-only`) needs the engine's task list and belongs to the index (T8).
 *
 * `findTextOnly` says whether an edit target is blocked: a range blocks a target that lies in it
 * or crosses it, but not a target that strictly contains it (deleting a block that holds a macro
 * call is fine; rewriting the call is not).
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import type { WorkspacePath } from '../../engine/protocol';
import type { TjpFile } from './document';
import { MACRO_TOKENS, OPAQUE_STATEMENTS } from './grammar/parser';
import { TokenFlag, scanTokenAt } from './grammar/tokens';
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

export interface TextOnly {
	reason: TextOnlyReason;
	at: SourceRange;
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
	resolved?: (decl: { readonly from: number; readonly to: number }) => boolean;
}

/** The X2 reason of a leaf, or null when it is not expanded by TaskJuggler. */
export function expansionReason(leaf: SyntaxNode, text: string): 'macro-call' | 'env-var' | null {
	if (!MACRO_TOKENS.has(leaf.name)) return null;
	if (leaf.name === 'EnvRef') return 'env-var';
	if (leaf.name !== 'TemplateString') return 'macro-call';
	const t = scanTokenAt(text.slice(leaf.from, leaf.to), 0);
	return t && (t.flags & TokenFlag.Macro) === 0 ? 'env-var' : 'macro-call';
}

/** The text-only ranges of one file, sorted by start (then by end, descending). */
export function textOnlyRanges(
	path: WorkspacePath,
	tree: Tree,
	text: string,
	opts: TextOnlyOptions = {},
): TextOnly[] {
	const out: TextOnly[] = [];
	const add = (reason: TextOnlyReason, from: number, to: number): void => {
		out.push({ reason, at: { file: path, from, to } });
	};
	const cursor = tree.cursor();
	for (;;) {
		let descend = true;
		const node = cursor.node;
		if (cursor.type.isError) {
			const r = errorRange(node, text);
			add('syntax-error', r.from, r.to);
			descend = false;
		} else if (node.name === 'MacroBody') {
			add('macro-body', node.from, node.to);
		} else if (MACRO_TOKENS.has(node.name)) {
			add(expansionReason(node, text) ?? 'macro-call', node.from, node.to);
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

function statementRules(
	stmt: SyntaxNode,
	opts: TextOnlyOptions,
	add: (reason: TextOnlyReason, from: number, to: number) => void,
): void {
	if (OPAQUE_STATEMENTS.has(stmt.name)) add('opaque', stmt.from, stmt.to);
	if (DECLARATIONS.has(stmt.name)) {
		const id = stmt.getChild('Id');
		const literal = id?.firstChild?.name === 'Identifier';
		if (literal) return;
		const reason = id ? 'macro-id' : 'auto-id';
		if (opts.resolved?.(stmt)) {
			if (id) add(reason, id.from, id.to);
			const name = stmt.getChild('Name');
			if (name) add(reason, name.from, name.to);
		} else {
			add(reason, stmt.from, stmt.to);
		}
		return;
	}
	if (!someOwnLeaf(stmt, (leaf) => MACRO_TOKENS.has(leaf.name))) return;
	const body = stmt.name === 'ProjectStatement' ? stmt.getChild('Body') : null;
	add('macro-call', stmt.from, body ? body.from : stmt.to);
}

/** An error node's range; an empty one widens to its statement, or to its line at the top. */
function errorRange(node: SyntaxNode, text: string): { from: number; to: number } {
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
 * Whether range `r` blocks an edit of [from, to): the target lies in it or crosses it, and does
 * not strictly contain it. An insertion point (from == to) is blocked strictly inside `r`.
 */
export function blocks(
	r: { readonly from: number; readonly to: number },
	from: number,
	to: number,
): boolean {
	if (from === to) return r.from < from && from < r.to;
	if (to <= r.from || from >= r.to) return false;
	const strictlyContains = from <= r.from && r.to <= to && (from < r.from || r.to < to);
	return !strictlyContains;
}

/**
 * The text-only range that blocks an edit of [from, to) in `file` (by TEXT_ONLY_PRIORITY), or
 * null when the target is editable. `ranges` are one file's ranges.
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
		if (!blocks(t.at, from, to)) continue;
		const k = TEXT_ONLY_PRIORITY.indexOf(t.reason);
		if (k < rank) {
			best = t;
			rank = k;
		}
	}
	return best;
}
