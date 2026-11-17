// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * H3 "Hard constraint" and H4 "Constraint warning" (phase-3.md section 12; 6.3 rule 1 as amended
 * 2026-11-16: `minstart` and `maxend` are not part of the explainer's bound, they stay here).
 *
 * - **H3** (info): a `start`, `end`, `minstart` or `maxend` written on a task, in the shown
 *   scenario (gantt/grid.ts's rule: the nearest scenario wins, then the last statement). One
 *   finding per written site, on the task that writes it, leaf or container, with `applies`: the
 *   tasks it binds, itself and every descendant that does not write its own (`minstart` and
 *   `maxend` are inherited attributes; TaskScenario#earliestStart (#latestEnd) reads every
 *   ancestor's `start` (`end`)). Descendants get no H3 finding of their own; their "Why here?"
 *   shows the constraint (T10). "Remove" removes it, its label showing the date it held; "Why
 *   here?" opens the explainer on the task that writes it.
 * - **H4** (warning): TaskJuggler's `minstart`, `maxstart`, `minend` and `maxend` warnings in the
 *   shown scenario, one per message, pinned to the line it names (the task's declaration header,
 *   TaskJuggler's `sourceFileInfo`). `days` are working days of the project's calendar between
 *   the task's date and the limit, both read from the message. "Show in text" and "Why here?".
 */
// T11: main-session ruling (2026-11-17), against section 12's "own or inherited": one finding per
// written site, not one per task that inherits it. Fedora writes `start ${start_work}` on its
// root, which bound 246 leaves, each with its own finding before. `applies` counts every task the
// site binds, containers included (they are bound too: #scheduleContainer keeps the date), and a
// descendant's own statement of the same attribute takes its subtree, as the nearest site wins.
import type { EngineMessage, Minutes } from '../../engine/protocol';
import { displayDate } from '../schedule/date-text';
import { nearestSite } from '../schedule/explain-text';
import { healthCheckStrings as S } from '../strings-health';
import type { AttrSite, TaskId, TextOnlyReason } from '../tjp/index';
import { resolveDate } from '../tjp/values';
import {
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
	// The tasks each site binds: every task whose nearest site for the attribute, on itself or an
	// ancestor, is that one (a descendant that writes its own overrides it for its subtree).
	const applies = new Map<string, number>();
	for (const id of run.order) {
		for (const attr of ATTRS) {
			const owner = selfAndAncestors(run, id).find((a) => written.get(a)?.has(attr));
			if (owner === undefined) continue;
			const key = `${attr}\0${owner}`;
			applies.set(key, (applies.get(key) ?? 0) + 1);
		}
	}
	for (const owner of run.order) {
		const mine = written.get(owner);
		if (!mine) continue;
		for (const attr of ATTRS) {
			const w = mine.get(attr);
			if (!w) continue;
			out.push({
				check: 'hard-constraint',
				severity: 'info',
				subject: { kind: 'task', id: owner },
				at: w.site.statement,
				fixes: [
					{
						kind: 'intent',
						label: w.label,
						intent: { type: 'removeAttr', task: owner, attr },
						disabled: w.disabled,
					},
					{ kind: 'why', task: owner, disabled: null },
				],
				facts: { attr, date: w.date, applies: applies.get(`${attr}\0${owner}`) ?? 1 },
			});
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
