// SPDX-License-Identifier: GPL-2.0-or-later
// Shared helpers of the intent families: reading plan facts, and drawing ids and values.
import {
	effectiveIds,
	SIZING,
	type Facts,
	type Rg,
	type Sem,
	type StmtF,
	type TaskF,
} from '../gen/facts';
import type { Rng } from '../gen/rng';

export const isLeaf = (t: TaskF): boolean => t.children.length === 0;

/** Own unprefixed statements of `key` (declaration and supplements), in reading order. */
export const own = (t: TaskF, ...keys: readonly string[]): StmtF[] =>
	t.stmts.filter((s) => keys.includes(s.key) && s.scenario === null);

export const task = (f: Facts, id: string): TaskF => {
	const t = f.byId.get(id);
	if (!t) throw new Error(`no task ${id}`);
	return t;
};

export const parentOf = (f: Facts, t: TaskF): TaskF | null =>
	t.parent === null ? null : (f.byId.get(t.parent) ?? null);

export const hasSizing = (t: TaskF): boolean => own(t, ...SIZING).length > 0;

export const allocated = (f: Facts, t: TaskF): string[] => effectiveIds(f, t, 'allocate');

/** Leaf resources: the ones that are nobody's parent. */
export const leafResources = (f: Facts): string[] => {
	const parents = new Set(f.resources.map((r) => r.parent));
	return f.resources.filter((r) => !parents.has(r.id)).map((r) => r.id);
};

export const declaredFlags = (sem: Sem): string[] => sem.flags;

export const rgsOf = (...lists: ReadonlyArray<readonly Rg[]>): Rg[] => lists.flatMap((l) => [...l]);

/** A date inside the project frame, early in it; null when the frame is unknown. */
export function dateValue(rng: Rng, f: Facts): string | null {
	if (!f.frame) return null;
	const days = Math.floor((f.frame.end - f.frame.start) / 86400);
	if (days < 20) return null;
	const at = f.frame.start + 86400 * Math.max(2, Math.floor(days * (0.04 + 0.3 * rng.next())));
	const day = new Date(at * 1000).toISOString().slice(0, 10);
	return rng.chance(0.25) ? `${day}-${String(rng.int(9, 15)).padStart(2, '0')}:00` : day;
}

/** The last whole day of the frame, for an upper bound that cannot bind. */
export function frameEnd(f: Facts): string | null {
	return f.frame ? new Date((f.frame.end - 86400) * 1000).toISOString().slice(0, 10) : null;
}

export const hoursValue = (rng: Rng): string =>
	rng.chance(0.3) ? `${rng.int(1, 2)}d` : `${rng.int(2, 16)}h`;

export const sorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();
