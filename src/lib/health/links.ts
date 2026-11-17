// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * H1 "No predecessor" and H2 "No successor" (phase-3.md section 12; 18.8), from the resolved
 * `depends` and `precedes` lists of the result. TaskJuggler inherits both lists (Project.rb,
 * DependencyListAttribute), so a leaf's lists already hold its ancestors'; a task that names an
 * ancestor counts for its children too.
 *
 * - **H1**: the leaf's `depends` is empty, no task `precedes` it or an ancestor, and no ancestor
 *   has a predecessor. Exempt: a milestone at the project start (the start milestone).
 * - **H2**: no task depends on it or on an ancestor, and its own and its ancestors' `precedes` are
 *   empty. Exempt: a milestone that ends at the scenario finish (the finish milestone).
 *
 * Fixes: the dependency picker ("Add predecessor…", "Add successor…"), disabled with the task's
 * text-only reason (an `addDepends` on it, or naming it, is refused for the same reason).
 */
// Milestones are left out of H1 and H2 unless the plan's `linkMilestones` setting is on (user,
// 2026-11-17: key dates are often unlinked on purpose).
// T11: which tasks and links count (the fedora-res review, 2026-11-17). Leaves and milestones only,
// as section 12 says ("containers are not checked themselves"), and a link on any ancestor counts
// for them (TaskJuggler inherits `depends` and `precedes`, and a task naming a container waits for
// all of it). A container is never flagged, so "a container whose children are all linked" cannot
// be. That is already the least noisy reading that stays true: on fedora-res every remaining H1
// and H2 is a leaf that neither it nor any ancestor is linked from (to), checked against the text
// (health.golden.test.ts, spot checks 3 and 4). Most are Fedora's key-date milestones (22 of 48 and
// 139 of 200), which section 12 exempts only at the project start and the scenario finish.
// T11: "at the project start" is read as at or before the project's first working minute, so a
// kickoff milestone written `start 2026-01-05-09:00` on a Monday 09:00 calendar is exempt as well as
// one at 00:00. A milestone the engine left without a date is not exempt.
import type { TaskId } from '../tjp/index';
import { checkedTasks, selfAndAncestors, taskAt, taskReason, type Run } from './common';
import type { FindingOf } from './types';

interface Lists {
	/** Tasks some task names in its `precedes`. */
	readonly preceded: ReadonlySet<TaskId>;
	/** Tasks some task names in its `depends`. */
	readonly dependedOn: ReadonlySet<TaskId>;
}

function listsOf(run: Run): Lists {
	const preceded = new Set<TaskId>();
	const dependedOn = new Set<TaskId>();
	for (const id of run.order) {
		const s = run.scenarioOf(id);
		if (!s) continue;
		for (const d of s.precedes) preceded.add(d.task);
		for (const d of s.depends) dependedOn.add(d.task);
	}
	return { preceded, dependedOn };
}

export function noPredecessor(run: Run): FindingOf<'no-predecessor'>[] {
	const { preceded } = listsOf(run);
	const firstWork = run.wt.snap(0, 'start');
	const out: FindingOf<'no-predecessor'>[] = [];
	for (const id of checkedTasks(run)) {
		const s = run.scenarioOf(id);
		if (!s) continue;
		const has = selfAndAncestors(run, id).some(
			(a) => preceded.has(a) || (run.scenarioOf(a)?.depends.length ?? 0) > 0,
		);
		if (has) continue;
		if (run.milestones.has(id) && !run.settings.linkMilestones) continue;
		if (run.milestones.has(id) && s.start !== null && s.start <= firstWork) continue;
		out.push({
			check: 'no-predecessor',
			severity: 'warning',
			subject: { kind: 'task', id },
			at: taskAt(run, id),
			fixes: [{ kind: 'pick', role: 'predecessor', task: id, disabled: taskReason(run, id) }],
			facts: null,
		});
	}
	return out;
}

export function noSuccessor(run: Run, finish: number | null): FindingOf<'no-successor'>[] {
	const { dependedOn } = listsOf(run);
	const out: FindingOf<'no-successor'>[] = [];
	for (const id of checkedTasks(run)) {
		const s = run.scenarioOf(id);
		if (!s) continue;
		const has = selfAndAncestors(run, id).some(
			(a) => dependedOn.has(a) || (run.scenarioOf(a)?.precedes.length ?? 0) > 0,
		);
		if (has) continue;
		if (run.milestones.has(id) && !run.settings.linkMilestones) continue;
		if (run.milestones.has(id) && s.end !== null && finish !== null && s.end >= finish) continue;
		out.push({
			check: 'no-successor',
			severity: 'warning',
			subject: { kind: 'task', id },
			at: taskAt(run, id),
			fixes: [{ kind: 'pick', role: 'successor', task: id, disabled: taskReason(run, id) }],
			facts: null,
		});
	}
	return out;
}
