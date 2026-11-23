// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * One aligned element per side (keyed.ts): its leading comments, then its statement lines.
 *
 * - The parts merge one-sidedly where they can; leading comments changed both ways are merged on
 *   lines (emit.ts `lineMerge`).
 * - Statement lines that merge cleanly on lines are taken as diff3 merges them.
 * - Otherwise, when the sides have the same statements by position (by key; one statement may be
 *   replaced by another on both sides, as `effort` written as `duration`) and every gap between
 *   them (indentation, a trailing comment, the line end) merges cleanly, each statement merges
 *   on its own: a one-sided or equal change cleanly; a task, resource, project or supplement
 *   block by its header and closing (which must merge cleanly; a side without a body has an empty
 *   one) and its body, refined again (refine.ts); anything else changed both ways is one
 *   `attribute` conflict.
 * - Statements sharing a line that do not pair up (one side added or removed one in a one-line
 *   body) are merged as elements of their own, each led by the gap before it (keyed.ts), on
 *   trial: the result is kept when its only conflicts are attributes.
 * - When a precondition fails, the statement lines are one conflict (emit.ts `wholeConflict`), of
 *   the block itself when the element is one block.
 */
import type { SyntaxNode } from '@lezer/common';
import type { Element } from './elements';
import {
	emit,
	emitMerged,
	lineMerge,
	wholeConflict,
	linesClean,
	SIDES,
	textOf,
	type Cx,
	type Parent,
	type Span,
	type Tri,
} from './emit';
import { attrName, blockKind, statementKey } from './hints';
import { keyedMerge, type Seq } from './keyed';
import { merge3 } from './lines';
import { Out, type Rng } from './out';

const tri = <T>(f: (s: 0 | 1 | 2) => T): Tri<T> => SIDES.map(f) as unknown as Tri<T>;

const keyOf = (cx: Cx, s: 0 | 1 | 2, n: SyntaxNode): string | null =>
	statementKey(n, cx.sides[s].text);
const attribute = (cx: Cx, s: 0 | 1 | 2, n: SyntaxNode): boolean =>
	blockKind(n) === null && keyOf(cx, s, n) !== null;

/**
 * Whether three elements can be merged as one (keyed.ts aligns them): the same key, one
 * attribute statement each, or statements sharing lines that are all keyed attributes or blocks
 * (merged by `statements`, which falls back to lines).
 */
export function alignable(cx: Cx, e: Tri<Element>): boolean {
	if (e.some((x) => x.kind !== 'stmt')) return false;
	if (e[0].key !== null && e[0].key === e[1].key && e[0].key === e[2].key) return true;
	if (e.every((x) => x.stmts.length === 1)) {
		return SIDES.every((s) => attribute(cx, s, e[s].stmts[0] as SyntaxNode));
	}
	return e.every((x) => x.key !== null);
}

/** Whether the statements of three elements pair up by position (`statements`). */
function paired(cx: Cx, e: Tri<Element>): boolean {
	const n = e[0].stmts.length;
	if (e[1].stmts.length !== n || e[2].stmts.length !== n) return false;
	for (let i = 0; i < n; i++) {
		const st = tri((s) => e[s].stmts[i] as SyntaxNode);
		const k = tri((s) => keyOf(cx, s, st[s]));
		if (k[0] !== null && k[0] === k[1] && k[0] === k[2]) continue;
		const attrs = SIDES.every((s) => attribute(cx, s, st[s]));
		if (attrs && (n === 1 || (k[1] !== null && k[1] === k[2]))) continue;
		return false;
	}
	return true;
}

/** The statements of an element as elements of their own, each led by the gap before it. */
function unitsOf(cx: Cx, s: 0 | 1 | 2, e: Element): Seq {
	const els: Element[] = [];
	let at = e.lead;
	for (const st of e.stmts) {
		els.push({
			kind: 'stmt',
			from: at,
			lead: st.from,
			to: st.to,
			stmts: [st],
			key: keyOf(cx, s, st),
		});
		at = st.to;
	}
	els.push({ kind: 'end', from: at, lead: at, to: e.to, stmts: [], key: null });
	return { els, start: e.lead, end: e.to };
}

/** Merges three aligned elements into `cx.out` (module comment). */
export function element(cx: Cx, e: Tri<Element>, parent: Parent): void {
	const r = tri((s) => ({ from: e[s].from, to: e[s].to }));
	if (emitMerged(cx, r)) return;
	if (e.every((x) => x.kind !== 'stmt')) {
		// Comment and blank lines (a body's head, the end): no structure to cut through.
		lineMerge(cx, r, parent);
		return;
	}
	if (!alignable(cx, e)) {
		wholeConflict(cx, r, parent);
		return;
	}
	const lead = tri((s) => ({ from: e[s].from, to: e[s].lead }));
	if (!emitMerged(cx, lead)) lineMerge(cx, lead, parent);
	statements(cx, e, parent);
}

type Plan =
	| { readonly t: 'clean' }
	| { readonly t: 'attr' }
	| {
			readonly t: 'block';
			readonly head: Tri<Rng>;
			readonly tail: Tri<Rng>;
			readonly body: Tri<Span>;
			readonly own: Parent;
	  };

const textsOf = (cx: Cx, r: Tri<Rng>): Tri<string> => tri((s) => textOf(cx, s, r[s]));
const cleanly = (t: Tri<string>): boolean => merge3(t[0], t[1], t[2]) !== null;

/** How one statement triple merges, or null when it cannot be split off its lines. */
function plan(cx: Cx, st: Tri<SyntaxNode>): Plan | null {
	if (cleanly(textsOf(cx, st))) return { t: 'clean' };
	const kind = blockKind(st[1]);
	if (!kind) return st.some((n) => blockKind(n) !== null) ? null : { t: 'attr' };
	if (st.some((n) => blockKind(n) !== kind)) return null;
	// A side without a body has an empty one at the statement's end (`task t "T"` given a body).
	const braces = tri((s) => {
		const body = st[s].getChild('Body');
		if (!body) return { body: st[s], open: st[s].to, close: st[s].to };
		const open = body.firstChild;
		const close = body.lastChild;
		return open?.name === 'OpenBrace' && close?.name === 'CloseBrace'
			? { body, open: open.to, close: close.from }
			: null;
	});
	if (braces.some((b) => b === null)) return null;
	const bs = braces as unknown as Tri<{ body: SyntaxNode; open: number; close: number }>;
	const head = tri((s) => ({ from: st[s].from, to: bs[s].open }));
	const tail = tri((s) => ({ from: bs[s].close, to: st[s].to }));
	if (!cleanly(textsOf(cx, head)) || !cleanly(textsOf(cx, tail))) return null;
	return {
		t: 'block',
		head,
		tail,
		body: tri((s) => ({ node: bs[s].body, from: bs[s].open, to: bs[s].close })),
		own: { owner: cx.naming.owner(st[1], cx.sides[1].text), inBlock: true },
	};
}

/** The statement's attribute: the sides' when they agree, else the base's (both replaced it). */
function attrOf(cx: Cx, st: Tri<SyntaxNode>): string {
	const [o, a, b] = SIDES.map((s) => attrName(st[s], cx.sides[s].text));
	return a === b ? (a as string) : (o as string);
}

function statements(cx: Cx, e: Tri<Element>, parent: Parent): void {
	const lines = tri((s) => ({ from: e[s].lead, to: e[s].to }));
	const n = e[0].stmts.length;
	const only = n === 1 ? (e[1].stmts[0] as SyntaxNode) : null;
	const fallback: Parent =
		only && blockKind(only)
			? { owner: cx.naming.owner(only, cx.sides[1].text), inBlock: true }
			: parent;
	if (linesClean(cx, lines)) {
		lineMerge(cx, lines, parent);
		return;
	}
	if (!paired(cx, e)) {
		// Statements sharing a line, added or removed on a side: merge them as elements of their
		// own, on trial, and keep the result only when it has no line conflict.
		const trial: Cx = { ...cx, out: new Out() };
		keyedMerge(
			trial,
			tri((s) => unitsOf(cx, s, e[s])),
			parent,
		);
		if (trial.out.conflicts.every((c) => c.subject.kind === 'attribute')) cx.out.append(trial.out);
		else wholeConflict(cx, lines, fallback);
		return;
	}
	const st = (i: number): Tri<SyntaxNode> => tri((s) => e[s].stmts[i] as SyntaxNode);
	const gap = (i: number): Tri<Rng> =>
		tri((s) => ({
			from: i === 0 ? e[s].lead : (e[s].stmts[i - 1] as SyntaxNode).to,
			to: i === n ? e[s].to : (e[s].stmts[i] as SyntaxNode).from,
		}));
	const plans: Plan[] = [];
	for (let i = 0; i < n; i++) {
		const p = plan(cx, st(i));
		if (!p) {
			wholeConflict(cx, lines, fallback);
			return;
		}
		plans.push(p);
	}
	for (let i = 0; i <= n; i++) {
		if (!cleanly(textsOf(cx, gap(i)))) {
			wholeConflict(cx, lines, fallback);
			return;
		}
	}
	for (let i = 0; i < n; i++) {
		emitMerged(cx, gap(i));
		const p = plans[i] as Plan;
		const s = st(i);
		const own = tri((x) => ({ from: s[x].from, to: s[x].to }));
		if (p.t === 'clean') emitMerged(cx, own);
		else if (p.t === 'block') {
			emitMerged(cx, p.head);
			cx.span(cx, p.body, p.own);
			emitMerged(cx, p.tail);
		} else {
			const at = emit(cx, 1, own[1]);
			cx.out.conflict({
				subject: { kind: 'attribute', owner: parent.owner, attr: attrOf(cx, s) },
				base: textOf(cx, 0, own[0]),
				ours: textOf(cx, 1, own[1]),
				theirs: textOf(cx, 2, own[2]),
				at,
				atOurs: own[1],
				atBase: own[0],
				both: false,
			});
		}
	}
	emitMerged(cx, gap(n));
}
