// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The rest of the project sheet's edits (phase-3.md 9.6, phase-2.md 19.9): the working day
 * (`dailyworkinghours`), the first day of the week (`weekstartsmonday`), `timeformat` and
 * `currency`, each as the intent the edit API takes and the label of its toast and undo entry. Pure,
 * like lib/inspector/edit.ts, which holds the first fields (name, frame, status date, time zone);
 * these are kept apart so that the lazy project sheet is the only importer.
 *
 * - An empty field removes the statement (`removeProjectAttr`), which gives TaskJuggler's default.
 * - `dailyworkinghours` is a number above zero (TaskJuggler divides by it: the edit API refuses
 *   zero), written as typed; a stepper sends the value it reaches, in hundredths.
 * - `weekstartsmonday` is a boolean: `true` writes `weekstartsmonday`, `false` `weekstartssunday`.
 * - `timeformat` and `currency` are strings, printed with the values printer (`unsafe-text` rules
 *   apply in the edit API).
 */
import type { Edit } from '../inspector/edit';
import { projectLabelStrings as P } from '../strings-resources';
import { printStringPreferring } from '../tjp/values';
import { numberText, parseAmount } from './person-edit';

const label = (text: string): Edit['label'] => ({ text, approx: false });

/** The working day in hours, typed: empty clears it; null when it is not a number above zero. */
export function dailyHoursEdit(typed: string): Edit | null {
	const t = typed.trim();
	if (t === '') {
		return {
			intent: { type: 'removeProjectAttr', attr: 'dailyworkinghours' },
			label: label(P.noDailyHours),
		};
	}
	const n = parseAmount(t);
	if (n === null || n <= 0) return null;
	return {
		intent: { type: 'setProjectAttr', attr: 'dailyworkinghours', value: t },
		label: label(P.dailyHours(t)),
	};
}

/** A stepper's value for the working day, rounded to hundredths. */
export function dailyHoursStep(n: number): Edit {
	const text = numberText(Math.max(0.25, n));
	return {
		intent: { type: 'setProjectAttr', attr: 'dailyworkinghours', value: text },
		label: label(P.dailyHours(text)),
	};
}

export const weekStartEdit = (monday: boolean): Edit => ({
	intent: { type: 'setProjectAttr', attr: 'weekstartsmonday', value: monday },
	label: label(P.weekStart(monday)),
});

/** `timeformat` or `currency` as typed: empty clears it; null when it cannot be written as text. */
export function textSettingEdit(attr: 'timeformat' | 'currency', typed: string): Edit | null {
	const t = typed.trim();
	if (t === '') {
		return {
			intent: { type: 'removeProjectAttr', attr },
			label: label(attr === 'timeformat' ? P.noTimeformat : P.noCurrency),
		};
	}
	const printed = printStringPreferring(t, 'double');
	if (!printed.ok) return null;
	return {
		intent: { type: 'setProjectAttr', attr, value: printed.value },
		label: label(attr === 'timeformat' ? P.timeformat(t) : P.currency(t)),
	};
}
