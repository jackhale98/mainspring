// SPDX-License-Identifier: GPL-2.0-or-later
// The copy of the health panel (src/components/health; phase-3.md 9.7, section 12) and of "Why
// here?" (src/lib/health/why-text.ts), apart from strings.ts so that it loads with the panel and not
// with a first load (CLAUDE.md, user 2026-11-17). What a first load shows (the Health button's name,
// the phone card's row) stays in `strings.health` of strings.ts. The few words the checks
// themselves use (a fix's label, the waiting task's name) are strings-health.ts: the checks run in
// a first load (the count), the panel does not.

/** "1 working day", "2.5 working days". */
const days = (n: number, unit = 'working day'): string => `${n} ${unit}${n === 1 ? '' : 's'}`;
/** Minutes as hours, one decimal at most: "24 hours", "1.5 hours". */
const hours = (min: number): string => {
	const h = Math.round((min / 60) * 10) / 10;
	return `${h} hour${h === 1 ? '' : 's'}`;
};
/** "1 problem", "3 problems". */
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Plan health (src/lib/health, phase-3.md section 12): each check's name and sentence, the fix
 * labels, and the panel. A sentence takes the names and display dates the panel resolves
 * (health/text.ts); TaskJuggler's own message text stays as it is.
 */
export const healthStrings = {
	title: 'Plan health',
	check: {
		'no-predecessor': 'No predecessor',
		'no-successor': 'No successor',
		'hard-constraint': 'Hard constraint',
		'constraint-warning': 'Constraint warning',
		'long-gap': 'Long gap',
		'long-task': 'Long task',
		'held-by-people': 'Held by people',
		'work-without-people': 'Work without its people',
		'resource-warning': 'Resource warning',
	},
	sentence: {
		'no-predecessor': 'Nothing comes before it, so only the project start sets when it starts.',
		'no-successor': 'Nothing comes after it, so no other task waits for it to end.',
		/** `date` is null when the plan writes it with a macro; `applies` counts the tasks it binds. */
		'hard-constraint': (
			attr: 'start' | 'end' | 'minstart' | 'maxend',
			date: string | null,
			applies: number,
		): string => {
			const on = date === null ? '' : ` ${date}`;
			const what = {
				start: `Its start is fixed${date === null ? '' : ` at${on}`}`,
				end: `Its end is fixed${date === null ? '' : ` at${on}`}`,
				minstart: `It may not start before${date === null ? ' a set date' : on}`,
				maxend: `It must end by${date === null ? ' a set date' : on}`,
			}[attr];
			return applies > 1 ? `${what} (applies to ${applies} tasks).` : `${what}.`;
		},
		/** "Starts 3 working days after its latest allowed start." */
		'constraint-warning': (
			limit: 'minstart' | 'maxstart' | 'minend' | 'maxend',
			n: number,
		): string => {
			const by = n > 0 ? ` ${days(n)}` : '';
			return {
				minstart: `Starts${by} before its earliest allowed start.`,
				maxstart: `Starts${by} after its latest allowed start.`,
				minend: `Ends${by} before its earliest allowed end.`,
				maxend: `Ends${by} after its latest allowed end.`,
			}[limit];
		},
		/** `gapduration` counts calendar days, `gaplength` working days. */
		'long-gap': (gap: 'gaplength' | 'gapduration', n: number, pred: string): string =>
			`Waits ${days(n, gap === 'gaplength' ? 'working day' : 'calendar day')} after ${pred}.`,
		'long-task': (n: number): string =>
			`Runs for ${days(n)}. A long task hides how far along it is.`,
		/** "Waits 6 working days for Dev 1 (booked on Build API)." */
		'held-by-people': (n: number, person: string, on: string | null): string =>
			`Waits ${days(n)} for ${person} (${on === null ? 'on leave or off work' : `booked on ${on}`}).`,
		'work-without-people': (person: string, minutes: number): string =>
			`Runs without ${person} for ${hours(minutes)}, while ${person} works on other tasks.`,
		'resource-warning': {
			allocate_no_assigned: (task: string): string =>
				`${task} asked for people but got none. Without an effort, it books them only when they happen to be free.`,
			priority_inversion: (task: string, others: readonly string[]): string =>
				`Tasks with a lower priority took people from ${task}${others.length > 0 ? `: ${others.join(', ')}` : ''}.`,
			overbooked_effort: (task: string): string =>
				`The bookings of ${task} add up to more effort than it asks for.`,
			overbooked_length: (task: string): string =>
				`The bookings of ${task} run longer than its length.`,
			overbooked_duration: (task: string): string =>
				`The bookings of ${task} run longer than its duration.`,
		},
	},
	fix: {
		addPredecessor: 'Add predecessor…',
		addSuccessor: 'Add successor…',
		why: 'Why here?',
		show: 'Show in text',
		replacePerson: 'Replace person…',
		/** "Replace Dev…": the person the fix replaces. */
		replace: (person: string): string => `Replace ${person}…`,
		openWorkload: 'Open in Workload',
		openCalendar: 'Open in Calendar',
	},
	/** Shown for a task the message names that the plan no longer has. */
	unknownTask: 'A task',
	/** The panel (components/health): headings, filters, counts, states and the settings. */
	panel: {
		/** The summary line over the list: "241 problems in 5 checks". */
		summary: (n: number, checks: number): string =>
			`${plural(n, 'problem')} in ${plural(checks, 'check')}`,
		empty: 'No problems found.',
		noTasks: 'Nothing to check yet.',
		computing: 'Checking the plan…',
		dimmed:
			'The plan changed and is being scheduled. These findings are from the last good schedule.',
		failed: 'The plan could not be checked.',
		severity: 'Severity',
		severityAll: 'All',
		severityName: { error: 'Errors', warning: 'Warnings', info: 'Notes' },
		/** One finding's severity as words (a glyph is never the only signal). */
		severityWord: { error: 'Error', warning: 'Warning', info: 'Note' },
		none: 'No findings of this severity.',
		/** A group heading: the check's name and how many findings it has. */
		group: (name: string, n: number): string => `${name}, ${n}`,
		findings: 'Findings',
		/** The row's task: a button that selects it. */
		selectTask: (name: string): string => `Select ${name}`,
		/** A finding about a link: the task that waits, and what it waits for. */
		link: (pred: string, succ: string): string => `${succ}, waiting for ${pred}`,
		/** A finding from TaskJuggler's own messages that names no task. */
		message: 'A message from the scheduler',
		fixes: 'Fixes',
		/** A fix the plan's text does not let the panel make, with the way to the text. */
		fixOff: 'Cannot be changed here.',
		pickGone: 'This task can only be changed in the text.',
		/** The gap editor of "Edit gap". */
		gap: {
			label: 'Gap',
			hint: 'For example 5d or 2w. Leave it empty to remove the gap.',
			apply: 'Set gap',
			cancel: 'Cancel',
		},
		showInGantt: 'Show in Gantt',
		showInGanttFor: (person: string): string => `Show ${person} in Gantt`,
	},
	settings: {
		title: 'Health settings',
		back: 'Back to findings',
		thresholds: 'Thresholds',
		checks: 'Checks',
		longGapDays: 'Long gap, in working days',
		longTaskDays: 'Long task, in working days',
		longGapHint: 'A link that waits for more than this many days is a long gap.',
		longTaskHint: 'A task that spans more than this many working days is a long task.',
		invalid: 'Enter a whole number of days from 1 to 3650.',
		decrease: (what: string): string => `Fewer days: ${what}`,
		increase: (what: string): string => `More days: ${what}`,
		linkMilestones: 'Check milestones for predecessors and successors',
		linkMilestonesHint:
			'Off by default: key dates such as a release are often left unlinked on purpose.',
		enabled: (check: string): string => `Check for ${check.toLowerCase()}`,
		reset: 'Reset to defaults',
		saved: 'Kept for this plan on this device.',
	},
} as const;

/**
 * "Why here?" (phase-3.md 9.7; src/lib/health/why-text.ts): what the explainer reads from the
 * schedule, in sentences. It names what the schedule shows and never says "would have started"
 * (6.3 rule 5); where the explainer cannot tell, it says so.
 */
export const whyStrings = {
	title: 'Why here?',
	/** The lead-in of the list: the anchor the causes are about. */
	starts: 'Why it starts here',
	ends: 'Why it ends here',
	inside: 'Inside the bar',
	loading: 'Working it out…',
	failed: 'This could not be worked out.',
	/** The cell details' toggle, named by its task. */
	toggle: (task: string): string => `Why here? ${task}`,
	hide: 'Hide',
	/** The sentence of one cause. Dates are display dates in the plan's zone. */
	cause: {
		/** "Waits for Design (ends Tue 3 Mar)." */
		dependency: (name: string, edge: 'start' | 'end', date: string | null, gap: boolean): string =>
			`Waits for ${name}${date === null ? '' : ` (${edge === 'end' ? 'ends' : 'starts'} ${date})`}${gap ? ', then a gap' : ''}.`,
		/** ALAP: the task is placed as late as the tasks after it allow. */
		dependencyAlap: (
			name: string,
			edge: 'start' | 'end',
			date: string | null,
			gap: boolean,
		): string =>
			`Has to be done before ${name} ${edge === 'end' ? 'ends' : 'starts'}${date === null ? '' : ` (${date})`}${gap ? ', allowing a gap' : ''}.`,
		/** Nothing in the plan bounds it but the project's own start or end. */
		frame: 'No dependency or date sets this. The project start is the limit.',
		frameEnd: 'No dependency or date sets this. The project end is the limit.',
		/** "“start 23 Mar 2026” is written on this task (a constraint)." */
		constraint: (attr: 'start' | 'end', date: string | null, where: string | null): string =>
			`${date === null ? `A ${attr}` : `“${attr} ${date}”`} is written ${where === null ? 'on this task' : `on ${where}, which contains this task`} (a constraint).`,
		/** When the person was booked, but the explainer names no task. */
		elsewhere: 'other tasks',
		/** "Dev 1 is booked on Build API, Wed 4 Mar to Fri 13 Mar (64 h)." */
		busy: (person: string, on: string, window: string, hours: string): string =>
			`${person} is booked on ${on}, ${window}${hours === '' ? '' : ` (${hours})`}.`,
		/** "Dev 1 is on annual leave, Mon 16 to Fri 20 Mar." */
		leave: (person: string | null, type: string, window: string): string =>
			`${person ?? 'The project'} is on ${type}, ${window}.`,
		/** Outside the working hours: a person's, or the project's. */
		offHours: (person: string | null, window: string): string =>
			person === null
				? `Outside the project's working hours, ${window}.`
				: `${person} is off work (outside their working hours), ${window}.`,
		/** "A “limits” statement on Dev 1 may hold it." */
		limit: (where: string | null): string =>
			`A “limits” statement${where === null ? '' : ` on ${where}`} may hold it.`,
		thisTask: 'this task',
		unknown: 'The schedule does not show why.',
	},
	/** "annual leave", for each engine leave type. */
	leaveType: {
		project: 'project leave',
		annual: 'annual leave',
		special: 'special leave',
		sick: 'sick leave',
		unpaid: 'unpaid leave',
		holiday: 'holiday',
		unemployed: 'unemployed leave',
	},
	/** "64 h" and "2 other tasks". */
	hours: (h: number): string => `${h} h`,
	otherTasks: (n: number): string => `${n} other task${n === 1 ? '' : 's'}`,
	/** The links of a cause. */
	link: {
		task: (name: string): string => `Select ${name}`,
		person: (person: string): string => `Open ${person} in Workload`,
		text: 'Show in text',
	},
} as const;
