// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The copy of the workload heatmap and of rebalancing (src/components/workload, src/lib/workload;
 * phase-3.md 9.3, 7.1 W1 and W2), kept apart from strings.ts so that only the lazy heatmap and lanes
 * chunk fetches it (CLAUDE.md: one strings module per lazily loaded view).
 */

/**
 * Rebalancing from the heatmap and the lanes (src/lib/workload/rebalance.ts, phase-3.md 6.6, 7.1
 * W1 and W2, 18.9): the label of a move to another person, and why a move is not possible. A move
 * to another week is a Gantt move, labelled by `ganttActionStrings`.
 */
export const rebalanceStrings = {
	label: {
		reassign: (task: string, from: string, to: string) => `Moved ${task} from ${from} to ${to}`,
		/** `to` already works on the task, so the edit only takes `from` off it. */
		already: (to: string, task: string, from: string) =>
			`${to} already works on ${task}; ${from} removed`,
	},
	notPossible: {
		'via-group': (group: string) =>
			`Booked through ${group}. Change the task's people in its details.`,
		'not-a-person': 'Work moves to a person, not to a group.',
		'not-booked': 'This person does not work on this task.',
		'same-place': 'The task is already there.',
		/** The target bucket of a week move has no working day (`unit` is the zoom's bucket). */
		'no-working-day': (unit: 'day' | 'week' | 'month') =>
			unit === 'day' ? 'No working time on that day.' : `No working days in that ${unit}.`,
	},
	/** "Move which task?" (18.9): a drop on a cell with several movable tasks. */
	which: 'Move which task?',
} as const;

/**
 * The workload heatmap (src/components/workload, phase-3.md 9.3, 10, 7.1 W1 and W2): the toolbar,
 * the cells' words and accessible names, the cell details and the rebalance messages. Hours are
 * booked time (18.2); a cell says its band in words as well as colour (WCAG 1.4.1).
 */
export const workloadStrings = {
	region: 'Workload',
	toolbar: 'Workload controls',
	/** The ARIA mirror of the canvas (a grid). */
	grid: 'Workload by person and period',
	zoom: 'Zoom',
	level: { day: 'Day', week: 'Week', month: 'Month' },
	unit: 'Unit',
	unitHours: 'Hours',
	unitPercent: '%',
	unitHint: { hours: 'Show hours booked', percent: 'Show percent of available time' },
	today: 'Today',
	todayOff: 'Today is outside the plan',
	thresholds: 'Thresholds',
	thresholdsTitle: 'When a cell is spare, full or over',
	spareBelow: 'Spare below',
	overAbove: 'Over above',
	thresholdsReset: 'Reset to 80 and 100',
	thresholdsNote: 'A cell is also over when work is held or unmet. Saved with this plan.',
	thresholdsError: 'Spare must be below over, both between 1 and 500.',
	legend: 'Legend',
	/** What puts a cell in a band, beside its swatch in the thresholds panel. */
	rule: {
		spare: (below: number) => `below ${below}% of available time`,
		full: (from: number, to: number) => `${from}% to ${to}%`,
		over: (above: number) => `above ${above}%, or work is held or unmet`,
		off: 'nothing available to book',
		leave: 'working time lost to leave',
	},
	band: { off: 'No working time', spare: 'Spare', full: 'Full', over: 'Over' },
	legendLeave: 'Leave',
	legendLines: 'Lines',
	legendToday: 'Today',
	legendStatus: 'Status date',
	legendBoth: 'Today (status date)',
	people: 'People',
	scheduling: 'Scheduling…',
	lastGood: 'Showing the last good schedule',
	expand: (name: string) => `Expand ${name}`,
	collapse: (name: string) => `Collapse ${name}`,
	hours: (n: string) => `${n}h`,
	percent: (n: number) => `${n}%`,
	/** A cell with no working time. */
	off: '–',
	periodWeek: (date: string) => `week of ${date}`,
	/** "Dev 1, week of 9 March: 38 of 40 hours, full". */
	cell: {
		off: (who: string, period: string) => `${who}, ${period}: no working time`,
		load: (who: string, period: string, booked: string, available: string, band: string) =>
			`${who}, ${period}: ${booked} of ${available} hours, ${band}`,
		band: { off: 'no working time', spare: 'spare', full: 'full', over: 'over' },
		percent: (n: number) => `${n}% of available time`,
		leave: (hours: string) => `${hours} hours of leave`,
		waits: (n: number) => (n === 1 ? '1 task waits' : `${n} tasks wait`),
		runsWithout: (n: number) =>
			n === 1 ? '1 task runs without them' : `${n} tasks run without them`,
		overBooked: 'booked above available time',
		overThreshold: (pct: number, limit: number) => `${pct}% is above ${limit}%`,
	},
	/** A grid row has no level or state of its own: the row header says them. */
	rowHeader: {
		member: (name: string, group: string) => `${name}, in ${group}`,
		group: (name: string, expanded: boolean) =>
			`${name}, group, ${expanded ? 'expanded' : 'collapsed'}`,
	},
	nav: { hint: 'Arrow keys move between cells. Enter opens the details. T goes to today.' },
	details: {
		region: 'Cell details',
		close: 'Close',
		booked: 'Booked',
		available: 'Available',
		effective: 'Effective effort',
		leave: 'Leave',
		band: 'Band',
		hoursValue: (n: string) => `${n} h`,
		why: {
			booked: 'Booked time is above available time.',
			threshold: (pct: number, limit: number) =>
				`Booked time is ${pct}% of available time, above ${limit}%.`,
			held: (n: number, who: string) =>
				n === 1 ? `1 task waits for ${who}.` : `${n} tasks wait for ${who}.`,
			unmet: (n: number, who: string) =>
				n === 1 ? `1 task runs without ${who}.` : `${n} tasks run without ${who}.`,
		},
		noWorkingTime: 'No working time in this period.',
		spareWhy: (pct: number, limit: number) => `${pct}% of available time, below ${limit}%.`,
		fullWhy: (pct: number) => `${pct}% of available time.`,
		kind: {
			booked: 'Booked',
			held: (who: string) => `Waiting for ${who}`,
			unmet: (who: string) => `Running without ${who}`,
		},
		kindNote:
			'Waiting and running-without tasks are read from the schedule; their hours are about.',
		noTasks: 'No tasks in this period.',
		taskEffective: (n: string) => `${n} h effective`,
		movePerson: 'Move to person…',
		moveWeek: 'Move to week…',
		showInGantt: 'Show in Gantt',
		moveHint: 'Alt and the arrow keys move a task: up and down by person, left and right by week.',
		group: 'A group sums its members. Open a person to move their tasks.',
	},
	rebalance: {
		dropOnPerson: 'Drop on a person',
		dropOnGroup: 'Drop on a person, not a group',
		toPerson: (name: string) => `To ${name}`,
		toPeriod: (period: string) => `To ${period}`,
		sameCell: 'Same place',
		lifted: (name: string) => `${name} lifted. Drag to a person or a week.`,
		whichLead: 'This cell has several tasks that can move. Choose one.',
		cancelled: 'Move cancelled.',
		cancel: 'Cancel',
	},
} as const;
