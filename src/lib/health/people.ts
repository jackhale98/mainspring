// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * H7 "Held by people", H8 "Work without its people" and H9 "TaskJuggler resource warnings"
 * (phase-3.md section 12, 5.4; ADR-0014 #3, #6). H7 and H8 read `DemandMarks` (demand.ts, T10)
 * and nothing else about who held what: where T10 marks nothing (a task under `limits` or
 * `shifts`, a wait it reads as `unknown`), there is no finding, so a check never claims what the
 * explainer refused to.
 *
 * - **H7**: one finding per task and person held. `days`: working days of the project's calendar
 *   in the held windows; `on`: the other task the person was booked on for most of those windows
 *   (null when they were only on leave or off). Fixes: "Replace person…", "Open in Workload" at
 *   the first window, "Why here?".
 * - **H8**: one finding per task and person unmet. `minutes`: the windows intersected with the
 *   person's working time, as the load model counts them. Fixes: "Replace person…", "Open in
 *   Workload".
 * - **H9**: one finding per `allocate_no_assigned`, `priority_inversion` (its info lines' tasks
 *   in `tasks`) and `overbooked_*` warning of the shown scenario, pinned to the task the message
 *   names. Fixes: "Show in text"; and "Replace person…" for `allocate_no_assigned`, once per
 *   resource the task asked for.
 */
// T11: "Replace person…" names the resource as the task's `allocate` writes it: a group when the
// held person is one of its members (replaceAllocation edits written items; a member is not one).
// T11: H7's tie between two tasks booked for the same minutes goes to the earlier in task order.
import type { Minutes } from '../../engine/protocol';
import type { DemandEntry, DemandMarks } from '../schedule/explain-types';
import type { ResourceId, TaskId } from '../tjp/index';
import { minutesIn } from '../workload/intervals';
import type { Availability } from '../workload/types';
import {
	leavesOf,
	replaceReason,
	roundDays,
	taskAt,
	workingDays,
	writtenCandidate,
	type Run,
} from './common';
import { inScenario, inversionTasks, messageTask, RESOURCE_WARNINGS } from './messages';
import type { Fix, FindingOf, ResourceWarningId } from './types';

type Windows = Array<readonly [Minutes, Minutes]>;

/** Entries grouped per task then person, in task order, then the order of `marks`. */
function byTask(run: Run, marks: DemandMarks['held']): Array<[TaskId, ResourceId, Windows]> {
	const rank = new Map(run.order.map((id, i) => [id, i]));
	const groups = new Map<string, [TaskId, ResourceId, Windows]>();
	for (const [person, entries] of marks) {
		for (const e of entries as readonly DemandEntry[]) {
			const key = `${e.task}\0${person}`;
			let g = groups.get(key);
			if (!g) groups.set(key, (g = [e.task, person, []]));
			g[2].push(e.window);
		}
	}
	return [...groups.values()].sort((a, b) => (rank.get(a[0]) ?? 0) - (rank.get(b[0]) ?? 0));
}

function replace(
	run: Run,
	task: TaskId,
	person: ResourceId,
	leaves: (id: ResourceId) => ResourceId[],
): Fix {
	const s = run.scenarioOf(task);
	const from = s ? writtenCandidate(s, person, leaves) : person;
	return { kind: 'replace-person', task, from, disabled: replaceReason(run, task, from) };
}

export function heldByPeople(
	run: Run,
	demand: DemandMarks,
	availability: Availability,
): FindingOf<'held-by-people'>[] {
	const leaves = leavesOf(run.result);
	const out: FindingOf<'held-by-people'>[] = [];
	for (const [task, person, windows] of byTask(run, demand.held)) {
		let days = 0;
		for (const [a, b] of windows) days += workingDays(run, a, b);
		let on: TaskId | null = null;
		let most = 0;
		for (const t of availability.people.get(person)?.tasks ?? []) {
			if (t.task === task) continue;
			let m = 0;
			for (const [a, b] of windows) m += minutesIn(t.intervals, a, b);
			if (m > most) [on, most] = [t.task, m];
		}
		const first = windows[0]?.[0] ?? 0;
		out.push({
			check: 'held-by-people',
			severity: 'warning',
			subject: { kind: 'task', id: task },
			at: taskAt(run, task),
			fixes: [
				replace(run, task, person, leaves),
				{ kind: 'open', view: 'workload', resource: person, at: first, disabled: null },
				{ kind: 'why', task, disabled: null },
			],
			facts: { resource: person, days: roundDays(days), on },
		});
	}
	return out;
}

export function workWithoutPeople(
	run: Run,
	demand: DemandMarks,
	availability: Availability,
): FindingOf<'work-without-people'>[] {
	const leaves = leavesOf(run.result);
	const out: FindingOf<'work-without-people'>[] = [];
	for (const [task, person, windows] of byTask(run, demand.unmet)) {
		const working = availability.people.get(person)?.working ?? [];
		let minutes = 0;
		for (const [a, b] of windows) minutes += minutesIn(working, a, b);
		const first = windows[0]?.[0] ?? 0;
		out.push({
			check: 'work-without-people',
			severity: 'warning',
			subject: { kind: 'task', id: task },
			at: taskAt(run, task),
			fixes: [
				replace(run, task, person, leaves),
				{ kind: 'open', view: 'workload', resource: person, at: first, disabled: null },
			],
			facts: { resource: person, minutes },
		});
	}
	return out;
}

const isWarning = (id: string): id is ResourceWarningId =>
	(RESOURCE_WARNINGS as readonly string[]).includes(id);

export function resourceWarnings(run: Run): FindingOf<'resource-warning'>[] {
	const out: FindingOf<'resource-warning'>[] = [];
	const known = new Set<TaskId>(run.order);
	const messages = run.result.messages;
	messages.forEach((m, index) => {
		if (!isWarning(m.id) || m.level !== 'warning' || !inScenario(m, run.scenario)) return;
		const task = messageTask(m, known);
		const fixes: Fix[] = [{ kind: 'show', disabled: null }];
		if (m.id === 'allocate_no_assigned' && task !== null) {
			const s = run.scenarioOf(task);
			const asked = new Set<ResourceId>();
			for (const item of s?.allocate ?? []) for (const c of item.candidates) asked.add(c);
			for (const from of asked) {
				fixes.push({
					kind: 'replace-person',
					task,
					from,
					disabled: replaceReason(run, task, from),
				});
			}
		}
		out.push({
			check: 'resource-warning',
			severity: 'warning',
			subject: { kind: 'message', index },
			at: task === null ? null : taskAt(run, task),
			fixes,
			facts: {
				message: m.id,
				text: m.text,
				tasks: m.id === 'priority_inversion' ? inversionTasks(messages, index, known) : [],
				task,
			},
		});
	});
	return out;
}
