// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * H5 "Long gap" and H6 "Long task" (phase-3.md section 12; 18.8 defaults 5 and 20 working days).
 *
 * - **H5** (warning): a dependency whose `gaplength` is over `longGapDays` working days, or whose
 *   `gapduration` is over `longGapDays` calendar days (the gap's own rate). One finding per link as
 *   written: a task's own entries of its resolved `depends` and `precedes` (those its parent's list
 *   does not hold; TaskJuggler lists the parent's first and drops a repeat), so a container's gap is
 *   reported once, not once per child. Fixes: "Convert gap to task" (`gapToTask`, `depends` only)
 *   and "Edit gap" (`setDependsGap`).
 * - **H6** (info): a leaf whose engine span [start, end) has more than `longTaskDays` working days
 *   of the project's calendar. Milestones are not long. Fix: "Show in text" (there is no split
 *   intent; "Add subtask" is refused on an effort leaf by the edit API).
 */
// T11: a link with both gaps is reported once, with the gap that is longer in days. "Convert gap
// to task" is left out for it (gapToTask refuses an item with both gaps: `unsupported-form`), as
// for a `precedes` link (gapToTask converts `depends` items only).
// T11: "Edit gap" carries `setDependsGap` with the link's current gap as written by the engine
// (`5d`, `2w` in whole days); the panel (T18) asks for the new value and dispatches the intent
// with it. Dispatched unchanged it is a noop (`already-set`), never a change nobody asked for.
// T11: a container's own link is reported (the subject is the link, not the container).
// T11: a link the engine has but the index has no item for was written by macro expansion (a
// statement-level macro call); its fixes are disabled as `macro-call`, and `at` is the task.
import type { DependencyResult } from '../../engine/protocol';
import { nearestSite } from '../schedule/explain-text';
import { healthStrings as S } from '../strings-health';
import type { DependencySite, TaskId } from '../tjp/index';
import {
	checkedTasks,
	firstReason,
	roundDays,
	siteReason,
	taskAt,
	taskReason,
	workingDays,
	type Run,
} from './common';
import type { Fix, FindingOf } from './types';

const DAY = 1440;

/** A gap in whole days, or in hours when it is not whole days, as TaskJuggler reads it. */
function gapText(min: number, perDay: number): string {
	return min % perDay === 0 ? `${min / perDay}d` : `${Math.round((min / 60) * 100) / 100}h`;
}

/** The written item of a link, preferring its own form. */
function siteOf(
	run: Run,
	pred: TaskId,
	succ: TaskId,
	form: 'depends' | 'precedes',
): DependencySite | null {
	let other: DependencySite | null = null;
	for (const d of run.index.dependencies) {
		if (d.pred !== pred || d.succ !== succ) continue;
		if (d.scenario !== null && !run.chain.includes(d.scenario)) continue;
		if (d.form === form) return d;
		other ??= d;
	}
	return other;
}

/** The entries of `list` the parent's list does not hold (the task's own). */
function own(run: Run, id: TaskId, via: 'depends' | 'precedes'): DependencyResult[] {
	const s = run.scenarioOf(id);
	if (!s || !s[via].some((d) => d.gapLengthMin > 0 || d.gapDurationMin > 0)) return [];
	const parent = run.parent.get(id) ?? null;
	const inherited = new Set(
		(parent === null ? [] : (run.scenarioOf(parent)?.[via] ?? [])).map((d) => d.task),
	);
	return s[via].filter((d) => !inherited.has(d.task));
}

export function longGaps(run: Run): FindingOf<'long-gap'>[] {
	const out: FindingOf<'long-gap'>[] = [];
	const limit = run.settings.longGapDays;
	for (const id of run.order) {
		for (const via of ['depends', 'precedes'] as const) {
			for (const d of own(run, id, via)) {
				const len = d.gapLengthMin / run.dayMin;
				const dur = d.gapDurationMin / DAY;
				const gap = len >= dur ? 'gaplength' : 'gapduration';
				const days = Math.max(len, dur);
				if (!(days > limit)) continue;
				const [pred, succ] = via === 'depends' ? [d.task, id] : [id, d.task];
				const site = siteOf(run, pred, succ, via);
				const disabled = firstReason(
					taskReason(run, succ),
					taskReason(run, pred),
					site ? siteReason(run, site, site.item) : 'macro-call',
				);
				const value =
					gap === 'gaplength'
						? gapText(d.gapLengthMin, run.dayMin)
						: gapText(d.gapDurationMin, DAY);
				const fixes: Fix[] = [];
				if (via === 'depends' && d.gapLengthMin > 0 !== d.gapDurationMin > 0) {
					const name = S.gapTaskName(run.index.tasks.get(pred)?.name ?? pred);
					fixes.push({
						kind: 'intent',
						label: S.fix.gapToTask,
						intent: { type: 'gapToTask', task: succ, target: pred, name },
						disabled,
					});
				}
				fixes.push({
					kind: 'intent',
					label: S.fix.editGap,
					intent: { type: 'setDependsGap', task: succ, target: pred, gap: { kind: gap, value } },
					disabled,
				});
				out.push({
					check: 'long-gap',
					severity: 'warning',
					subject: { kind: 'link', pred, succ },
					at: site?.item ?? taskAt(run, id),
					fixes,
					facts: { gap, days: roundDays(days) },
				});
			}
		}
	}
	return out;
}

const SIZING = new Set(['effort', 'length', 'duration']);

export function longTasks(run: Run): FindingOf<'long-task'>[] {
	const out: FindingOf<'long-task'>[] = [];
	const limit = run.settings.longTaskDays;
	for (const id of checkedTasks(run)) {
		const s = run.scenarioOf(id);
		if (!s || run.milestones.has(id) || s.start === null || s.end === null) continue;
		const days = workingDays(run, s.start, s.end);
		if (!(days > limit)) continue;
		const sym = run.index.tasks.get(id);
		const size = sym ? nearestSite(sym.attrs, SIZING, run.chain) : null;
		out.push({
			check: 'long-task',
			severity: 'info',
			subject: { kind: 'task', id },
			at: size?.statement ?? taskAt(run, id),
			fixes: [{ kind: 'show', disabled: null }],
			facts: { days: roundDays(days) },
		});
	}
	return out;
}
