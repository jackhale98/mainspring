// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The statement-by-statement merge of a widened hunk (refine.ts; types.ts "Refinement").
 *
 * The elements of each side are aligned by a three-way diff of their tokens: the value a statement
 * sets (keywords.ts `slotOf`: its key, the sizing criteria as one) when it is unique among the
 * hunk's elements on every side, else that with the statement's text (so repeated statements such
 * as two `depends` align only where they are equal). A statement that moved on one side while
 * the other side changed the hunk too (or moved it as well), also a task moved into another
 * block (found by the tasks and resources each element declares, elements.ts `declsOf`), makes
 * the whole hunk one conflict: a move is a delete and an add to the diff, which would otherwise
 * lose the other side's edit or declare it twice. Then, per run of the token diff:
 * - aligned elements merge one by one (statement.ts);
 * - a run changed on one side merges cleanly when the other side left its text alone; a run one
 *   side deleted while the other changed it gives, per changed element, `block` `deleted-*` or an
 *   `attribute` conflict with that side null;
 * - one element per side with the same key, or one attribute each (a statement replaced by
 *   another on both sides), merge as aligned elements;
 * - runs both sides added at one place keep what they added alike at their start and end, and
 *   anything else both added alike once; the rest is classified by check.ts `independent` (the
 *   one rule set): two that cannot both stay are `added-twice` (blocks) or an `attribute`
 *   conflict, independent statements in a block merge (clean, ours first), and blocks with
 *   different ids are `added-twice` with `both`;
 * - anything else is one conflict over the run's whole elements (emit.ts `wholeConflict`), so
 *   either choice takes one side's statements whole.
 * In a block both sides changed statements of, the block's plan (check.ts) shapes the merge as
 * planned.ts says; a run it cannot shape fails the plan (statement.ts: the block is one conflict).
 *
 * Merging pauses between steps (types.ts rule 5): `keyedMerge` and what it calls are generators.
 */
import type { SyntaxNode } from '@lezer/common';
import { declCount, declsOf, elementAt, type Element } from './elements';
import {
	emit,
	emitMerged,
	wholeConflict,
	SIDES,
	textOf,
	type Cx,
	type Parent,
	type SideIx,
	type Step,
	type Tri,
} from './emit';
import { attrName, blockKind, statementKey } from './hints';
import { slotOf } from './keywords';
import { independent } from './check';
import { emitPlanned, held, holesIn, planned } from './planned';
import { alignable, element } from './statement';
import { diffIndices } from 'node-diff3';
import { diff3Regions, type IxRange } from './lines';
import type { Rng } from './out';

export interface Seq {
	readonly els: readonly Element[];
	readonly start: number;
	readonly end: number;
}

const whole = (e: Element): Rng => ({ from: e.from, to: e.to });

function tokens(cx: Cx, seqs: Tri<Seq>): Tri<string[]> {
	// A statement aligns by the value it sets (keywords.ts `slotOf`): `effort 2d` on one side
	// with `length 1d` on another is the same task's sizing, changed.
	const slot = (s: SideIx, e: Element): string | null => {
		const only = e.kind === 'stmt' && e.stmts.length === 1 ? (e.stmts[0] as SyntaxNode) : null;
		return only && e.key !== null ? slotOf(only, cx.sides[s].text) : e.key;
	};
	const keys = SIDES.map((s) => seqs[s].els.map((e) => slot(s, e)));
	const counts = keys.map((ks) => {
		const m = new Map<string, number>();
		for (const k of ks) if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
		return m;
	});
	const unique = (k: string): boolean => counts.every((m) => (m.get(k) ?? 0) <= 1);
	return SIDES.map((s) =>
		seqs[s].els.map((e, i) => {
			const k = (keys[s] as (string | null)[])[i] ?? null;
			if (e.kind !== 'stmt') return `\u0001${e.kind}`;
			if (k !== null && unique(k)) return `\u0003${k}`;
			return `\u0002${k ?? ''}\u0000${textOf(cx, s, { from: e.lead, to: e.to }).trim()}`;
		}),
	) as unknown as Tri<string[]>;
}

/** Merges the elements of a widened hunk into `cx.out` (module comment). */
export function* keyedMerge(cx: Cx, given: Tri<Seq>, parent: Parent): Step {
	const plan = parent.plan;
	const seqs = plan ? planned(given, plan) : given;
	const [to, ta, tb] = tokens(cx, seqs);
	if (moved(cx, seqs, [to, ta, tb])) {
		wholeConflict(
			cx,
			SIDES.map((s) => ({ from: seqs[s].start, to: seqs[s].end })) as unknown as Tri<Rng>,
			parent,
		);
		return;
	}
	for (const g of diff3Regions(to, ta, tb)) {
		const ix: Tri<IxRange> = [g.o, g.a, g.b];
		const run = SIDES.map((s) => seqs[s].els.slice(ix[s][0], ix[s][1])) as unknown as Tri<
			Element[]
		>;
		const pos = SIDES.map((s) => {
			const e = seqs[s].els[ix[s][0]];
			return e ? e.from : seqs[s].end;
		}) as unknown as Tri<number>;
		if (g.kind === 'same') {
			for (let i = 0; i < run[0].length; i++) {
				const e = [run[0][i], run[1][i], run[2][i]] as Tri<Element>;
				if (plan && held(plan, e[1])) plan.failed = true;
				yield* element(cx, e, parent);
			}
		} else if (!plan || !emitPlanned(cx, run, pos, parent, plan)) {
			// A run the plan does not shape merges as usual (check.ts proved the block's changes
			// independent), unless a statement the plan holds or leaves out is in it.
			if (
				plan &&
				(run[1].some((e) => held(plan, e)) || SIDES.some((s) => holesIn(given[s], run[s], plan, s)))
			) {
				plan.failed = true;
			}
			yield* runMerge(cx, run, pos, parent);
		}
	}
}

/** Keys (unique ones) of side `s` that sit elsewhere among the keys it shares with the base. */
function movedOn(o: readonly string[], x: readonly string[]): Set<string> {
	const keyed = (t: readonly string[], other: ReadonlySet<string>): string[] =>
		t.filter((k) => k.startsWith('\u0003') && other.has(k));
	const so = new Set(o);
	const sx = new Set(x);
	const out = new Set<string>();
	for (const h of diffIndices(keyed(o, sx), keyed(x, so)))
		for (const k of h.buffer2Content) out.add(k);
	return out;
}

/**
 * Tasks and resources (unique ones) that side `x` declares inside another element than the base
 * does: a block moved into another block (review L4).
 */
function movedAcross(cx: Cx, seqs: Tri<Seq>, t: Tri<string[]>, x: 1 | 2): Set<string> {
	const out = new Set<string>();
	const d0 = declsOf(cx.sides[0].tree, cx.sides[0].text);
	const dx = declsOf(cx.sides[x].tree, cx.sides[x].text);
	const inside = (s: SideIx, at: number | undefined): number =>
		at === undefined || at < seqs[s].start || at >= seqs[s].end ? -1 : elementAt(seqs[s].els, at);
	for (const [k, at] of d0) {
		const i = inside(0, at);
		if (i < 0) continue;
		const j = inside(x, dx.get(k));
		if (j >= 0 && t[0][i] !== t[x][j]) out.add(k);
	}
	return out;
}

/**
 * Whether a statement moved on one side while the other side changed the hunk too (or moved it as
 * well). Token diff3 sees a move as a delete and an add, which would lose the other side's edit
 * of it or declare it twice; the hunk is one line conflict of whole elements instead.
 */
function moved(cx: Cx, seqs: Tri<Seq>, t: Tri<string[]>): boolean {
	const ma = new Set([...movedOn(t[0], t[1]), ...movedAcross(cx, seqs, t, 1)]);
	const mb = new Set([...movedOn(t[0], t[2]), ...movedAcross(cx, seqs, t, 2)]);
	if (ma.size === 0 && mb.size === 0) return false;
	const text = (s: SideIx): string => textOf(cx, s, { from: seqs[s].start, to: seqs[s].end });
	if (ma.size > 0 && mb.size > 0) return true;
	return text(ma.size > 0 ? 2 : 1) !== text(0);
}

const span = (els: readonly Element[], at: number): Rng =>
	els.length > 0
		? { from: (els[0] as Element).from, to: (els[els.length - 1] as Element).to }
		: { from: at, to: at };

const single = (e: Element | undefined): SyntaxNode | null =>
	e && e.kind === 'stmt' && e.stmts.length === 1 ? (e.stmts[0] as SyntaxNode) : null;

function* runMerge(cx: Cx, run: Tri<Element[]>, pos: Tri<number>, parent: Parent): Step {
	const r = SIDES.map((s) => span(run[s], pos[s])) as unknown as Tri<Rng>;
	if (emitMerged(cx, r)) return;
	const [o, a, b] = run;
	if (o.length > 0 && (a.length === 0) !== (b.length === 0)) {
		// One side deleted the run: each element the other side changed is a conflict.
		const kept: SideIx = a.length === 0 ? 2 : 1;
		const k = run[kept];
		const same = (i: number): boolean =>
			textOf(cx, 0, whole(o[i] as Element)) === textOf(cx, kept, whole(k[i] as Element));
		const keyed = (i: number): boolean => {
			const eo = o[i] as Element;
			return eo.kind === 'stmt' && eo.key !== null && eo.key === k[i]?.key;
		};
		if (o.length === k.length && o.every((_, i) => same(i) || keyed(i))) {
			o.forEach((eo, i) => {
				if (!same(i)) deleted(cx, kept === 2 ? 1 : 2, eo, k[i] as Element, pos, parent);
			});
			return;
		}
	}
	if (o.length === 1 && a.length === 1 && b.length === 1) {
		const e = [o[0], a[0], b[0]] as Tri<Element>;
		if (alignable(cx, e)) {
			// The same statement changed on both sides, or one statement replaced on both sides
			// by another (a sizing criterion written as `duration` instead of `effort`).
			yield* element(cx, e, parent);
			return;
		}
	}
	if (o.length === 0) {
		// Both added: what both added alike at the start or the end merges as it is.
		const same = (i: number, j: number): boolean =>
			textOf(cx, 1, whole(a[i] as Element)) === textOf(cx, 2, whole(b[j] as Element));
		let p = 0;
		while (p < a.length && p < b.length && same(p, p)) p++;
		let q = 0;
		while (q < a.length - p && q < b.length - p && same(a.length - 1 - q, b.length - 1 - q)) q++;
		if (p > 0) emit(cx, 1, span(a.slice(0, p), pos[1]));
		const mid: Tri<Element[]> = [[], a.slice(p, a.length - q), b.slice(p, b.length - q)];
		const at = (s: 1 | 2): number => (run[s][p] ?? { from: r[s].to }).from;
		const midPos: Tri<number> = [pos[0], at(1), at(2)];
		if (mid[1].length === 0 || mid[2].length === 0) {
			emit(cx, 1, span(mid[1], midPos[1]));
			emit(cx, 2, span(mid[2], midPos[2]));
		} else addedTwice(cx, mid, midPos, parent);
		if (q > 0) emit(cx, 1, span(a.slice(a.length - q), r[1].to));
		return;
	}
	wholeConflict(cx, r, parent);
}

/** An element one side deleted while the other changed it (`deletedOn` is the side without it). */
function deleted(
	cx: Cx,
	deletedOn: 1 | 2,
	eo: Element,
	ek: Element,
	pos: Tri<number>,
	parent: Parent,
): void {
	const kept: SideIx = deletedOn === 1 ? 2 : 1;
	const so = single(eo);
	const sk = single(ek);
	if (!so || !sk) {
		const r: Tri<Rng> = [
			whole(eo),
			kept === 1 ? whole(ek) : { from: pos[1], to: pos[1] },
			kept === 2 ? whole(ek) : { from: pos[2], to: pos[2] },
		];
		wholeConflict(cx, r, parent);
		return;
	}
	const keptText = cx.sides[kept].text;
	const change = deletedOn === 1 ? 'deleted-ours' : 'deleted-theirs';
	if (blockKind(sk)) {
		const text = textOf(cx, kept, whole(ek));
		// The deleting side declares it as often as the base does (a copy elsewhere in this
		// file), or more often in another file: a move, not a deletion. No choice here can remove
		// the other copy, so it is a `text` conflict that offers only the moving side (and Edit…),
		// holding ours as every text conflict does (review L4).
		const key = statementKey(sk, keptText) ?? '';
		const gone = cx.sides[deletedOn];
		const moved =
			declCount(gone.tree, gone.text, key) >= declCount(cx.sides[0].tree, cx.sides[0].text, key) ||
			cx.elsewhere(deletedOn, key);
		const at = moved && deletedOn === 1 ? cx.out.push('') : cx.out.push(text);
		cx.out.conflict({
			subject: moved
				? { kind: 'text' }
				: { kind: 'block', owner: cx.naming.owner(sk, keptText), change },
			base: textOf(cx, 0, whole(eo)),
			ours: deletedOn === 1 ? null : text,
			theirs: deletedOn === 2 ? null : text,
			at,
			atOurs: deletedOn === 1 ? { from: pos[1], to: pos[1] } : whole(ek),
			atBase: whole(eo),
			both: false,
			// The other choice would leave a second copy (types.ts `MergeConflict.only`).
			...(moved ? { only: deletedOn === 1 ? ('ours' as const) : ('theirs' as const) } : {}),
		});
		return;
	}
	const subject = { kind: 'attribute', owner: parent.owner, attr: attrName(sk, keptText) } as const;
	const base = textOf(cx, 0, so);
	if (deletedOn === 1) {
		const p = cx.out.pos;
		cx.out.conflict({
			subject,
			base,
			ours: null,
			theirs: textOf(cx, 2, sk),
			at: { from: p, to: p },
			atOurs: { from: pos[1], to: pos[1] },
			atBase: { from: so.from, to: so.to },
			both: false,
		});
		return;
	}
	emit(cx, 1, { from: ek.from, to: sk.from });
	const at = emit(cx, 1, sk);
	cx.out.conflict({
		subject,
		base,
		ours: textOf(cx, 1, sk),
		theirs: null,
		at,
		atOurs: { from: sk.from, to: sk.to },
		atBase: { from: so.from, to: so.to },
		both: false,
	});
	emit(cx, 1, { from: sk.to, to: ek.to });
}

/** Runs both sides added at the same place (module comment). */
function addedTwice(cx: Cx, run: Tri<Element[]>, pos: Tri<number>, parent: Parent): void {
	const [, a] = run;
	const r = SIDES.map((s) => span(run[s], pos[s])) as unknown as Tri<Rng>;
	const stmts = [...a, ...run[2]].map(single);
	if (stmts.some((s) => s === null) || [...a, ...run[2]].some((e) => e.key === null)) {
		wholeConflict(cx, r, parent);
		return;
	}
	// What both added alike is added once (the user's decision, types.ts rule 3).
	const said = (s: SideIx, e: Element): string => textOf(cx, s, { from: e.lead, to: e.to }).trim();
	const mine = new Set(a.map((e) => said(1, e)));
	const b = run[2].filter((e) => !mine.has(said(2, e)));
	if (b.length === 0) {
		emit(cx, 1, r[1]);
		return;
	}
	const atBase = { from: pos[0], to: pos[0] };
	// Whether two additions can both stay is check.ts's to say (its item rules: the one rule set).
	const [ta, tb] = [cx.sides[1].text, cx.sides[2].text];
	const stays = (x: Element, y: Element): boolean =>
		independent(single(x) as SyntaxNode, ta, single(y) as SyntaxNode, tb);
	const clash = a.some((x) => b.some((y) => !stays(x, y)));
	const blocks = (stmts as SyntaxNode[]).map(blockKind);
	if (!clash && parent.inBlock && blocks.every((k) => k === null)) {
		emit(cx, 1, r[1]);
		for (const e of b) emit(cx, 2, whole(e));
		return;
	}
	if (clash) {
		const sa = single(a[0]);
		const sb = single(b[0]);
		if (a.length !== 1 || b.length !== 1 || !sa || !sb || !!blockKind(sa) !== !!blockKind(sb)) {
			wholeConflict(cx, r, parent);
			return;
		}
		const ea = a[0] as Element;
		if (blockKind(sa)) {
			const at = emit(cx, 1, whole(ea));
			cx.out.conflict({
				subject: {
					kind: 'block',
					owner: cx.naming.owner(sa, cx.sides[1].text),
					change: 'added-twice',
				},
				base: null,
				ours: textOf(cx, 1, whole(ea)),
				theirs: textOf(cx, 2, whole(b[0] as Element)),
				at,
				atOurs: whole(ea),
				atBase,
				both: false,
			});
			return;
		}
		emit(cx, 1, { from: ea.from, to: sa.from });
		const at = emit(cx, 1, sa);
		cx.out.conflict({
			subject: { kind: 'attribute', owner: parent.owner, attr: attrName(sa, cx.sides[1].text) },
			base: null,
			ours: textOf(cx, 1, sa),
			theirs: textOf(cx, 2, sb),
			at,
			atOurs: { from: sa.from, to: sa.to },
			atBase,
			both: false,
		});
		emit(cx, 1, { from: sa.to, to: ea.to });
		return;
	}
	if (blocks.every((k) => k === 'task' || k === 'resource')) {
		const at = emit(cx, 1, r[1]);
		cx.out.conflict({
			subject: { kind: 'block', owner: parent.owner, change: 'added-twice' },
			base: null,
			ours: textOf(cx, 1, r[1]),
			theirs: textOf(cx, 2, r[2]),
			at,
			atOurs: r[1],
			atBase,
			both: true,
		});
		return;
	}
	wholeConflict(cx, r, parent);
}
