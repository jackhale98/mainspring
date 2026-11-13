// SPDX-License-Identifier: GPL-2.0-or-later
// Properties of the driving-path analysis on generated plans without resources (phase-2.md 13.1):
// critical tasks have float 0, the path is exactly the oracle's walk (connected, back from the
// finish), float is at least 0, and no leaf is `unexplained`, since without resources every start
// is set by a dependency or the frame (testing-oracle.ts, `allExplained`).
//
// The dates come from a forward pass in this test that places length tasks as TaskJuggler does
// without resources (TaskScenario#earliestStart and the slot walk of a `length`): a task starts at
// the latest bound of its `depends` entries (or the frame start), or at the next working slot when
// it books like an effort task; it ends after its working slots; a milestone sits on its bound; a
// container spans its children, which inherit its entries; an ALAP task ends at the bound of its
// `precedes` entry. Test code only: the app never computes a schedule (CLAUDE.md, ADR-0007).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DependencyResult, ScheduleResult } from '../../engine/protocol';
import { analyse } from './critical';
import { at, plan, project as projectInfo, type TaskSpec } from './testing';
import { checkAnalysis, oracleOf } from './testing-oracle';
import { workingTimeOf } from './working-time';

const DAYS = 500;

/** Two calendars: Mon-Fri 09:00-17:00 at 60 minutes, and a split day at 30 minutes. */
const CALENDARS = {
	weekdays: { res: 60, day: (d: number) => (d % 7 < 5 ? [[9, 17]] : []) },
	split: {
		res: 30,
		day: (d: number) =>
			d % 7 < 4
				? [
						[8.5, 12.5],
						[13.5, 17],
					]
				: d % 7 === 4
					? [[8.5, 12.5]]
					: [],
	},
} as const;

function pairsOf(cal: keyof typeof CALENDARS): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (let d = 0; d < DAYS; d++) {
		for (const [a, b] of CALENDARS[cal].day(d)) out.push([at(d, a ?? 0), at(d, b ?? 0)]);
	}
	return out;
}

interface Spec {
	/** Relative depth to the previous task: the tree in pre-order. */
	step: number;
	/** Working slots; 0 is a milestone. */
	length: number;
	/** Books like an effort task: starts at the next working slot. */
	snap: boolean;
	deps: Array<{ pick: number; onEnd: boolean; gapSlots: number; gapDays: number }>;
}

const depArb = fc.record({
	pick: fc.nat(),
	// Mostly the default (after the predecessor's end), sometimes `onstart`.
	onEnd: fc.oneof(fc.constant(true), fc.constant(true), fc.constant(false)),
	gapSlots: fc.oneof(fc.constant(0), fc.constant(0), fc.integer({ min: 1, max: 16 })),
	gapDays: fc.oneof(fc.constant(0), fc.constant(0), fc.integer({ min: 1, max: 3 })),
});
const specArb = fc.record({
	step: fc.integer({ min: -2, max: 1 }),
	length: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 24 })),
	snap: fc.boolean(),
	deps: fc.array(depArb, { maxLength: 3 }),
});
const alapArb = fc.record({
	pick: fc.nat(),
	onEnd: fc.boolean(),
	gapSlots: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 8 })),
	length: fc.integer({ min: 0, max: 16 }),
});

/** A plan and its dates from the forward pass; null when a task would leave the frame. */
function generate(
	cal: keyof typeof CALENDARS,
	specs: Spec[],
	alaps: Array<{ pick: number; onEnd: boolean; gapSlots: number; length: number }>,
): ScheduleResult | null {
	const res = CALENDARS[cal].res;
	const pairs = pairsOf(cal);
	const working = new Set<number>();
	for (const [a, b] of pairs) for (let m = a; m < b; m += res) working.add(m);
	const frameEnd = DAYS * 1440;
	const project = { workingTime: pairs, timingResolutionMin: res, end: '2027-05-20T00:00:00Z' };
	const o = oracleOf(projectInfo(project));
	const next = (m: number): number => {
		let s = Math.ceil(m / res) * res;
		while (s < frameEnd && !working.has(s)) s += res;
		return s;
	};
	const forward = (s: number, slots: number): number => {
		let m = s;
		for (let n = slots; n > 0; m += res) {
			if (m >= frameEnd) return NaN;
			if (working.has(m)) n--;
		}
		return m;
	};
	const back = (e: number, slots: number): number => {
		let m = e;
		for (let n = slots; n > 0; m -= res) {
			if (m <= 0) return NaN;
			if (working.has(m - res)) n--;
		}
		return m;
	};

	// The tree in pre-order: ids are paths, so `a.b` is a child of `a`.
	const ids: string[] = [];
	const parent: Array<number | null> = [];
	const depth: number[] = [];
	specs.forEach((s, i) => {
		const d =
			i === 0 ? 0 : Math.max(0, Math.min((depth[i - 1] ?? 0) + s.step, (depth[i - 1] ?? 0) + 1));
		let p: number | null = null;
		for (let j = i - 1; j >= 0; j--) {
			if ((depth[j] ?? 0) === d - 1) {
				p = j;
				break;
			}
		}
		depth.push(d);
		parent.push(p);
		ids.push(p === null ? `t${i}` : `${ids[p]}.t${i}`);
	});
	const isAncestor = (a: number, i: number): boolean => {
		for (let p = parent[i] ?? null; p !== null; p = parent[p] ?? null) if (p === a) return true;
		return false;
	};
	const leaf = (i: number): boolean => !parent.some((p) => p === i);

	// Entries: own ones name earlier tasks outside the ancestry; inherited ones come first.
	const own: DependencyResult[][] = specs.map((s, i) => {
		const allowed = ids.map((_, j) => j).filter((j) => j < i && !isAncestor(j, i));
		const out: DependencyResult[] = [];
		for (const d of s.deps) {
			if (allowed.length === 0) break;
			const j = allowed[d.pick % allowed.length] as number;
			if (out.some((e) => e.task === ids[j])) continue;
			out.push({
				task: ids[j] as string,
				onEnd: d.onEnd,
				gapLengthMin: d.gapSlots * res,
				gapDurationMin: d.gapDays * 1440,
			});
		}
		return out;
	});
	const lists: DependencyResult[][] = specs.map((_, i) => {
		const chain: number[] = [];
		for (let p = parent[i] ?? null; p !== null; p = parent[p] ?? null) chain.unshift(p);
		const list: DependencyResult[] = [];
		for (const k of [...chain, i]) {
			for (const e of own[k] ?? []) if (!list.some((x) => x.task === e.task)) list.push(e);
		}
		return list;
	});

	// Dates in pre-order; a container's once its subtree is done (it ends before anything that
	// can name it, since pre-order puts a subtree right after its root).
	const start: number[] = [];
	const end: number[] = [];
	const dateOf = (j: number, atEnd: boolean): number => {
		if (!leaf(j)) {
			const sub = ids.map((_, k) => k).filter((k) => isAncestor(j, k) && leaf(k));
			return atEnd
				? Math.max(...sub.map((k) => end[k] as number))
				: Math.min(...sub.map((k) => start[k] as number));
		}
		return (atEnd ? end[j] : start[j]) as number;
	};
	for (let i = 0; i < specs.length; i++) {
		if (!leaf(i)) continue;
		const s = specs[i] as Spec;
		let e = 0;
		for (const d of lists[i] ?? []) {
			e = Math.max(e, o.earliest(dateOf(ids.indexOf(d.task), d.onEnd), d));
		}
		const st = s.length > 0 && s.snap ? next(e) : e;
		const en = forward(st, s.length);
		if (!Number.isFinite(en) || st >= frameEnd) return null;
		start[i] = st;
		end[i] = en;
	}
	const tasks: Array<[string, TaskSpec]> = ids.map((id, i) => [
		id,
		{
			...(parent[i] === null ? {} : { parent: ids[parent[i] as number] as string }),
			start: dateOf(i, false),
			end: dateOf(i, true),
			milestone: leaf(i) && specs[i]?.length === 0,
			depends: lists[i] ?? [],
		},
	]);

	// ALAP tasks at the top level, each placed by one precedes entry.
	alaps.forEach((x, k) => {
		const q = x.pick % ids.length;
		const entry: DependencyResult = {
			task: ids[q] as string,
			onEnd: x.onEnd,
			gapLengthMin: x.gapSlots * res,
			gapDurationMin: 0,
		};
		const en = o.latest(dateOf(q, x.onEnd), entry);
		const st = back(en, x.length);
		if (!Number.isFinite(st) || st < 0) return;
		tasks.push([
			`alap${k}`,
			{ start: st, end: en, alap: true, milestone: x.length === 0, precedes: [entry] },
		]);
	});
	return plan(tasks, project);
}

describe('the driving-path analysis on generated plans without resources', () => {
	it('agrees with the oracle: float, the path, critical tasks and links, drivers', () => {
		let checked = 0;
		fc.assert(
			fc.property(
				fc.constantFrom<keyof typeof CALENDARS>('weekdays', 'split'),
				fc.array(specArb, { minLength: 2, maxLength: 18 }),
				fc.array(alapArb, { maxLength: 3 }),
				(cal, specs, alaps) => {
					const r = generate(cal, specs, alaps);
					if (!r?.project) return true;
					const a = analyse(r, 'plan', workingTimeOf(r.project));
					const bad = checkAnalysis(r, a, { allExplained: true });
					if (bad.length > 0) throw new Error(bad.join('\n'));
					if (a.path.size === 0) throw new Error('no path');
					checked++;
					return true;
				},
			),
			{ seed: 20261113, numRuns: 400 },
		);
		expect(checked).toBeGreaterThan(300);
	});
});
