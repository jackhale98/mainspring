// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * A finding in words (phase-3.md section 12, 6.4): its check's name, its sentence from
 * `healthStrings` with the names of the tasks and people it is about, and each fix's label. For
 * the health panel (T18) and the evidence run. Names come from the text first (the index), then
 * the result; dates are shown with `Intl` in the plan's zone (date-text.ts `displayDate`).
 */
import type { ScheduleResult } from '../../engine/protocol';
import { displayDate } from '../schedule/date-text';
import { healthStrings as S } from '../strings-health';
import type { ResourceId, SymbolIndex, TaskId } from '../tjp/index';
import type { Finding, Fix } from './types';

export interface TextContext {
	readonly index: SymbolIndex;
	readonly result: ScheduleResult;
	/** BCP 47 tag; undefined means the viewer's own. */
	readonly locale?: string;
}

export function taskName(c: TextContext, id: TaskId | null): string {
	if (id === null) return S.unknownTask;
	return c.index.tasks.get(id)?.name ?? c.result.tasks.find((t) => t.id === id)?.name ?? id;
}

export function personName(c: TextContext, id: ResourceId): string {
	return c.index.resources.get(id)?.name ?? c.result.resources.find((r) => r.id === id)?.name ?? id;
}

/** The finding's sentence. */
export function sentenceOf(f: Finding, c: TextContext): string {
	switch (f.check) {
		case 'no-predecessor':
		case 'no-successor':
			return S.sentence[f.check];
		case 'hard-constraint': {
			const { attr, date, applies } = f.facts;
			const end = attr === 'end' || attr === 'maxend';
			const shown =
				date === null || !c.result.project
					? null
					: displayDate(date, c.result.project, { end, locale: c.locale });
			return S.sentence[f.check](attr, shown, applies);
		}
		case 'constraint-warning':
			return S.sentence[f.check](f.facts.limit, f.facts.days);
		case 'long-gap':
			return f.subject.kind === 'link'
				? S.sentence[f.check](f.facts.gap, f.facts.days, taskName(c, f.subject.pred))
				: '';
		case 'long-task':
			return S.sentence[f.check](f.facts.days);
		case 'held-by-people': {
			const { days, resource, on } = f.facts;
			return S.sentence[f.check](
				days,
				personName(c, resource),
				on === null ? null : taskName(c, on),
			);
		}
		case 'work-without-people':
			return S.sentence[f.check](personName(c, f.facts.resource), f.facts.minutes);
		case 'resource-warning': {
			const { message, task, tasks } = f.facts;
			const name = taskName(c, task);
			return message === 'priority_inversion'
				? S.sentence[f.check][message](
						name,
						tasks.map((t) => taskName(c, t)),
					)
				: S.sentence[f.check][message](name);
		}
	}
}

/** A fix's label. */
export function fixLabel(x: Fix, c: TextContext): string {
	switch (x.kind) {
		case 'intent':
			return x.label;
		case 'pick':
			return x.role === 'predecessor' ? S.fix.addPredecessor : S.fix.addSuccessor;
		case 'replace-person':
			return S.fix.replace(personName(c, x.from));
		case 'open':
			return x.view === 'workload' ? S.fix.openWorkload : S.fix.openCalendar;
		case 'why':
			return S.fix.why;
		case 'show':
			return S.fix.show;
	}
}

/** The subject task of a finding (for a link, the successor), or null for a message. */
export function subjectTask(f: Finding): TaskId | null {
	if (f.subject.kind === 'task') return f.subject.id;
	if (f.subject.kind === 'link') return f.subject.succ;
	if (f.check === 'constraint-warning' || f.check === 'resource-warning') return f.facts.task;
	return null;
}
