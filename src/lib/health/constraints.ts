// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * H3 "Hard constraint" and H4 "Constraint warning" (phase-3.md section 12; 6.3 rule 1 as amended
 * 2026-11-16: `minstart` and `maxend` are not part of the explainer's bound, they stay here).
 *
 * - **H3** (info): a `start`, `end`, `minstart` or `maxend` written on the task or an ancestor, in
 *   the shown scenario (gantt/grid.ts's rule: the nearest scenario wins, then the last statement).
 *   One finding per task and attribute, for the nearest site: `minstart` and `maxend` are inherited
 *   attributes, and TaskScenario#earliestStart (#latestEnd) reads every ancestor's `start`
 *   (`end`), the nearest of which the text shows. "Remove" removes it where it is written, and its
 *   label shows the date it held; "Why here?" opens the explainer.
 * - **H4** (warning): TaskJuggler's `minstart`, `maxstart`, `minend` and `maxend` warnings in the
 *   shown scenario, one per message, pinned to the line it names (the task's declaration header,
 *   TaskJuggler's `sourceFileInfo`). `days` are working days of the project's calendar between
 *   the task's date and the limit, both read from the message. "Show in text" and "Why here?".
 */
// T11: H3 counts a `start` or `end` inherited from an ancestor although Fedora writes
// `start ${start_work}` on its root, so every Fedora leaf has one: section 12 says "own or
// inherited", and each of them bounds the leaf (TaskScenario#earliestStart). They are info.
import type { EngineMessage, Minutes } from '../../engine/protocol';
import { displayDate } from '../schedule/date-text';
import { nearestSite } from '../schedule/explain-text';
import { healthStrings as S } from '../strings';
import type { AttrSite, TaskId, TextOnlyReason } from '../tjp/index';
import { resolveDate } from '../tjp/values';
import {
	checkedTasks,
	firstReason,
	roundDays,
	selfAndAncestors,
	siteReason,
	taskAt,
	taskReason,
	workingDays,
	type Run,
} from './common';
import { inScenario, LIMITS, messageTask, warningDates, type LimitId } from './messages';
import type { CheckFacts, FindingOf } from './types';

type Attr = CheckFacts['hard-constraint']['attr'];
const ATTRS: readonly Attr[] = ['start', 'end', 'minstart', 'maxend'];

interface Written {
	readonly site: AttrSite;
	readonly date: Minutes | null;
	readonly label: string;
	readonly disabled: TextOnlyReason | null;
}

export function hardConstraints(run: Run): FindingOf<'hard-constraint'>[] {
	const out: FindingOf<'hard-constraint'>[] = [];
	const startEpoch = Date.parse(run.project.start) / 1000;
	// One read per declaration that writes any of the four: its site per attribute, the date and
	// the disabled reason. Most declarations write none and cost one scan of their attributes.
	const written = new Map<TaskId, ReadonlyMap<Attr, Written>>();
	for (const [owner, sym] of run.index.tasks) {
		if (!sym.attrs.some((a) => (ATTRS as readonly string[]).includes(a.keyword))) continue;
		const mine = new Map<Attr, Written>();
		for (const attr of ATTRS) {
			const site = nearestSite(sym.attrs, new Set([attr]), run.chain);
			if (!site) continue;
			let date: number | null = null;
			if (!site.textOnly && site.parsed?.kind === 'date') {
				const where = run.index.contextAt(site.statement.file, site.statement.from);
				const v = resolveDate(site.parsed.value, where);
				if (v.ok) date = Math.round((v.value - startEpoch) / 60);
			}
			const end = attr === 'end' || attr === 'maxend';
			mine.set(attr, {
				site,
				date,
				label: S.fix.remove(attr, date === null ? null : displayDate(date, run.project, { end })),
				disabled: firstReason(taskReason(run, owner), siteReason(run, site, site.statement)),
			});
		}
		if (mine.size > 0) written.set(owner, mine);
	}
	if (written.size === 0) return out;
	const writtenOn = (owner: TaskId, attr: Attr): Written | null =>
		written.get(owner)?.get(attr) ?? null;
	for (const id of checkedTasks(run)) {
		for (const attr of ATTRS) {
			for (const owner of selfAndAncestors(run, id)) {
				const w = writtenOn(owner, attr);
				if (!w) continue;
				const { site, date } = w;
				out.push({
					check: 'hard-constraint',
					severity: 'info',
					subject: { kind: 'task', id },
					at: site.statement,
					fixes: [
						{
							kind: 'intent',
							label: w.label,
							intent: { type: 'removeAttr', task: owner, attr },
							disabled: w.disabled,
						},
						{ kind: 'why', task: id, disabled: null },
					],
					facts: { attr, date, from: owner === id ? null : owner },
				});
				break;
			}
		}
	}
	return out;
}

const isLimit = (id: string): id is LimitId => (LIMITS as readonly string[]).includes(id);

export function constraintWarnings(run: Run): FindingOf<'constraint-warning'>[] {
	const out: FindingOf<'constraint-warning'>[] = [];
	const known = new Set<TaskId>(run.order);
	run.result.messages.forEach((m: EngineMessage, index) => {
		if (!isLimit(m.id) || m.level !== 'warning' || !inScenario(m, run.scenario)) return;
		const task = messageTask(m, known);
		const dates = warningDates(m, run.result);
		const days = dates ? roundDays(workingDays(run, dates.limit, dates.date)) : 0;
		out.push({
			check: 'constraint-warning',
			severity: 'warning',
			subject: { kind: 'message', index },
			at: task === null ? null : taskAt(run, task),
			fixes: [
				{ kind: 'show', disabled: null },
				...(task === null ? [] : [{ kind: 'why' as const, task, disabled: null }]),
			],
			facts: { limit: m.id, days, text: m.text, task },
		});
	});
	return out;
}
