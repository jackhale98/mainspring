// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A block's plan inside the keyed merge (keyed.ts; check.ts): the statements the plan leaves out
 * are taken out of the sequences, and a run that merges cleanly is emitted element by element,
 * each statement the plan holds as its conflict (`attribute`, or `block` `added-twice`), marked
 * done. statement.ts keeps the result only when every hold is done and the plan did not fail.
 */
import type { SyntaxNode } from '@lezer/common';
import { at, type BlockPlan } from './check';
import type { Element } from './elements';
import { emit, SIDES, textOf, type Cx, type Parent, type SideIx, type Tri } from './emit';
import type { Seq } from './keyed';
import type { Rng } from './out';

const whole = (e: Element): Rng => ({ from: e.from, to: e.to });

/** The plan's statement of an element, when the element is that one statement. */
function only(e: Element | undefined): SyntaxNode | null {
	return e && e.kind === 'stmt' && e.stmts.length === 1 ? (e.stmts[0] as SyntaxNode) : null;
}

export const held = (plan: BlockPlan, e: Element | undefined): boolean => {
	const st = only(e);
	return !!st && plan.holds.has(at(1, st));
};

/** Whether a statement the plan leaves out lies between the first and last element of a run. */
export function holesIn(seq: Seq, run: readonly Element[], plan: BlockPlan, s: SideIx): boolean {
	const first = run[0];
	const last = run[run.length - 1];
	if (!first || !last) return false;
	return seq.els.some((e) => {
		const st = only(e);
		return !!st && plan.drops.has(at(s, st)) && e.from >= first.from && e.to <= last.to;
	});
}

/**
 * The sequences without the statements the plan leaves out. A planned statement that shares its
 * lines with others cannot be left out or held alone: the plan fails (one conflict instead).
 */
export function planned(seqs: Tri<Seq>, plan: BlockPlan): Tri<Seq> {
	const keys = new Set([...plan.drops, ...plan.holds.keys()]);
	const found = new Set<string>();
	const out = SIDES.map((s) => {
		const els = seqs[s].els.filter((e) => {
			for (const st of e.stmts) {
				const k = at(s, st);
				if (!keys.has(k)) continue;
				found.add(k);
				if (e.stmts.length !== 1) plan.failed = true;
			}
			const st = only(e);
			return !(st && plan.drops.has(at(s, st)));
		});
		return { ...seqs[s], els };
	}) as unknown as Tri<Seq>;
	if ([...keys].some((k) => !found.has(k))) plan.failed = true;
	return out;
}

/**
 * Emits a run element by element when the run merges cleanly (one side changed it, or both
 * alike), a held statement as its conflict; false when it does not merge cleanly.
 */
export function emitPlanned(
	cx: Cx,
	run: Tri<Element[]>,
	pos: Tri<number>,
	parent: Parent,
	plan: BlockPlan,
): boolean {
	const t = SIDES.map((s) =>
		run[s].map((e) => textOf(cx, s, whole(e))).join(''),
	) as unknown as Tri<string>;
	const side: SideIx | null = t[1] === t[2] || t[2] === t[0] ? 1 : t[1] === t[0] ? 2 : null;
	if (side === null) return false;
	for (const e of run[side]) {
		const st = only(e);
		const hold = side === 1 && st ? plan.holds.get(at(1, st)) : undefined;
		if (!st || !hold) {
			emit(cx, side, whole(e));
			continue;
		}
		const theirs = cx.sides[2].text;
		if (hold.block) {
			// The two blocks' own lines (each side's comments above stay outside the region).
			emit(cx, 1, { from: e.from, to: e.lead });
			const mine = { from: e.lead, to: e.to };
			const at0 = emit(cx, 1, mine);
			const y = hold.theirs;
			const ls = theirs.lastIndexOf('\n', y.from - 1) + 1;
			const nl = theirs.indexOf('\n', y.to);
			cx.out.conflict({
				subject: {
					kind: 'block',
					owner: cx.naming.owner(st, cx.sides[1].text),
					change: 'added-twice',
				},
				base: null,
				ours: textOf(cx, 1, mine),
				theirs: theirs.slice(ls, nl < 0 ? theirs.length : nl + 1),
				at: at0,
				atOurs: mine,
				atBase: { from: pos[0], to: pos[0] },
				both: false,
			});
		} else {
			emit(cx, 1, { from: e.from, to: st.from });
			const at0 = emit(cx, 1, st);
			cx.out.conflict({
				subject: { kind: 'attribute', owner: parent.owner, attr: hold.attr },
				base: null,
				ours: textOf(cx, 1, st),
				theirs: theirs.slice(hold.theirs.from, hold.theirs.to),
				at: at0,
				atOurs: { from: st.from, to: st.to },
				atBase: { from: pos[0], to: pos[0] },
				both: false,
			});
			emit(cx, 1, { from: st.to, to: e.to });
		}
		plan.done.add(at(1, st));
	}
	return true;
}
