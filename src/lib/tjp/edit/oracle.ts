// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test oracles for the edit core properties (edit.property.test.ts), written from the spec (7.2,
 * 5.4, 9.3 P1 and P5) without the edit helpers: line regions, statement ranks, list items read
 * back from a fresh parse, and the macro token-touch rule.
 */
import type { ChangeSet } from '@codemirror/state';
import { textOf } from '../document';
import type { SyntaxNode, Tree } from '@lezer/common';
import { OPAQUE_STATEMENTS } from '../grammar/parser';
import { statementKeyword } from '../tree';
import type { Span } from './types';

/** From the start of `from`'s line through the break after `to`'s line (\n, \r\n or \r). */
export function lineRegion(text: string, from: number, to: number): Span {
	let a = from;
	while (a > 0 && text[a - 1] !== '\n' && text[a - 1] !== '\r') a--;
	let b = to;
	while (b < text.length && text[b] !== '\n' && text[b] !== '\r') b++;
	if (text.startsWith('\r\n', b)) b += 2;
	else if (b < text.length) b++;
	return { from: a, to: b };
}

/** The canonical order of 7.2, one row per rank; child declarations come last. */
const ORDER: Readonly<Record<string, readonly string[][]>> = {
	task: [
		['note'],
		['flags'],
		['priority'],
		['responsible'],
		['start'],
		['end'],
		['minstart'],
		['maxend'],
		['scheduling'],
		['milestone'],
		['effort', 'duration', 'length'],
		['depends'],
		['precedes'],
		['allocate'],
		['complete'],
		['task'],
	],
	resource: [
		['email'],
		['managers'],
		['efficiency'],
		['rate'],
		['workinghours'],
		['leaves'],
		['vacation'],
		['resource'],
	],
	project: [
		['timezone'],
		['timeformat'],
		['currency'],
		['now'],
		['dailyworkinghours'],
		['weekstartsmonday'],
		['workinghours'],
	],
};

/** The 7.2 rank of a statement in a scope, or null when ranking skips it. */
export function oracleRank(scope: string, stmt: SyntaxNode, text: string): number | null {
	if (OPAQUE_STATEMENTS.has(stmt.name) || stmt.name === 'MacroCallStatement') return null;
	const kw = statementKeyword(stmt, text);
	const i = (ORDER[scope] ?? []).findIndex((row) => kw !== null && row.includes(kw));
	return i < 0 ? null : i;
}

/**
 * Whether `stmt` sits where 7.2 puts a new statement among its siblings: every ranked sibling
 * after it ranks higher; if some sibling ranks equal or lower, the nearest ranked sibling before it
 * is one of those, else no ranked sibling comes before it.
 */
export function inOrder(
	scope: string,
	stmt: SyntaxNode,
	siblings: readonly SyntaxNode[],
	text: string,
): boolean {
	const r = oracleRank(scope, stmt, text);
	if (r === null) return false;
	const i = siblings.findIndex((s) => s.from === stmt.from);
	const ranks = siblings.map((s) => (s.from === stmt.from ? null : oracleRank(scope, s, text)));
	if (ranks.slice(i + 1).some((x) => x !== null && x <= r)) return false;
	const lower = ranks.some((x) => x !== null && x <= r);
	const before = ranks.slice(0, i).filter((x): x is number => x !== null);
	if (!lower) return before.length === 0;
	return before.length > 0 && (before[before.length - 1] ?? Infinity) <= r;
}

/** The item texts of the list statement starting at `from` in a tree. */
export function listItems(tree: Tree, text: string, from: number): string[] | null {
	let stmt: SyntaxNode | null = tree.resolveInner(from, 1);
	while (stmt && !(stmt.from === from && stmt.name.endsWith('Statement'))) stmt = stmt.parent;
	if (!stmt) return null;
	const out: string[] = [];
	const walk = (n: SyntaxNode): void => {
		for (let c = n.firstChild; c; c = c.nextSibling) {
			if (c.name === 'DepItem' || c.name === 'AllocItem') out.push(text.slice(c.from, c.to));
			else if (!c.name.endsWith('Statement') && c.name !== 'Body') walk(c);
		}
	};
	walk(stmt);
	return out;
}

/** Nodes whose text TaskJuggler expands, or that hold expanded text (5.4, P5). */
export const MACRO_NODE_NAMES: ReadonlySet<string> = new Set([
	'MacroBody',
	'MacroCall',
	'MacroWord',
	'EnvRef',
	'TemplateString',
	'MacroCallStatement',
]);

function lineBreakAfter(text: string, at: number): number {
	if (text.startsWith('\r\n', at)) return 2;
	return text[at] === '\n' || text[at] === '\r' ? 1 : 0;
}

/**
 * The first macro node a change touches (at or across its boundary, or the line break after a
 * macro body's `]`) without removing it whole; checked in both the old tree (old ranges) and the
 * new tree (new ranges, which catches text joined by a deletion). Null when none.
 */
export function touchedMacro(
	oldTree: Tree,
	oldText: string,
	newTree: Tree,
	cs: ChangeSet,
): string | null {
	let hit: string | null = null;
	const check = (tree: Tree, text: string, from: number, to: number, removes: boolean): void => {
		tree.iterate({
			from: Math.max(0, from - 1),
			to: Math.min(text.length, to + 1),
			enter(n) {
				if (hit || !MACRO_NODE_NAMES.has(n.name)) return;
				const whole = removes && from <= n.from && to >= n.to && from < to;
				if (!whole && from <= n.to && to >= n.from) hit = `${n.name} at ${n.from}`;
				const brk = n.name === 'MacroBody' ? lineBreakAfter(text, n.to) : 0;
				if (!whole && brk > 0 && from < n.to + brk && to >= n.to) hit = `break after ${n.to}`;
			},
		});
	};
	const newText = cs.apply(textOf(oldText)).toString();
	cs.iterChanges((fromA, toA, fromB, toB) => {
		check(oldTree, oldText, fromA, toA, true);
		check(newTree, newText, fromB, toB, false);
	});
	return hit;
}

/**
 * The macro node that would follow a pure insertion or deletion at `pos` (the next token after
 * blanks, line breaks and comments), unless `exempt` accepts its statement-level call (a safe
 * call whose body starts with a statement keyword, 5.4). Null when none.
 */
export function nextTokenMacro(
	tree: Tree,
	text: string,
	pos: number,
	exempt: (callStatementFrom: number) => boolean,
): string | null {
	let i = pos;
	for (;;) {
		while (i < text.length && /[ \t\n\v\f\r]/.test(text[i] ?? '')) i++;
		if (i >= text.length) return null;
		const leaf = tree.resolveInner(i, 1);
		if ((leaf.name === 'LineComment' || leaf.name === 'BlockComment') && leaf.from === i) {
			i = leaf.to;
			continue;
		}
		const stmt = leaf.parent?.name === 'MacroCallStatement' ? leaf.parent : null;
		if (stmt && exempt(stmt.from)) return null;
		return MACRO_NODE_NAMES.has(leaf.name) || stmt ? `${leaf.name} at ${leaf.from}` : null;
	}
}
