// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Value checks of typed statements for diagnostics (phase-1.md 6.6, T6 `checkValue`).
 *
 * A statement is checked when it is typed (TYPED_STATEMENTS) and its keyword has a value kind
 * (KEYWORD_VALUE_KIND), and it sits at file level or directly in a task, resource, project,
 * supplement or dependency body, where the keyword means what the value table says. The
 * project's `timingresolution`, an opaque statement in the grammar, is checked as well.
 *
 * Errors that only say the value cannot be checked here (macro calls, environment variables,
 * missing time-zone data) are not diagnostics. Statements holding an error node are left to the
 * syntax diagnostics.
 */
import type { SyntaxNode } from '@lezer/common';
import type { TjpFile } from './document';
import { TYPED_STATEMENTS } from './grammar/parser';
import { textString } from './diagnostics-lines';
import { enclosingStatement, statementHead } from './tree';
import {
	checkValue,
	KEYWORD_VALUE_KIND,
	parseValue,
	type ProjectContext,
	type ValueError,
	type ValueErrorCode,
} from './values';

/** Codes that mean "cannot tell here", not "wrong". */
const UNCHECKABLE: ReadonlySet<ValueErrorCode> = new Set([
	'macro-call',
	'env-var',
	'zone-data',
	'unsafe-text',
	'unrepresentable',
]);

const OWNERS: ReadonlySet<string> = new Set([
	'TaskStatement',
	'ResourceStatement',
	'ProjectStatement',
	'SupplementStatement',
	'DependsStatement',
	'PrecedesStatement',
]);

function hasError(node: SyntaxNode): boolean {
	if (node.type.isError) return true;
	for (let c = node.firstChild; c; c = c.nextSibling) if (hasError(c)) return true;
	return false;
}

/** The keyword of a statement this module checks, or null. */
function checkedKeyword(stmt: SyntaxNode, text: string): string | null {
	const head = statementHead(stmt);
	if (head?.name !== 'Keyword') return null;
	const kw = text.slice(head.from, head.to);
	if (!(kw in KEYWORD_VALUE_KIND)) return null;
	const parent = stmt.parent;
	if (!parent) return null;
	const owner = parent.name === 'File' ? null : enclosingStatement(parent);
	if (parent.name !== 'File' && (!owner || !OWNERS.has(owner.name))) return null;
	if (TYPED_STATEMENTS.has(stmt.name)) return kw;
	return kw === 'timingresolution' && owner?.name === 'ProjectStatement' ? kw : null;
}

/** The statements of a file whose values are checked, in document order. */
export function checkedStatements(file: TjpFile, from = 0, to = file.text.length): SyntaxNode[] {
	const text = textString(file.text);
	const out: SyntaxNode[] = [];
	file.tree.iterate({
		from,
		to,
		enter(n) {
			if (!n.name.endsWith('Statement')) return undefined;
			const node = n.node;
			if (checkedKeyword(node, text) !== null) out.push(node);
			return undefined;
		},
	});
	return out;
}

/**
 * The value error of a checked statement, or null when the value is fine or cannot be checked
 * here. Offsets are file offsets.
 */
export function statementValueError(
	file: TjpFile,
	stmt: SyntaxNode,
	ctx: ProjectContext,
): ValueError | null {
	const text = textString(file.text);
	const kw = checkedKeyword(stmt, text);
	if (kw === null || hasError(stmt)) return null;
	const kind = KEYWORD_VALUE_KIND[kw];
	const first = statementHead(stmt)?.nextSibling ?? null;
	if (!kind || !first) return null;
	const parsed = parseValue(kind, text.slice(first.from, stmt.to), first.from);
	const error = parsed.ok
		? (() => {
				const r = checkValue(kw, parsed.value, ctx, { from: parsed.from, to: parsed.to });
				return r.ok ? null : r.error;
			})()
		: parsed.error;
	if (!error || UNCHECKABLE.has(error.code)) return null;
	if (error.from >= error.to) return { ...error, from: first.from, to: stmt.to };
	return error;
}
