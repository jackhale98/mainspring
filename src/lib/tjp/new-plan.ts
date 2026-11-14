// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The text of a new plan (phase-3.md 6.8; ADR-0013 #2): a header and nothing else,
 * `project <id> "<name>" <start> +1y { timezone "<zone>" }`. The engine reports it as `no_tasks`
 * (an empty plan, not an error), and the Add task control writes the first task into it.
 *
 * The id is made from the name by `slugId`, the rule the edit API uses for new ids; a name with
 * no letters or digits gets `plan`. The name goes through `printString`, so a quote in it is
 * escaped, and text that TaskJuggler would expand (`${…}`, `$(…)`) is refused (`unsafe-text`), as
 * the edit API refuses it. The one-year frame is `+1y`: a short frame makes a beginner's tasks
 * run past the end (18.11 (c)). The zone is `null` for "None (UTC)": no timezone line and no
 * braces (TaskJuggler reads a header without a block; the edit API adds one with the first
 * attribute).
 */
import { lastDayOfMonth, printString, slugId } from './values';

export interface NewPlanSpec {
	name: string;
	/** `yyyy-mm-dd`. */
	start: string;
	/** An IANA zone name, or null for none (UTC). */
	timezone: string | null;
}

/** Why a new plan cannot be made from the inputs; the sheet names the field. */
export type NewPlanProblem = 'name-empty' | 'name-unsafe' | 'name-backslash' | 'start' | 'zone';

/** The name as written: runs of white space (and line breaks) become one space, trimmed. */
export const cleanPlanName = (name: string): string => name.replace(/\s+/g, ' ').trim();

/** The project id for a name: its slug, or `plan` when the name has no letter or digit. */
export function planId(name: string): string {
	const readable = /[a-z0-9_]/i.test(cleanPlanName(name).normalize('NFKD'));
	return readable ? slugId(cleanPlanName(name)) : 'plan';
}

function validStart(start: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
	if (!m) return false;
	const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
	return (
		year >= 1970 && month >= 1 && month <= 12 && day >= 1 && day <= lastDayOfMonth(month, year)
	);
}

/** The first problem with the inputs, or null when `newPlanText` will write them. */
export function newPlanProblem(s: NewPlanSpec): NewPlanProblem | null {
	const name = cleanPlanName(s.name);
	if (name === '') return 'name-empty';
	const printed = printString(name);
	if (!printed.ok) return printed.error.code === 'unsafe-text' ? 'name-unsafe' : 'name-backslash';
	if (!validStart(s.start)) return 'start';
	if (s.timezone !== null && !printString(s.timezone).ok) return 'zone';
	return null;
}

/** The files of a new plan. Throws a `RangeError` for inputs `newPlanProblem` names. */
export function newPlanText(s: NewPlanSpec): {
	entry: 'plan.tjp';
	files: Record<'plan.tjp', string>;
} {
	const problem = newPlanProblem(s);
	if (problem !== null) throw new RangeError(`new plan: ${problem}`);
	const name = cleanPlanName(s.name);
	const quoted = printString(name);
	const zone = s.timezone === null ? null : printString(s.timezone);
	if (!quoted.ok || (zone !== null && !zone.ok)) throw new RangeError('new plan: unprintable');
	const head = `project ${planId(name)} ${quoted.value} ${s.start} +1y`;
	const text = zone === null ? `${head}\n` : `${head} {\n  timezone ${zone.value}\n}\n`;
	return { entry: 'plan.tjp', files: { 'plan.tjp': text } };
}
