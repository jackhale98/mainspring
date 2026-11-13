// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The edit intents the inspector's fields make (phase-2.md 9.3), each with the label of its toast
 * and undo entry. Pure: a field passes what the person typed or picked, and gets the intent to
 * dispatch (`app.edits.dispatch`). The edit API decides whether the value is allowed and writes
 * the minimal text patch; a refusal comes back as a toast with "Show in text".
 *
 * - An empty date, note, scheduling or gap removes the statement (`removeAttr`).
 * - A new `start` or `end` the task did not have is a constraint (`constraint: true`), so the
 *   dispatcher warns once per browser (ADR-0008 #2).
 * - Changing the kind of size rewrites the keyword and the value together (the edit API does it
 *   for a `setAttr` of another sizing keyword, phase-1 15.20).
 * - Lists (`flags`, `responsible`) are sent whole, with the ids the task inherits kept in them:
 *   that is the edit API's rule for a list value.
 */
import type { ToastLabel } from '../gantt/intents';
import { inspectorStrings as S } from '../strings';
import type { EditIntent } from '../tjp/edit/types';
import { printStringPreferring } from '../tjp/values';
import type { GapKind, LinkFact } from './links';
import type { SizeAttr, TaskDetails } from './task';

export interface Edit {
	readonly intent: EditIntent;
	readonly label: ToastLabel;
	/** It adds a `start` or `end` the task did not have. */
	readonly constraint?: boolean;
}

const label = (text: string): ToastLabel => ({ text, approx: false });
const sizeName = (a: SizeAttr): string => S.size[a];

/** The kind or the value of the task's size: `text` is TaskJuggler's own ("5d"). */
export function sizeEdit(d: TaskDetails, attr: SizeAttr, text: string): Edit {
	const was = d.size.kind === 'own' ? d.size : null;
	const to = text.trim();
	const text2 =
		was && was.attr !== attr
			? S.label.kind(d.name, sizeName(was.attr), sizeName(attr))
			: was?.text
				? S.label.change(sizeName(attr), d.name, was.text, to)
				: S.label.set(sizeName(attr), d.name, to);
	return { intent: { type: 'setAttr', task: d.id, attr, value: to }, label: label(text2) };
}

export type DateAttr = 'start' | 'end' | 'minstart' | 'maxend';

export function dateEdit(d: TaskDetails, attr: DateAttr, text: string): Edit {
	const what = S.what[attr];
	const to = text.trim();
	if (to === '') {
		return {
			intent: { type: 'removeAttr', task: d.id, attr },
			label: label(S.label.clear(what, d.name)),
		};
	}
	const was = d[attr];
	const bound = attr === 'start' || attr === 'end';
	return {
		intent: { type: 'setAttr', task: d.id, attr, value: to },
		label: label(
			was.kind === 'own'
				? S.label.change(what, d.name, was.text, to)
				: S.label.set(what, d.name, to),
		),
		...(bound && was.kind === 'unset' ? { constraint: true } : {}),
	};
}

export function schedulingEdit(d: TaskDetails, value: string): Edit {
	const what = S.what.scheduling;
	if (value === '') {
		return {
			intent: { type: 'removeAttr', task: d.id, attr: 'scheduling' },
			label: label(S.label.clear(what, d.name)),
		};
	}
	return {
		intent: { type: 'setAttr', task: d.id, attr: 'scheduling', value },
		label: label(S.label.set(what, d.name, S.scheduling[value === 'alap' ? 'alap' : 'asap'])),
	};
}

/** A whole number field (`priority`, `complete`). */
export function numberEdit(d: TaskDetails, attr: 'priority' | 'complete', n: number): Edit {
	const what = S.what[attr];
	return {
		intent: { type: 'setAttr', task: d.id, attr, value: String(n) },
		label: label(S.label.set(what, d.name, attr === 'complete' ? `${n}%` : String(n))),
	};
}

export function noteEdit(d: TaskDetails, text: string): Edit | null {
	const what = S.what.note;
	if (text.trim() === '') {
		return {
			intent: { type: 'removeAttr', task: d.id, attr: 'note' },
			label: label(S.label.clear(what, d.name)),
		};
	}
	const printed = printStringPreferring(text, 'double');
	if (!printed.ok) return null;
	return {
		intent: { type: 'setAttr', task: d.id, attr: 'note', value: printed.value },
		label: label(S.label.noteChanged(d.name)),
	};
}

export function milestoneEdit(d: TaskDetails, on: boolean): Edit {
	return {
		intent: { type: 'setAttr', task: d.id, attr: 'milestone', value: on },
		label: label(on ? S.label.milestoneOn(d.name) : S.label.milestoneOff(d.name)),
	};
}

/** The whole list of a list attribute: what the task inherits stays in it. */
const whole = (own: readonly string[], inherited: readonly string[]): string[] => [
	...new Set([...inherited, ...own]),
];

export function flagsEdit(d: TaskDetails, flags: readonly string[], change: string): Edit {
	const had = d.flags.own.includes(change);
	const next = flags.filter((f) => !d.flags.inherited.includes(f));
	return {
		intent: { type: 'setAttr', task: d.id, attr: 'flags', value: whole(next, d.flags.inherited) },
		label: label((had ? S.label.flagRemove : S.label.flagAdd)(change, d.name)),
	};
}

export const declareFlagEdit = (flag: string): Edit => ({
	intent: { type: 'declareFlag', flag },
	label: label(S.label.declare(flag)),
});

/** `id` null: nobody. The ids a parent task gives stay (the edit API's rule for lists). */
export function responsibleEdit(d: TaskDetails, id: string | null, name: string): Edit {
	if (id === null) {
		return {
			intent: { type: 'removeAttr', task: d.id, attr: 'responsible' },
			label: label(S.label.noResponsible(d.name)),
		};
	}
	return {
		intent: {
			type: 'setAttr',
			task: d.id,
			attr: 'responsible',
			value: whole([id], d.responsible.inherited),
		},
		label: label(S.label.responsible(name, d.name)),
	};
}

/** A gap of `text` ("2d"; empty for none) on a link, of the kind given. */
export function gapEdit(l: LinkFact, kind: GapKind, text: string): Edit {
	const to = text.trim();
	return {
		intent: {
			type: 'setDependsGap',
			task: l.succ,
			target: l.pred,
			gap: to === '' ? null : { kind, value: to },
		},
		label: label(S.label.gap(l.succName, l.predName, to === '' ? null : to)),
	};
}

export type ProjectField = 'name' | 'start' | 'end' | 'now' | 'timezone';

/** The project sheet's fields; null when the text cannot be written into the plan. */
export function projectEdit(field: ProjectField, text: string): Edit | null {
	const to = text.trim();
	const P = S.label.project;
	switch (field) {
		case 'name':
			return { intent: { type: 'setProjectHeader', name: to }, label: label(P.name(to)) };
		case 'start':
			return { intent: { type: 'setProjectHeader', start: to }, label: label(P.start(to)) };
		case 'end':
			return { intent: { type: 'setProjectHeader', end: to }, label: label(P.end(to)) };
		case 'now':
			return to === ''
				? { intent: { type: 'removeProjectAttr', attr: 'now' }, label: label(P.noNow) }
				: {
						intent: { type: 'setProjectAttr', attr: 'now', value: to },
						label: label(P.now(to)),
					};
		case 'timezone': {
			if (to === '') {
				return {
					intent: { type: 'removeProjectAttr', attr: 'timezone' },
					label: label(P.noTimezone),
				};
			}
			const printed = printStringPreferring(to, 'double');
			return printed.ok
				? {
						intent: { type: 'setProjectAttr', attr: 'timezone', value: printed.value },
						label: label(P.timezone(to)),
					}
				: null;
		}
	}
}
