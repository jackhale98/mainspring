// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The copy of the Calendar and of leave painting (src/components/calendar, src/lib/calendar;
 * phase-3.md 9.5, 7.1 W3 to W5), kept apart from strings.ts so that only the lazy calendar chunk, and
 * the person details' leave list that shares its leave card, fetch it (CLAUDE.md: one strings
 * module per lazily loaded view).
 */

/**
 * Leave painting on the calendar (src/lib/calendar/paint.ts, phase-3.md 6.6, 7.1 W3 and W4): the
 * label of each edit, for its toast and its undo entry. `days` is a display range from `Intl`.
 */
export const leavePaintStrings = {
	type: {
		project: 'Project leave',
		holiday: 'Holiday',
		annual: 'Annual leave',
		special: 'Special leave',
		sick: 'Sick leave',
		unpaid: 'Unpaid leave',
		unemployed: 'Unemployed',
	},
	everyone: 'Everyone',
	/** "A to B", or one day. */
	days: (from: string, to: string) => (from === to ? from : `${from} to ${to}`),
	label: {
		add: (type: string, who: string, days: string) => `${type} for ${who}: ${days}`,
		merge: (type: string, who: string, days: string) => `${type} for ${who} now ${days}`,
		erase: (who: string, days: string) => `Leave cleared for ${who}: ${days}`,
	},
	/** A paint that would change nothing: `type` is the covering leave's name from `type`. */
	covered: (type: string) => `${type} already covers those days. Erase it first.`,
} as const;

/**
 * The Calendar view (src/components/calendar, src/lib/calendar; phase-3.md 9.5, 7.1 W3 to W5, 10):
 * the toolbar, the names of the day cells, the details of the selected days and the sentences of a
 * leave changed or removed. Leave type names and the sentences of a paint are `leavePaintStrings`.
 */
export const calendarStrings = {
	region: 'Calendar',
	toolbar: 'Calendar controls',
	scope: 'Leave for',
	mode: 'Mode',
	modes: { select: 'Select', paint: 'Paint', erase: 'Erase' },
	/** What each mode does, shown beside the toolbar and read out when the mode changes. */
	modeHint: {
		select: 'Select days. L adds leave, Delete clears it.',
		paint: 'Drag across days, or tap one, to add leave.',
		erase: 'Drag across days, or tap one, to clear leave.',
	},
	type: 'Leave type',
	today: 'Today',
	todayOff: 'Today is outside the plan',
	prev: 'Previous month',
	next: 'Next month',
	months: 'Months',
	outside: 'Outside the plan',
	/** The mode and type as they are announced: "Paint: Annual leave". */
	painting: (mode: string, type: string) => `${mode}: ${type}`,
	nonWorking: 'Non-working day',
	holiday: (name: string | null) => (name === null ? 'Holiday' : `Holiday: ${name}`),
	/** A leave on a day: "Annual leave", "Annual leave: Trip". */
	leave: (type: string, name: string | null) => (name === null ? type : `${type}: ${name}`),
	/** A leave that no text item names: it comes from a shift or a macro. */
	textOnly: 'From a shift or macro. Edit as text.',
	milestone: (name: string) => `Milestone: ${name}`,
	selectedTask: (name: string) => `Selected ${name}`,
	/** The line under the months: the selected days. */
	line: {
		none: 'No days selected.',
		days: (days: string, count: number) => (count === 1 ? days : `${days} (${count} days)`),
		lifted: (date: string) => `${date} lifted. Drag across days.`,
	},
	details: {
		region: 'Day details',
		close: 'Close',
		/** "5 days, 4 working days". */
		facts: (days: number, working: number) =>
			`${days === 1 ? '1 day' : `${days} days`}, ${working === 1 ? '1 working day' : `${working} working days`}`,
		holidays: 'Holidays for everyone',
		leaves: (who: string) => `Leave for ${who}`,
		inheritedHeading: 'Leave from groups',
		inherited: (from: string) => `from ${from}`,
		textOnlyHeading: 'From shifts or macros',
		nothing: 'No leave on these days.',
		milestones: 'Milestones',
		showInGantt: 'Show in Gantt',
		add: 'Add leave',
		addFor: (type: string, who: string) => `Add ${type} for ${who}`,
		clear: 'Clear leave on these days',
		name: 'Name',
		namePlaceholder: 'Optional',
		typeLabel: 'Type',
		start: 'First day',
		end: 'Last day',
		remove: 'Remove',
		removeNamed: (what: string) => `Remove ${what}`,
		/** A change made while the last one is being read back; it is sent next. */
		waiting: 'Waiting for the last change, then this one is sent.',
		/** A project leave is read, not written, by the edit API. */
		fixed: 'A project leave. Edit as text.',
		errors: {
			dates: 'The last day cannot be before the first day.',
			range: 'Dates must be between 1970 and 2035.',
			empty: 'Choose a first and a last day.',
		},
	},
	picker: {
		title: 'Leave type',
		hint: 'Arrow keys choose. Enter adds it to the selected days. Escape cancels.',
	},
	/** The undo entries and toasts of a changed or removed leave (a paint's are `leavePaintStrings`). */
	label: {
		change: (type: string, who: string, days: string) => `${type} for ${who} changed: ${days}`,
		removed: (type: string, who: string, days: string) => `${type} for ${who} removed: ${days}`,
	},
	scheduling: 'Scheduling…',
	lastGood: 'Showing the last good schedule',
} as const;
