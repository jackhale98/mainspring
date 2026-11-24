// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Whether two sides' changes to one block are independent (review round 3, the structural rule;
 * types.ts rule 2). A task, resource, project or supplement body that both sides changed
 * statements of is merged statement by statement (refine.ts) and is clean only if every pair of
 * changes is provably independent under the keyword table (keywords.ts). The check reads each
 * side's statements of the body by their value slot (a single-valued keyword, without scenario
 * prefix; a repeatable keyword with it; a nested block by its key) and compares them with the
 * base's: what a side added and what it removed (a changed statement is both).
 *
 * - **Single-valued** (`priority`, `start`, a sizing criterion, `timezone`, any keyword the table
 *   does not know): both sides changed the slot, to different results, is a clash.
 * - **Repeatable** (`allocate`, `flags`, `booking` …): changes clash only when their items meet:
 *   `depends`/`precedes` by target (`a` and `!a` are one), `workinghours` by weekday (each
 *   statement replaces the hours of its days), anything else by its text.
 * - **`purge X`** changed on one side clashes with any change to `X` on the other.
 * - **Nested blocks** are merged in turn; both sides adding one with the same key is a clash.
 * - A statement-level macro call changed on either side, or an error node, cannot be keyed or
 *   read: the whole block is one conflict.
 * - Identical additions are kept once: the copy with a trailing comment if only one has one,
 *   else ours.
 *
 * A clash between one statement each side added becomes a conflict at ours' statement, theirs'
 * statement taken out (the plan); any other clash makes the whole block one conflict.
 */
import type { SyntaxNode } from '@lezer/common';
import { SIDES, type Cx, type SideIx, type Tri } from './emit';
import { attrName, blockKind, statementKey } from './hints';
import { keywordOf, repeatable } from './keywords';

/** A statement by side and start: `1:120`. */
export const at = (s: SideIx, n: { readonly from: number }): string => `${s}:${n.from}`;

export interface Hold {
	/** Theirs' statement the conflict offers. */
	readonly theirs: SyntaxNode;
	readonly attr: string;
	/** Two blocks with one key (`block` `added-twice`), else an `attribute` conflict. */
	readonly block: boolean;
}

/** How a block both sides changed merges (module comment). */
export interface BlockPlan {
	/** Ours' statements (by `at`) that become a conflict with theirs'. */
	readonly holds: ReadonlyMap<string, Hold>;
	/** Statements (by `at`) left out of the merge: theirs' side of a hold, a duplicate. */
	readonly drops: ReadonlySet<string>;
	/** Holds emitted so far (refine.ts checks all were). */
	readonly done: Set<string>;
	/** Set when the merge could not follow the plan (a run that is not clean). */
	failed: boolean;
}

const SIZING = new Set(['effort', 'duration', 'length', 'milestone']);
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The slot a statement is compared in (module comment); null when it cannot be keyed. */
function slotOf(st: SyntaxNode, text: string): string | null {
	const key = statementKey(st, text);
	if (key === null) return null;
	if (blockKind(st)) return key;
	const kw = keywordOf(st, text);
	const name = attrName(st, text);
	if (repeatable(kw)) return name;
	return SIZING.has(kw) ? `${name.slice(0, -kw.length)}sizing` : name;
}

/** The items a repeatable statement adds (module comment). */
function itemsOf(st: SyntaxNode, text: string): string[] {
	const kw = keywordOf(st, text);
	const body = text.slice(st.from, st.to);
	if (kw === 'depends' || kw === 'precedes') {
		const out: string[] = [];
		for (let c = st.firstChild; c; c = c.nextSibling) {
			if (c.name !== 'DepItem') continue;
			const ref = c.getChild('TaskRef');
			if (ref) out.push(text.slice(ref.from, ref.to).replace(/^!+/, ''));
		}
		return out.length > 0 ? out : [body];
	}
	if (kw === 'workinghours') {
		const days = new Set<string>();
		const words = body.slice(kw.length).split(/[\s,]+/);
		for (let i = 0; i < words.length; i++) {
			const w = (words[i] ?? '').toLowerCase();
			const d = DAYS.indexOf(w);
			if (d < 0) {
				if (w !== '-' && w !== '') break;
				continue;
			}
			if (words[i + 1] === '-' && DAYS.includes((words[i + 2] ?? '').toLowerCase())) {
				const e = DAYS.indexOf((words[i + 2] as string).toLowerCase());
				for (let k = d; k !== (e + 1) % 7; k = (k + 1) % 7) days.add(DAYS[k] as string);
				i += 2;
			} else days.add(DAYS[d] as string);
		}
		return days.size > 0 ? [...days] : [body];
	}
	return [body.trim()];
}

interface Side {
	readonly text: string;
	readonly bySlot: Map<string, SyntaxNode[]>;
	readonly unkeyed: SyntaxNode[];
}

function sideOf(body: SyntaxNode | null, text: string): Side {
	const bySlot = new Map<string, SyntaxNode[]>();
	const unkeyed: SyntaxNode[] = [];
	for (let c = body?.firstChild ?? null; c; c = c.nextSibling) {
		if (!c.name.endsWith('Statement')) continue;
		const slot = slotOf(c, text);
		if (slot === null) {
			unkeyed.push(c);
			continue;
		}
		const list = bySlot.get(slot);
		if (list) list.push(c);
		else bySlot.set(slot, [c]);
	}
	return { text, bySlot, unkeyed };
}

const said = (side: Side, n: SyntaxNode): string => side.text.slice(n.from, n.to).trim();

/** What a side added and removed against the base, by text (multisets). */
function delta(
	base: Side,
	x: Side,
	list: (s: Side) => readonly SyntaxNode[],
): { added: SyntaxNode[]; removed: SyntaxNode[] } {
	const left = list(base).map((n) => said(base, n));
	const added: SyntaxNode[] = [];
	for (const n of list(x)) {
		const i = left.indexOf(said(x, n));
		if (i >= 0) left.splice(i, 1);
		else added.push(n);
	}
	const kept = list(x).map((n) => said(x, n));
	const removed: SyntaxNode[] = [];
	for (const n of list(base)) {
		const i = kept.indexOf(said(base, n));
		if (i >= 0) kept.splice(i, 1);
		else removed.push(n);
	}
	return { added, removed };
}

/** Whether a statement's line goes on after it with a comment. */
function commented(text: string, n: SyntaxNode): boolean {
	const nl = text.indexOf('\n', n.to);
	return /#|\/\//.test(text.slice(n.to, nl < 0 ? text.length : nl));
}

function hasErrorIn(body: SyntaxNode | null): boolean {
	if (!body) return false;
	for (let c = body.firstChild; c; c = c.nextSibling) {
		if (c.type.isError) return true;
		if (c.name === 'Body') continue;
		let bad = false;
		c.toTree().iterate({
			enter: (n) => {
				if (n.type.isError) bad = true;
				return bad ? false : n.name === 'Body' ? false : undefined;
			},
		});
		if (bad) return true;
	}
	return false;
}

/** The plan for a block both sides changed, or 'whole' when it is one conflict (module comment). */
export function checkBlock(cx: Cx, bodies: Tri<SyntaxNode | null>): BlockPlan | 'whole' {
	if (SIDES.some((s) => hasErrorIn(bodies[s]))) return 'whole';
	const sides = SIDES.map((s) => sideOf(bodies[s], cx.sides[s].text)) as unknown as Tri<Side>;
	const [o, a, b] = sides;
	const unkeyedA = delta(o, a, (s) => s.unkeyed);
	const unkeyedB = delta(o, b, (s) => s.unkeyed);
	if ([unkeyedA, unkeyedB].some((d) => d.added.length + d.removed.length > 0)) return 'whole';
	const holds = new Map<string, Hold>();
	const drops = new Set<string>();
	const slots = new Set([...o.bySlot.keys(), ...a.bySlot.keys(), ...b.bySlot.keys()]);
	const changed = new Map<string, Tri<{ added: SyntaxNode[]; removed: SyntaxNode[] }>>();
	for (const slot of slots) {
		const list = (s: Side): SyntaxNode[] => s.bySlot.get(slot) ?? [];
		const da = delta(o, a, list);
		const db = delta(o, b, list);
		changed.set(slot, [{ added: [], removed: [] }, da, db]);
	}
	const touched = (slot: string, s: 1 | 2): boolean => {
		const d = changed.get(slot)?.[s];
		return !!d && d.added.length + d.removed.length > 0;
	};
	/** Keeps one of two identical additions (module comment). */
	const collapse = (x: SyntaxNode, y: SyntaxNode): void => {
		const cy = commented(b.text, y);
		if (cy && !commented(a.text, x)) drops.add(at(1, x));
		else drops.add(at(2, y));
	};
	/** A clash: one addition each side, held at ours; else the whole block. */
	const clash = (slot: string, block: boolean): boolean => {
		const d = changed.get(slot) as Tri<{ added: SyntaxNode[]; removed: SyntaxNode[] }>;
		const [, da, db] = d;
		if (da.removed.length > 0 || db.removed.length > 0) return false;
		if (da.added.length !== 1 || db.added.length !== 1) return false;
		const x = da.added[0] as SyntaxNode;
		const y = db.added[0] as SyntaxNode;
		holds.set(at(1, x), { theirs: y, attr: block ? '' : attrName(x, a.text), block });
		drops.add(at(2, y));
		return true;
	};
	for (const slot of slots) {
		if (!touched(slot, 1) || !touched(slot, 2)) continue;
		const [, da, db] = changed.get(slot) as Tri<{ added: SyntaxNode[]; removed: SyntaxNode[] }>;
		// Both sides changed (or one removed) the same one base statement: the statement merge
		// aligns the two and makes it an `attribute` conflict (or a nested block's merge).
		const [ra, rb] = [da.removed[0], db.removed[0]];
		if (
			da.removed.length === 1 &&
			db.removed.length === 1 &&
			ra &&
			rb &&
			said(o, ra) === said(o, rb) &&
			da.added.length <= 1 &&
			db.added.length <= 1
		) {
			continue;
		}
		const any = (da.added[0] ?? da.removed[0] ?? db.added[0] ?? db.removed[0]) as SyntaxNode;
		const sample = da.added[0] ? a : da.removed[0] ? o : db.added[0] ? b : o;
		if (blockKind(any)) {
			// Nested blocks merge in turn; only one added on both sides with one key clashes.
			if (da.removed.length > 0 || db.removed.length > 0) continue;
			const [x, y] = [da.added[0], db.added[0]];
			if (da.added.length === 1 && db.added.length === 1 && x && y) {
				if (said(a, x) === said(b, y)) collapse(x, y);
				else clash(slot, true);
				continue;
			}
			return 'whole';
		}
		const kw = keywordOf(any, sample.text);
		if (repeatable(kw)) {
			const items = (side: Side, n: SyntaxNode): string[] => itemsOf(n, side.text);
			for (const x of [...da.added, ...da.removed]) {
				const sx = da.added.includes(x) ? a : o;
				for (const y of [...db.added, ...db.removed]) {
					const sy = db.added.includes(y) ? b : o;
					const ix = items(sx, x);
					if (!items(sy, y).some((k) => ix.includes(k))) continue;
					if (da.added.includes(x) && db.added.includes(y) && said(a, x) === said(b, y)) {
						collapse(x, y);
						continue;
					}
					if (!clash(slot, false)) return 'whole';
				}
			}
			continue;
		}
		// Single-valued: the same result on both sides is no clash (one copy kept).
		const result = (s: Side): string[] => (s.bySlot.get(slot) ?? []).map((n) => said(s, n)).sort();
		if (JSON.stringify(result(a)) === JSON.stringify(result(b))) {
			for (const x of da.added) {
				const y = db.added.find((n) => said(b, n) === said(a, x));
				if (y) collapse(x, y);
			}
			continue;
		}
		if (!clash(slot, false)) return 'whole';
	}
	// A single-valued keyword newly said without a scenario prefix on one side and with one on
	// the other: the unprefixed statement sets every scenario, so the two clash (review H1 edge).
	// Repeatable slots keep their prefix and never meet here.
	const grew = (slot: string, s: 1 | 2): boolean => {
		const d = changed.get(slot)?.[s];
		return !!d && d.added.length > d.removed.length;
	};
	for (const x of slots) {
		if (x.includes(':') || repeatable(x)) continue;
		for (const y of slots) {
			if (!y.includes(':') || y.slice(y.indexOf(':') + 1) !== x) continue;
			if ((grew(x, 1) && grew(y, 2)) || (grew(y, 1) && grew(x, 2))) return 'whole';
		}
	}
	// `purge X` changed on one side clashes with any change to X on the other.
	for (const [s, other] of [
		[1, 2],
		[2, 1],
	] as const) {
		const side = sides[s];
		for (const n of [
			...(changed.get('purge')?.[s].added ?? []),
			...(changed.get('purge')?.[s].removed ?? []),
		]) {
			const target = side.text.slice(n.from, n.to).split(/\s+/)[1] ?? '';
			for (const slot of slots) {
				if (
					(slot === target ||
						slot.endsWith(`:${target}`) ||
						(target && slot === (SIZING.has(target) ? 'sizing' : target))) &&
					touched(slot, other)
				) {
					return 'whole';
				}
			}
		}
	}
	return { holds, drops, done: new Set(), failed: false };
}
