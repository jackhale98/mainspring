// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The units refinement merges (phase-4.md 6.4 rule 2): a span of a parent's content (a `File`, or
 * a `Body` between its braces) cut into elements on line boundaries.
 *
 * - A **statement element** is the lines its statements occupy, with the comment and blank lines
 *   directly above it (its leading trivia, `from` to `lead`). Statements that share a line are one
 *   element (no key: matched by text only).
 * - A **head** element is the rest of the line after a body's `{` when no statement starts there;
 *   the **end** element is the lines after the last statement (up to the `}`).
 * - Elements partition the span: they are contiguous, the first starts at the span's start and the
 *   last ends at its end. Every boundary is a line start, or the span's start or end.
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { statementsIn } from '../tree';
import { statementKey } from './hints';

export interface Element {
	readonly kind: 'head' | 'stmt' | 'end';
	/** Absolute offsets: the element is [from, to); its statement lines start at `lead`. */
	readonly from: number;
	readonly lead: number;
	readonly to: number;
	readonly stmts: readonly SyntaxNode[];
	/** The statement's key (hints.ts), or several statements' keys joined by '+'; null for a macro call. */
	readonly key: string | null;
}

/** One statement's key, or the keys of statements sharing lines joined by '+' (null if any lacks one). */
function groupKey(stmts: readonly SyntaxNode[], text: string): string | null {
	const keys: string[] = [];
	for (const s of stmts) {
		const k = statementKey(s, text);
		if (k === null) return null;
		keys.push(k);
	}
	return keys.join('+');
}

/** The elements of `text[from, to)`, the content of `parent` (module comment). */
export function elementsOf(text: string, parent: SyntaxNode, from: number, to: number): Element[] {
	const starts: number[] = [from];
	for (let i = text.indexOf('\n', from); i >= 0 && i + 1 < to; i = text.indexOf('\n', i + 1)) {
		starts.push(i + 1);
	}
	const lineOf = (pos: number): number => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((starts[mid] as number) <= pos) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	};
	const lineStart = (line: number): number =>
		line < starts.length ? (starts[line] as number) : to;
	const groups: Array<{ first: number; last: number; stmts: SyntaxNode[] }> = [];
	for (const s of statementsIn(parent)) {
		if (s.from < from || s.to > to) continue;
		const first = lineOf(s.from);
		const last = lineOf(Math.max(s.from, s.to - 1));
		const g = groups[groups.length - 1];
		if (g && first <= g.last) {
			g.last = Math.max(g.last, last);
			g.stmts.push(s);
		} else groups.push({ first, last, stmts: [s] });
	}
	const out: Element[] = [];
	let at = from;
	const opensMidLine = from > 0 && text[from - 1] !== '\n';
	// The rest of the `{` line, also when it is all the body holds (`{` then `}` on the next line).
	const nl = text.indexOf('\n', from);
	if (opensMidLine && nl >= 0 && nl < to && (groups[0]?.first ?? Infinity) > 0) {
		const end = nl + 1;
		out.push({ kind: 'head', from, lead: from, to: end, stmts: [], key: null });
		at = end;
	}
	for (const g of groups) {
		const lead = Math.max(at, lineStart(g.first));
		const end = lineStart(g.last + 1);
		out.push({
			kind: 'stmt',
			from: at,
			lead,
			to: end,
			stmts: g.stmts,
			key: groupKey(g.stmts, text),
		});
		at = end;
	}
	out.push({ kind: 'end', from: at, lead: at, to, stmts: [], key: null });
	return out;
}

const DECLS = new WeakMap<Tree, ReadonlyMap<string, number>>();
const ALL = new WeakMap<Tree, ReadonlyMap<string, number>>();

/**
 * The tasks and resources a tree declares once (by their local key, `task:t`), at the start of
 * their statement: what a move across blocks carries (refine.ts, keyed.ts). A key declared more
 * than once in the file (`task spec` under two parents) is left out, unless `all`. One walk per
 * tree, kept.
 */
export function declsOf(tree: Tree, text: string, all = false): ReadonlyMap<string, number> {
	const kept = (all ? ALL : DECLS).get(tree);
	if (kept) return kept;
	const out = new Map<string, number>();
	const twice = new Set<string>();
	const counts = new Map<string, number>();
	const walk = (n: SyntaxNode): void => {
		for (let c = n.firstChild; c; c = c.nextSibling) {
			if (c.name === 'TaskStatement' || c.name === 'ResourceStatement') {
				const id = c.getChild('Id');
				if (id) {
					const k = `${c.name === 'TaskStatement' ? 'task' : 'resource'}:${text.slice(id.from, id.to)}`;
					if (out.has(k)) twice.add(k);
					out.set(k, c.from);
					counts.set(k, (counts.get(k) ?? 0) + 1);
				}
			}
			if (c.name === 'Body' || c.name.endsWith('Statement')) walk(c);
		}
	};
	walk(tree.topNode);
	COUNTS.set(tree, counts);
	if (all) {
		ALL.set(tree, out);
		return out;
	}
	for (const k of twice) out.delete(k);
	DECLS.set(tree, out);
	return out;
}

const COUNTS = new WeakMap<Tree, ReadonlyMap<string, number>>();

/** How many times a tree declares the task or resource `key` (`task:t`), at any depth. */
export function declCount(tree: Tree, text: string, key: string): number {
	if (!COUNTS.has(tree)) declsOf(tree, text, true);
	return COUNTS.get(tree)?.get(key) ?? 0;
}

/** The index of the element holding `pos`, or -1 (elements are sorted and contiguous). */
export function elementAt(els: readonly Element[], pos: number): number {
	let lo = 0;
	let hi = els.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const e = els[mid] as Element;
		if (pos < e.from) hi = mid - 1;
		else if (pos >= e.to) lo = mid + 1;
		else return mid;
	}
	return -1;
}

/**
 * An element of several statements (on shared lines) as one element per statement, each led by
 * the text before it, and the rest of its lines as an `end` element; others as they are.
 */
export function unitsOf(e: Element, text: string): Element[] {
	if (e.kind !== 'stmt' || e.stmts.length <= 1) return [e];
	const out: Element[] = [];
	let at = e.from;
	for (const st of e.stmts) {
		out.push({
			kind: 'stmt',
			from: at,
			lead: st.from,
			to: st.to,
			stmts: [st],
			key: statementKey(st, text),
		});
		at = st.to;
	}
	out.push({ kind: 'end', from: at, lead: at, to: e.to, stmts: [], key: null });
	return out;
}

/**
 * The smallest union of whole elements covering [from, to): for an empty range, the element it
 * falls strictly inside, if any. Elements are sorted and contiguous.
 */
export function cover(els: readonly Element[], from: number, to: number): [number, number] {
	/** The first element whose end is after `pos` (binary search; elements are contiguous). */
	const after = (pos: number): number => {
		let lo = 0;
		let hi = els.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((els[mid] as Element).to <= pos) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	};
	const first = els[after(from)];
	if (from === to) {
		return first && first.from < from && from < first.to ? [first.from, first.to] : [from, to];
	}
	let lo = from;
	let hi = to;
	for (let k = after(from); k < els.length && (els[k] as Element).from < to; k++) {
		const e = els[k] as Element;
		if (e.to <= e.from) continue;
		lo = Math.min(lo, e.from);
		hi = Math.max(hi, e.to);
	}
	return [lo, hi];
}
