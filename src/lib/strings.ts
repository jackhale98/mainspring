// SPDX-License-Identifier: GPL-2.0-or-later
// All user-facing copy lives in this file (CLAUDE.md conventions). It passes 400 lines on purpose:
// CLAUDE.md asks for one strings file, and phase-2.md section 4 keeps it whole.
import type { EngineErrorKind } from '../engine/protocol';
import type { IntentType, RefusalReason } from './tjp/edit/types';
import type { ValueErrorCode } from './tjp/values/result';

/**
 * Diagnostics the document layer finds itself (src/lib/tjp/diagnostics*.ts). Engine messages
 * keep TaskJuggler's own text.
 */
export const diagnosticStrings = {
	syntax: {
		/** `cut` when the token was shortened for the message. */
		unexpected: (token: string, cut = false) => `Unexpected “${token}${cut ? '…' : ''}”.`,
		unexpectedHere: 'Unexpected text here.',
		unterminated: 'This string, comment or macro is not closed.',
		unexpectedEnd: 'The file ends too early. A closing } may be missing.',
		extraBrace: 'This } has no matching {.',
	},
	/** One plain sentence per typed-value error code (src/lib/tjp/values/result.ts). */
	value: {
		'unexpected-token': 'This value is not valid here.',
		'unexpected-end': 'A value is missing.',
		'trailing-text': 'Unexpected text after the value.',
		'macro-call': 'This value uses a macro.',
		'env-var': 'This value uses an environment variable.',
		unterminated: 'This string is not closed.',
		'junk-after-cut': 'The cut mark -8<- must end its line.',
		'bad-unit': 'This unit is not allowed here.',
		'number-range': 'This number is out of range.',
		'number-too-large': 'This number is too large.',
		'zero-duration': 'A duration must be greater than zero.',
		'duration-not-aligned': 'This duration does not fit the timing resolution.',
		'duration-too-small': 'This duration is shorter than the timing resolution.',
		'year-range': 'The year must be between 1970 and 2035.',
		'month-range': 'The month must be between 1 and 12.',
		'day-range': 'This day does not exist in that month.',
		'hour-range': 'The hour must be between 0 and 23.',
		'minute-range': 'The minutes must be between 0 and 59.',
		'second-range': 'The seconds must be between 0 and 59.',
		'zone-sign': 'A time zone offset needs a + or - sign.',
		'zone-format': 'Write the time zone offset as +hhmm or -hhmm.',
		'zone-range': 'The time zone offset is out of range.',
		'time-range': 'This time of day is not valid.',
		'time-interval': 'The end time must be after the start time.',
		'misaligned-date': 'This date does not fit the timing resolution.',
		'start-before-end': 'The end must be after the start.',
		'out-of-project': 'This date is outside the project time frame.',
		'zone-data': 'Time zone data is not available yet.',
		'bad-zone': 'Unknown time zone.',
		'not-an-id': 'This is not a valid id.',
		'too-many-bangs': "Too many '!' for a relative task id here.",
		'unsafe-text': 'This text cannot be written safely.',
		unrepresentable: 'This value cannot be written in TaskJuggler syntax.',
	} satisfies Record<ValueErrorCode, string>,
	undeclaredAttribute: (name: string) =>
		`${name} is not a custom attribute. Declare it with extend first.`,
	didYouMean: (keyword: string) => `Did you mean ${keyword}?`,
} as const;

/** The TJP editor extensions (src/lib/tjp/cm/). */
export const editorStrings = {
	lint: {
		/** Shown as the diagnostic's source in the tooltip and panel. */
		source: {
			engine: 'TaskJuggler',
			syntax: 'Syntax',
			value: 'Value',
			attribute: 'Custom attribute',
		},
		/** The message with its hint, if any. */
		message: (message: string, hint: string | null) =>
			hint === null ? message : `${message} ${hint}`,
		/** A diagnostic from a run made before the latest edits. */
		staleMessage: (message: string) =>
			`${message} (From the last run. The text has changed since.)`,
		/** Spoken when the cursor lands on a marked problem: "Error: Task 'zz' is unknown." */
		announce: (severity: string, message: string) =>
			`${severity === 'error' ? 'Error' : severity === 'warning' ? 'Warning' : 'Note'}: ${message}`,
	},
	hover: {
		task: 'Task',
		resource: 'Resource',
		macro: 'Macro',
		/** "Task app.editor “Editor”". */
		symbolTitle: (kind: string, id: string, name: string | null) =>
			name ? `${kind} ${id} “${name}”` : `${kind} ${id}`,
		scenarioSpecific: 'Takes a scenario prefix, such as plan:',
		docsLoading: 'The full documentation appears once the scheduler has started.',
		seeAlso: (keywords: readonly string[]) => `See also: ${keywords.join(', ')}`,
		declaredAt: (file: string, line: number) => `Declared in ${file}, line ${line}`,
		unknownTarget: (written: string) => `${written} is not declared.`,
		noDocs: 'No documentation here. Put the cursor on a keyword or an id.',
	},
	completion: {
		scenario: 'Scenario prefix',
		task: 'Task',
		resource: 'Resource',
	},
	format: {
		formatted: 'Formatted.',
		unchanged: 'Already formatted.',
		refused: 'Fix the syntax errors before formatting.',
		stale: 'The file changed while formatting. Try again.',
	},
	/** Editor commands, for buttons, menus and the help page; shortcuts as shown per platform. */
	commands: {
		format: { label: 'Format file', mac: '⇧⌥⌘F', other: 'Shift+Alt+F' },
		showDocs: { label: 'Show documentation', mac: '⌘K ⌘I', other: 'Ctrl+K Ctrl+I' },
		nextDiagnostic: { label: 'Next problem', mac: 'F8', other: 'F8' },
		openDiagnostics: { label: 'List problems', mac: '⇧⌘M', other: 'Ctrl+Shift+M' },
	},
} as const;

/**
 * CodeMirror's own interface text (`EditorState.phrases`), so it is translated here with the
 * rest. Keys are CodeMirror's English phrases.
 */
export const codemirrorPhrases: Readonly<Record<string, string>> = {
	// @codemirror/view
	'Control character': 'Control character',
	// @codemirror/language (folding)
	'Folded lines': 'Folded lines',
	'Unfolded lines': 'Unfolded lines',
	to: 'to',
	'folded code': 'folded code',
	unfold: 'unfold',
	'Fold line': 'Fold line',
	'Unfold line': 'Unfold line',
	// @codemirror/search
	'Go to line': 'Go to line',
	go: 'go',
	Find: 'Find',
	Replace: 'Replace',
	next: 'next',
	previous: 'previous',
	all: 'all',
	'match case': 'match case',
	'by word': 'by word',
	regexp: 'regexp',
	replace: 'replace',
	'replace all': 'replace all',
	close: 'close',
	'current match': 'current match',
	'replaced $ matches': 'replaced $ matches',
	'replaced match on line $': 'replaced match on line $',
	'on line': 'on line',
	// @codemirror/autocomplete
	Completions: 'Completions',
	// @codemirror/lint
	Diagnostics: 'Diagnostics',
	'No diagnostics': 'No diagnostics',
};

export const engineStatusLabels = {
	booting: 'Starting the scheduler',
	idle: 'Ready',
	busy: 'Scheduling',
	failed: 'Failed',
} as const;

/** Keys match `EngineState` in the engine protocol (phase-0 spec 3.3). */
export type EngineStatus = keyof typeof engineStatusLabels;

/** Why an edit intent was refused (src/lib/tjp/edit/types.ts), one sentence each, for toasts. */
export const refusalStrings = {
	'unknown-target': 'That item no longer exists in the plan.',
	'text-only': 'That part of the plan is written with macros, so it can only be edited as text.',
	'macro-in-body':
		'A macro call in the way keeps this from changing safely. Edit the text instead.',
	'invalid-value': 'That value is not valid here.',
	'conflicting-attribute': 'Another setting on this task conflicts with that change.',
	inherited: 'This value comes from a parent task. Change it there.',
	'id-collision': 'Another task or resource already uses that id.',
	cycle: 'That would make the tasks depend on each other in a loop.',
	'unfixable-reference': 'Some references to this item cannot be updated safely.',
	'undeclared-flag': 'That flag is not declared in the plan.',
	'unsafe-text': 'That text cannot be written into the plan safely.',
	'needs-schedule': 'Wait for the schedule to finish, then try again.',
	'syntax-error': 'Fix the syntax errors in the text first.',
	'unsupported-form': 'The plan uses a form of this setting that cannot be edited here.',
	stale: 'The plan changed in the meantime. Try again.',
	'shared-declaration':
		'This part of a file is used in more than one place, so it is edited as text.',
} as const satisfies Record<RefusalReason, string>;

/** Why the scheduler stopped, by `EngineError.kind`. */
export const engineFailureStrings = {
	boot: 'The scheduler could not start.',
	crash: 'The scheduler stopped unexpectedly.',
	timeout: 'The scheduler took too long and was restarted.',
	internal: 'The scheduler failed on this plan.',
	'invalid-request': 'The scheduler could not read this request.',
} as const satisfies Record<EngineErrorKind, string>;

/** Why a piece of the plan is "text only" (src/lib/tjp/text-only.ts). */
export const textOnlyStrings = {
	'macro-body': 'Part of a macro definition.',
	'macro-call': 'Written with a macro call.',
	'env-var': 'Written with an environment variable.',
	'macro-id': 'Its id is built by a macro.',
	'auto-id': 'Its id is chosen by the scheduler.',
	'expanded-only': 'Declared by a macro.',
	'syntax-error': 'Has a syntax error.',
	opaque: 'A setting the editor does not understand yet.',
	unresolved: 'The scheduler has not named this item yet.',
} as const;

/** Intents whose undo label names the attribute ("set effort"), and the rest by type. */
type AttrIntent =
	| 'setAttr'
	| 'removeAttr'
	| 'setResourceAttr'
	| 'removeResourceAttr'
	| 'setProjectAttr'
	| 'removeProjectAttr';

/**
 * The unified undo history (phase-2.md 6.7, ADR-0008): button text, tooltips such as
 * "Undo: set effort", and the note after an undo that names the change and its files.
 */
export const historyStrings = {
	undo: 'Undo',
	redo: 'Redo',
	undoWhat: (what: string) => `Undo: ${what}`,
	redoWhat: (what: string) => `Redo: ${what}`,
	nothingToUndo: 'Nothing to undo',
	nothingToRedo: 'Nothing to redo',
	/** Shown after an undo or redo that was not typing in the open file. */
	undone: (what: string, files: string) => `Undone: ${what} (${files})`,
	redone: (what: string, files: string) => `Redone: ${what} (${files})`,
	diverged: 'A file changed outside the undo history, so undo and redo were cleared.',
	shortcuts: {
		undo: { mac: '⌘Z', other: 'Ctrl+Z' },
		redo: { mac: '⇧⌘Z', other: 'Ctrl+Y' },
	},
	typing: 'typing',
	/** The History sheet's line for a typing group. */
	typingIn: (file: string) => `Typing in ${file}`,
	/** A phone's top bar: what Undo and Redo would do, or why they cannot. */
	undoNone: 'Undo, nothing to undo',
	redoNone: 'Redo, nothing to redo',
	/** The phone's History sheet (long-press on Undo, or the status card's History row). */
	sheet: {
		title: 'History',
		open: 'Undo history',
		/** The status card's row, and Undo's hint for a keyboard (the context menu key). */
		openHint: 'Press and hold Undo, or use this row',
		intro: 'Choose a change to go back to it. Redo can step forward again.',
		empty: 'Nothing to undo yet.',
		latest: 'Latest',
		/** "2 min ago": `ago` comes from Intl.RelativeTimeFormat. */
		entry: (label: string, ago: string) => `${label}, ${ago}`,
		now: 'just now',
		close: 'Close',
		/** Asked when a line is tapped: `n` entries, from the newest down to the one chosen. */
		confirmTitle: (n: number) =>
			n === 1 ? 'Undo the last change?' : `Undo the last ${n} changes, back to here?`,
		/** `label` is the oldest of them: the text goes back to just before it. */
		confirmBody: (label: string) => `The plan goes back to just before: ${label}`,
		cancel: 'Cancel',
		confirm: (n: number) => (n === 1 ? 'Undo' : `Undo ${n}`),
	},
	/** The compact message after "back to here". */
	rewound: (n: number) => `Undid ${n} ${n === 1 ? 'change' : 'changes'}.`,
	rewindStopped: (done: number, asked: number) =>
		`Stopped after undoing ${done} of ${asked}. A file changed outside the undo history, so undo and redo were cleared.`,
	rewindChanged: 'The history changed first, so nothing was undone.',
	/** A change whose intent the history does not know. */
	edit: 'edit',
	setAttr: (attr: string) => `set ${attr}`,
	removeAttr: (attr: string) => `remove ${attr}`,
	intent: {
		renameTask: 'rename task',
		addTask: 'add task',
		deleteTask: 'delete task',
		moveTask: 'move task',
		addDepends: 'add dependency',
		removeDepends: 'remove dependency',
		setDependsGap: 'change gap',
		allocate: 'allocate',
		addAllocation: 'add allocation',
		removeAllocation: 'remove allocation',
		replaceAllocation: 'replace allocation',
		addResource: 'add resource',
		deleteResource: 'delete resource',
		moveResource: 'move resource',
		renameResource: 'rename resource',
		setProjectHeader: 'edit project',
		setWorkingHours: 'set working hours',
		addLeave: 'add leave',
		updateLeave: 'change leave',
		removeLeave: 'remove leave',
		clearLeave: 'clear leave',
		gapToTask: 'convert gap to task',
		declareFlag: 'declare flag',
		format: 'format',
	} satisfies Record<Exclude<IntentType, AttrIntent>, string>,
} as const;

/**
 * Gantt actions (src/lib/gantt/intents.ts, phase-2.md 6.6 and 7.1): the label of each edit, for
 * its toast and its undo entry, and why an action cannot be done. Values in labels are written as
 * in the plan ("3d") or as display dates; `about` marks a rounded effort.
 */
export const ganttActionStrings = {
	label: {
		/** "Effort of Research: 3d to about 5d". */
		value: (what: string, task: string, from: string | null, to: string, about: boolean) =>
			`${what} of ${task}: ${from === null ? '' : `${from} to `}${about ? 'about ' : ''}${to}`,
		gap: (task: string, pred: string, to: string | null) =>
			to === null
				? `No gap before ${task} after ${pred}`
				: `Gap before ${task}: ${to} after ${pred}`,
		link: (pred: string, succ: string) => `${succ} now depends on ${pred}`,
		unlink: (pred: string, succ: string) => `${succ} no longer depends on ${pred}`,
		move: (task: string) => `Moved ${task}`,
		assign: (person: string, task: string) => `${person} assigned to ${task}`,
		unassign: (person: string, task: string) => `${person} removed from ${task}`,
		replace: (from: string, to: string, task: string) => `${to} replaces ${from} on ${task}`,
		rename: (from: string, to: string) => `Renamed ${from} to ${to}`,
		progress: (task: string, percent: number) => `${task} is ${percent}% complete`,
		add: (task: string) => `Added ${task}`,
		delete: (task: string) => `Deleted ${task}`,
	},
	/** Attribute names in labels. */
	attr: {
		effort: 'Effort',
		length: 'Length',
		duration: 'Duration',
		start: 'Start',
		end: 'End',
	},
	/** Why a Gantt action is not possible before it reaches the edit API (`NotPossibleReason`). */
	notPossible: {
		milestone: 'A milestone has no length to change.',
		container: 'This task gets its dates from the tasks inside it.',
		'text-only': 'That part of the plan is written with macros, so it can only be edited as text.',
		'no-driver': 'This task does not wait on another task, so there is no gap to change.',
		'start-and-end': 'This task has a fixed start and end. Change them in the task details.',
		'engine-only': 'This link is written in a macro. Edit it as text.',
		'not-scheduled': 'This task has no dates yet. Wait for the schedule.',
		'at-limit': 'The task cannot move further that way.',
		'two-gaps':
			'This dependency has two gaps, a working-time one and a calendar one. Change them in the dependency details.',
		analysing: 'The schedule is still being analysed. Try again in a moment.',
		'container-people':
			'People are booked on subtasks. Drop them on a subtask, or assign them in the text.',
	},
	/** Why an edit was a no-op (`NoopReason`). */
	noop: {
		'already-set': 'Nothing changed: the plan already says that.',
		'already-linked': 'These tasks are already linked.',
		'not-present': 'Nothing to remove.',
	},
	/** The move question (ADR-0008 #2), asked once. */
	movePreference: {
		title: 'How should moving a task change the plan?',
		gap: 'Add a gap after the task it waits for',
		start: 'Give the task a fixed start date',
		startWarning:
			'A fixed start is a constraint: the task stays there even if work before it moves.',
	},
} as const;

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

/** "1 working day", "2.5 working days". */
const days = (n: number, unit = 'working day'): string => `${n} ${unit}${n === 1 ? '' : 's'}`;
/** Minutes as hours, one decimal at most: "24 hours", "1.5 hours". */
const hours = (min: number): string => {
	const h = Math.round((min / 60) * 10) / 10;
	return `${h} hour${h === 1 ? '' : 's'}`;
};

/**
 * Plan health (src/lib/health, phase-3.md section 12): each check's name and sentence, the fix
 * labels, and the settings. A sentence takes the names and display dates the panel resolves
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
		/** "Remove start (5 Jan 2026)"; without a date when the plan writes it with a macro. */
		remove: (attr: string, date: string | null): string =>
			date === null ? `Remove ${attr}` : `Remove ${attr} (${date})`,
		why: 'Why here?',
		show: 'Show in text',
		gapToTask: 'Convert gap to task',
		editGap: 'Edit gap',
		replacePerson: 'Replace person…',
		/** "Replace Dev…": the person the fix replaces. */
		replace: (person: string): string => `Replace ${person}…`,
		openWorkload: 'Open in Workload',
		openCalendar: 'Open in Calendar',
	},
	/** The waiting task "Convert gap to task" adds. */
	gapTaskName: (pred: string): string => `Wait after ${pred}`,
	/** Shown for a task the message names that the plan no longer has. */
	unknownTask: 'A task',
	settings: {
		longGapDays: 'Long gap: more than this many working days',
		longTaskDays: 'Long task: more than this many working days',
		enabled: (check: string): string => `Check for ${check.toLowerCase()}`,
		reset: 'Reset to defaults',
	},
	none: 'No findings.',
} as const;

/**
 * Edit toasts (state/edits.svelte.ts, components/app/Toasts.svelte; phase-2.md 6.8, 9.4, 11.2):
 * one per visual edit, with Undo while it is the newest undo step.
 */
export const toastStrings = {
	region: 'Edits',
	rescheduling: 'Rescheduling…',
	/** The edit deleted the plan's last task: the plan is empty, which is not an error. */
	deletedLast: 'Deleted. The plan has no tasks.',
	/** The edit applied, but the result that includes it does not schedule (11.2). */
	noLongerSchedules: (message: string) => `Changed. The plan no longer schedules: ${message}`,
	noMessage: 'the scheduler gave no reason',
	/** It schedules, but the result has an error the plan did not have before. */
	newError: (message: string) => `Changed, with a new error: ${message}`,
	/** The run that included the edit failed; `sentence` is from `engineFailureStrings`. */
	failed: (sentence: string) => `Changed. ${sentence}`,
	/** The index could not be built for the edit (an error in the app, not in the text). */
	unprepared: 'This change could not be prepared. Edit the text instead.',
	undo: 'Undo',
	undoWhat: (label: string) => `Undo: ${label}`,
	show: 'Show',
	showInText: 'Show in text',
	dismiss: 'Dismiss',
	/** Said once per browser, the first time an edit adds a fixed date (ADR-0008 #2). */
	constraint: {
		start: 'A fixed start is a constraint: the task stays there even if work before it moves.',
		end: 'A fixed end is a constraint: the task stays there even if work around it moves.',
	},
} as const;

const plural = (n: number, one: string, other: string): string => `${n} ${n === 1 ? one : other}`;

/**
 * The Gantt's gestures and keys (src/components/gantt, phase-2.md 7.1, 7.2, 10.2): the labels
 * that hang by a drag, the live-region sentences of the keyboard modes and the link mode, the
 * move question's buttons, the people palette and the row menu. A label by a drag says what a
 * drop would do; the toast that follows says what it did (`ganttActionStrings`).
 */
export const gestureStrings = {
	drag: {
		/** By a move: "Later by 2 working days: starts Wed, Mar 11, 2026". */
		move: (days: number, date: string, alap: boolean) =>
			`${days > 0 ? 'Later by' : 'Earlier by'} ${plural(Math.abs(days), 'working day', 'working days')}: ${alap ? 'ends' : 'starts'} ${date}`,
		/** By a resize: the edit's own label, then the day the dragged edge falls on. */
		resize: (label: string, date: string, alap: boolean) =>
			`${label}, ${alap ? 'starts' : 'ends'} ${date}`,
		progress: (percent: number) => `${percent}% complete`,
		/** At the end of what the dependencies allow: the bar stops there. */
		limit: 'Stops here: other tasks hold it',
		/** The drag cannot drop: the sentence is the refusal's. */
		blocked: (message: string) => `Not possible: ${message}`,
		/** By a link: what a drop would write, or why not. */
		linkOk: (pred: string, succ: string) => `${succ} will wait for ${pred}`,
		linkNo: (message: string) => `Not allowed: ${message}`,
	},
	live: {
		cancelled: 'Cancelled.',
		lifted: (name: string) => `${name} lifted. Drag to move it, or release to cancel.`,
		linkStart: (name: string) => `Linking from ${name}. Choose the task that comes after it.`,
		linkKeys: (name: string) =>
			`Linking from ${name}. Up and Down choose the task that comes after it, Enter links, Escape cancels.`,
		linkTarget: (name: string, verdict: string) => `${name}: ${verdict}`,
		linkAllowed: 'allowed',
		linkCancelled: 'Link cancelled.',
		progressStart: (name: string, percent: number) =>
			`Progress of ${name}: ${percent}%. Left and right change it by 5, Enter finishes.`,
		progressNow: (percent: number) => `${percent}%`,
		progressDone: 'Progress set.',
		today: 'Scrolled to today.',
		noToday: 'Today is not on the chart.',
		nothingToDo: 'Nothing to do there.',
		noPlace: 'It cannot move that way.',
		/** The drop line, while a row is dragged. */
		rowDrop: (parent: string | null, position: number) =>
			parent === null
				? `Top level, position ${position}`
				: `Inside ${parent}, position ${position}`,
		rowOpens: 'Opens when held here',
		/** Said when a person is booked from the palette by key. */
		assigned: (person: string, task: string) => `${person} booked on ${task}.`,
	},
	link: {
		banner: (name: string) => `Linking from ${name}: choose the task that comes after it.`,
		cancel: 'Cancel',
		cancelLabel: 'Cancel linking',
	},
	moveQuestion: {
		/** The dialog's buttons; the options and the warning are `ganttActionStrings.movePreference`. */
		confirm: 'Move',
		cancel: 'Cancel',
		remember: 'Mainspring asks this once. Project settings changes it later.',
	},
	palette: {
		region: 'People',
		/** The toolbar control that opens the searchable list of people (polish item 17). */
		assign: 'Assign',
		assignTitle: 'Assign a person to tasks',
		switchTitle: 'Choose another person to assign',
		listLabel: 'People',
		searchLabel: 'Find a person by name or id',
		searchPlaceholder: 'Find a person',
		hint: 'Drag a person onto a bar to book them on that task. Click a person to book them on several bars in a row. With a task selected, Enter books the person on it.',
		none: 'No people in this plan yet.',
		noMatch: (query: string) => `No one matches "${query}".`,
		count: (n: number) => (n === 1 ? '1 person' : `${n} people`),
		/** In a list option: the person is already on the selected task. */
		onSelected: 'on the selected task',
		recentRegion: 'Recently assigned',
		recent: (name: string) => `${name}: drag onto a bar`,
		/** Assign mode: the pill beside the button, and its way out. */
		assigning: (name: string) => `Assigning ${name}\u2026`,
		assigningLive: (name: string) =>
			`Assigning ${name}. Click bars to book them. Escape or Done ends it.`,
		done: 'Done',
		doneLabel: 'Done assigning',
		ended: 'Stopped assigning.',
		/** Said when Enter in the list finds the person already on the selected task. */
		already: (person: string, task: string) => `${person} is already on ${task}.`,
		/** The label by a dragged chip over a container. */
		container: 'Not on a summary: pick a subtask',
		/** The label by a dragged chip, over a bar. */
		over: (person: string, task: string) => `Book ${person} on ${task}`,
	},
	row: {
		grip: (name: string) => `Move ${name}`,
		menu: 'Row actions',
		up: 'Move up',
		down: 'Move down',
		indent: 'Indent',
		outdent: 'Outdent',
		rename: 'Rename',
		add: 'Add a task after',
		delete: 'Delete',
		newTask: 'New task',
		renameLabel: (name: string) => `Rename ${name}`,
		removeLink: 'Remove the selected link',
		longer: 'Longer by one unit',
		shorter: 'Shorter by one unit',
		later: 'Later by a working day',
		earlier: 'Earlier by a working day',
		link: 'Link from this task',
		shortcuts: 'Keyboard shortcuts',
	},
	/** The shortcuts list (the row menu) and the treegrid's description of its keys. */
	keys: {
		title: 'Keyboard shortcuts',
		close: 'Close',
		intro:
			'These work with the focus on a task in the task list. Every one is also in the row menu.',
		/** Said when the focus enters the task list. */
		gridHint: (list: string) => `Shortcuts: ${list}. The row menu has them all as buttons.`,
		label: {
			size: 'Longer or shorter by one unit',
			move: 'Later or earlier by a working day',
			reorder: 'Move up or down',
			indent: 'Indent or outdent',
			link: 'Link: then Up, Down and Enter',
			progress: 'Progress: then Left and Right, Enter to finish',
			today: 'Scroll to today',
			rename: 'Rename',
			add: 'Add a task after',
			delete: 'Delete the task, or the selected link',
		},
	},
} as const;

/**
 * The inspector, the link inspector, the project sheet and the show-source sheet
 * (src/components/inspector, phase-2.md 9.3). Labels of edits read like the Gantt's own
 * ("Priority of Code: 500"), so a toast and an undo entry say the same thing whichever view made
 * the change.
 */
export const inspectorStrings = {
	/** The side panel and the bottom sheet. */
	panel: 'Details',
	taskTitle: 'Task details',
	linkTitle: 'Link details',
	close: 'Close',
	closeDetails: 'Close details',
	hidePanel: 'Hide details',
	showPanel: 'Show details',
	/** The sheet's grabber: a button that toggles the two heights, as well as a drag handle. */
	grabber: 'Details height',
	grabberFull: 'Show more',
	grabberHalf: 'Show less',
	empty: 'Select a task to see and change its details.',
	notFound: 'This task is no longer in the plan.',
	openProject: 'Project',
	projectSettings: 'Project settings',
	waiting: 'Waiting for the plan…',
	/** Why a field cannot be edited here, with the way to the text. */
	showInText: 'Show in text',
	showSource: 'Show source',
	inherited: (from: string) => `Inherited from ${from}. A value here replaces it.`,
	inheritedList: (from: string) => `from ${from}`,
	textOnly: {
		'macro-body': 'Part of a macro definition. Edit it in the text.',
		'macro-call': 'Written with a macro. Edit it in the text.',
		'env-var': 'Written with an environment variable. Edit it in the text.',
		'macro-id': 'Its id is built by a macro. Edit it in the text.',
		'auto-id': 'Its id is chosen by the scheduler. Edit it in the text.',
		'expanded-only': 'Declared by a macro. Edit it in the text.',
		'syntax-error': 'Has a syntax error. Fix it in the text.',
		opaque: 'A setting the editor does not understand yet. Edit it in the text.',
		unreadable: 'Written in a form the editor cannot show. Edit it in the text.',
	},
	declarationTextOnly: 'This task is declared with a macro, so it can only be edited as text.',
	otherScenario: (name: string) =>
		`Written for the “${name}” scenario, which the editor does not change. Edit it in the text.`,
	section: {
		schedule: 'Schedule',
		size: 'Size',
		dates: 'Dates',
		options: 'Options',
		people: 'People',
		waitsFor: 'Waits for',
		followedBy: 'Followed by',
		links: 'Links',
	},
	field: {
		name: 'Name',
		id: 'Id',
		sizeType: 'Kind of size',
		sizeValue: 'Size',
		start: 'Start',
		end: 'End',
		minstart: 'Not before',
		maxend: 'Not after',
		scheduling: 'Scheduling',
		priority: 'Priority',
		complete: 'Complete (%)',
		milestone: 'Milestone',
		note: 'Note',
		flags: 'Flags',
		responsible: 'Responsible',
		gap: 'Gap',
		gapKind: 'Kind of gap',
		predecessor: 'Waits for',
		successor: 'Then',
		type: 'Type',
	},
	size: {
		effort: 'Effort',
		length: 'Length',
		duration: 'Duration',
		hint: {
			effort: 'Work for one person; more people finish sooner.',
			length: 'Working time on the calendar.',
			duration: 'Calendar time, weekends included.',
		},
		unset: 'No size yet. Type one, such as 5d.',
		container: 'This task gets its dates from the tasks inside it.',
		milestone: 'A milestone has no size. Clear Milestone to give it one.',
		implied: 'With no size and nobody booked, TaskJuggler treats this task as a milestone.',
		more: (what: string) => `More ${what}`,
		less: (what: string) => `Less ${what}`,
	},
	dateHint: 'For example 2026-03-02 or 2026-03-02-09:00, in the project’s time zone.',
	dateClear: (what: string) => `Clear ${what}`,
	constraintStart:
		'A fixed start is a constraint: the task stays there even if work before it moves.',
	constraintEnd: 'A fixed end is a constraint: the task stays there even if work around it moves.',
	constraintBound: 'This limits the task but does not fix it.',
	scheduling: { asap: 'As soon as possible', alap: 'As late as possible', unset: 'Not set' },
	milestoneHint: 'A milestone is a point in time with no work.',
	increase: (what: string) => `Increase ${what}`,
	decrease: (what: string) => `Decrease ${what}`,
	priorityDefault: 'Not set. TaskJuggler uses 500.',
	completeContainer: 'The progress of a container comes from the tasks inside it.',
	noNote: 'Add a note',
	noteHint: 'Saved when you leave the field.',
	flagsNone: 'No flags',
	flagAdd: 'Add a flag',
	flagRemove: (flag: string) => `Remove flag ${flag}`,
	flagNew: 'New flag',
	flagDeclare: 'Declare and add',
	flagNewHint: 'Declares the flag in the plan, then adds it to this task.',
	responsibleNone: 'Nobody',
	responsibleInherited: (names: string) => `Also responsible, from a parent task: ${names}`,
	peopleNone: 'Nobody is booked on this task.',
	personRemove: (name: string) => `Remove ${name}`,
	personReplace: (name: string) => `Replace ${name} with…`,
	personAdd: 'Add a person',
	personFromParent: 'from a parent task',
	/** The engine's side of a task: what TaskJuggler scheduled. */
	engine: {
		start: 'Starts',
		end: 'Finishes',
		float: 'Float',
		driver: 'What sets the start',
		critical: 'Critical path',
		notScheduled: 'Not scheduled yet.',
		estimate: '(estimate)',
		yes: 'Yes',
		no: 'No',
		floatNone: 'None',
		pending: 'Not computed yet',
		driverDependency: (name: string) => `Waits for ${name}`,
		driverFrame: 'Starts with the project',
		driverUnexplained: 'Held by resources or calendars',
		driverNone: 'Not known yet',
	},
	openEnded: {
		notice: (people: string) =>
			`This task has no size, so TaskJuggler books ${people} until the project end.`,
		setEffort: 'Set effort',
		changeAnyway: 'Change anyway',
		ask: (people: string) =>
			`This task will have no size, so TaskJuggler books ${people} until the project end. Add an effort?`,
		title: 'Task without a size',
	},
	dependency: {
		none: 'Nothing.',
		remove: (name: string) => `Remove the link to ${name}`,
		open: (name: string) => `Open the link with ${name}`,
		details: 'Details',
		gapFor: (name: string) => `Gap after ${name}`,
		gapPlaceholder: 'None',
		gapHint: 'Such as 2d. Leave empty for no gap.',
		gapBoth: 'The plan gives this link two gaps. Saving one here replaces both.',
		working: 'Working time',
		calendar: 'Calendar time',
		pending: 'Not scheduled yet',
		engineOnly: 'Written in a macro, so it can only be edited as text.',
		type: {
			'finish-start': 'Finish to start',
			'start-start': 'Start to start',
			'finish-finish': 'Finish to finish',
			'start-finish': 'Start to finish',
		},
		typeNote: 'The type is read-only for now.',
		removeLink: 'Remove',
		missing: 'This link is no longer in the plan.',
		openTask: (name: string) => `Open ${name}`,
	},
	/** Edit labels, for the toast and the undo entry. */
	label: {
		set: (what: string, task: string, to: string) => `${what} of ${task}: ${to}`,
		change: (what: string, task: string, from: string, to: string) =>
			`${what} of ${task}: ${from} to ${to}`,
		clear: (what: string, task: string) => `${what} of ${task} cleared`,
		noteChanged: (task: string) => `Note of ${task} changed`,
		kind: (task: string, from: string, to: string) => `${task} is now ${to} instead of ${from}`,
		milestoneOn: (task: string) => `${task} is now a milestone`,
		milestoneOff: (task: string) => `${task} is no longer a milestone`,
		flagAdd: (flag: string, task: string) => `${task} flagged ${flag}`,
		flagRemove: (flag: string, task: string) => `${flag} removed from ${task}`,
		declare: (flag: string) => `Declared flag ${flag}`,
		responsible: (name: string, task: string) => `${name} is responsible for ${task}`,
		noResponsible: (task: string) => `${task} has no responsible person`,
		gap: (task: string, pred: string, to: string | null) =>
			to === null
				? `No gap before ${task} after ${pred}`
				: `Gap before ${task}: ${to} after ${pred}`,
		project: {
			name: (to: string) => `Project renamed to ${to}`,
			start: (to: string) => `Project starts ${to}`,
			end: (to: string) => `Project ends ${to}`,
			now: (to: string) => `Status date: ${to}`,
			noNow: 'Status date cleared',
			timezone: (to: string) => `Time zone: ${to}`,
			noTimezone: 'Time zone cleared',
		},
	},
	/** The attribute names in labels. */
	what: {
		start: 'Start',
		end: 'End',
		minstart: 'Earliest start',
		maxend: 'Latest end',
		scheduling: 'Scheduling',
		priority: 'Priority',
		complete: 'Progress',
		note: 'Note',
	},
	confirmShared: (ids: string) =>
		`This part of the plan is read in more than one place (${ids}), so the change applies to all of them. Change anyway?`,
	link: {
		between: (pred: string, succ: string) => `${succ} waits for ${pred}`,
	},
	project: {
		title: 'Project',
		description:
			'The plan’s frame and the status date. Changes go to the text of the project header.',
		name: 'Name',
		start: 'Start',
		end: 'End',
		endHint: 'A date, or a length such as +17w.',
		now: 'Status date',
		nowHint: 'The date the plan is measured from. Leave empty to use the clock.',
		timezone: 'Time zone',
		timezoneHint: 'A name such as Europe/Berlin, or UTC.',
		noHeader: 'This plan has no project header.',
		clear: (what: string) => `Clear ${what}`,
		move: {
			title: 'When you move a task',
			description:
				'Moving a task in the chart changes the plan in one of two ways. The answer is remembered in this browser.',
			ask: 'Ask me next time',
			gap: 'Add a gap after the task it waits for',
			start: 'Give the task a fixed start date',
			note: 'A task scheduled as late as possible always gets a fixed end instead.',
		},
	},
	source: {
		title: (name: string) => `Source of ${name}`,
		file: (path: string) => `In ${path}`,
		openInText: 'Open in text',
		cut: (lines: number) =>
			`Showing the first part of ${lines} lines. Open it in the text to read the rest.`,
		none: 'The source of this task cannot be shown.',
		region: 'Plan text',
	},
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

/**
 * The Resources lanes (src/components/resources, phase-3.md 9.4, 10, 7.1 W1 and W2): one lane per
 * person with the booked tasks as bars, leave hatched by type and an "over" band under the lane.
 * The lane's picture is aria-hidden; its ARIA mirror says each person's tasks per period in words.
 * The controls, the cell details and the rebalance messages are the heatmap's (`workloadStrings`).
 */
export const lanesStrings = {
	region: 'Resources',
	/** The ARIA mirror of the canvas (a grid). */
	grid: 'Resource lanes by person and period',
	toolbar: 'Resource lane controls',
	/** The legend's entries. */
	legend: {
		label: 'Legend',
		bar: 'Booked task',
		textOnly: 'Text only: edit it in the text',
		over: 'Over',
		leave: 'Leave',
		group: 'Group roll-up',
	},
	/** The badge on a bar whose task the editor cannot move. */
	badge: 'T',
	/** "Login page 24 h" in a period's accessible name. */
	assigned: (tasks: string) => `works on ${tasks}`,
	more: (n: number) => ` and ${n} more`,
	task: (name: string, hours: string, textOnly: boolean) =>
		`${name} ${hours} h${textOnly ? ' (text only)' : ''}`,
	/** The lifted bar, announced when a long-press lifts it. */
	lifted: (task: string, who: string) =>
		`${task} lifted from ${who}. Drag to a person or a period.`,
	/** A press on a bar whose task cannot be moved. */
	textOnlyHint: (task: string) =>
		`${task} is declared where it cannot be edited. Edit it in the text.`,
} as const;

export const strings = {
	appName: 'Mainspring',
	tagline: 'TaskJuggler plans, scheduled in your browser.',
	skipToContent: 'Skip to main content',
	noscript: 'Mainspring needs JavaScript to run the scheduler in your browser.',
	engine: {
		label: 'Engine',
		notConnected: 'not connected yet',
		status: engineStatusLabels,
		failure: engineFailureStrings,
		retry: 'Try again',
	},
	/** A newer build of the app is deployed (ADR-0012). */
	update: {
		available: 'New version',
		reload: 'Reload',
		/** The status-strip button: says what it does and why. */
		reloadLabel: 'A new version of Mainspring is available. Reload to use it',
		title: 'This app',
		build: 'Build',
		check: 'Check for updates',
		checking: 'Checking…',
		current: 'Up to date',
		unknown: 'Could not check',
		confirmReload: 'Reloading discards your changes to this plan. Reload anyway?',
	},
	home: {
		openApp: 'Open the app',
	},
	/** Sample plans for Text mode, keyed by `Sample.id` (src/lib/workspace/samples.ts). */
	samples: {
		'poc-sample': 'Proof-of-concept plan',
		'upstream-tutorial': 'TaskJuggler tutorial',
		'syn-18-structure-include-macro': 'Includes, macros and supplements',
		'upstream-fedora-20': 'Fedora 20 release schedule',
		'gantt-manipulation': 'Gantt manipulation shapes',
		'gantt-200': 'Gantt scale: 200 tasks',
		'gantt-500': 'Gantt scale: 500 tasks',
		'fedora-res': 'Fedora 20 with people (generated)',
	},
	topBar: {
		sample: 'Sample plan',
		loading: 'Loading the plan…',
		loadFailed: (label: string) => `Could not load “${label}”.`,
		confirmSwitch: 'Switching plans discards your changes to this one. Switch anyway?',
		history: 'Undo and redo',
		undo: 'Undo',
		redo: 'Redo',
		/** The phone's subtitle under the plan name, e.g. "Finish Wed, Jan 6, 2027". */
		finish: (date: string) => `Finish ${date}`,
	},
	/** What an empty plan shows where its tasks would be (components/app/EmptyState.svelte). */
	empty: {
		tasksTitle: 'No tasks yet',
		addTask: 'Add task',
		/** The pointer to Text mode; a button where the editor is not on screen. */
		inText: 'or write them in Text',
	},
	/**
	 * The People shell (phase-3.md 9.1, 18.10; components/people): the view switcher on desktop and
	 * tablet, the segments of the phone's People tab, the "No people" state with Add person, and the
	 * placeholders the heatmap, lanes, calendar and team views (T14 to T17) replace.
	 */
	people: {
		/** The view switcher of the desktop and tablet toolbars (a radio group). */
		switcher: 'Views',
		view: { gantt: 'Gantt', workload: 'Workload', resources: 'Resources', calendar: 'Calendar' },
		/** The segmented control of the phone's People tab (a tablist). */
		segments: 'People views',
		segment: { load: 'Load', lanes: 'Lanes', calendar: 'Calendar', team: 'Team' },
		loading: 'Loading the people views…',
		loadFailed: 'The people views could not be loaded.',
		retry: 'Try again',
		/** The retry failed too: the browser may remember a failed import, a reload does not. */
		reload: 'Reload the page',
		/** The plan declares no resource (a heatmap, lanes or a team of nobody). */
		none: {
			title: 'No people yet',
			lead: 'Add the people who do the work. Each one is a resource in the plan.',
			add: 'Add person',
			/** The name the new person starts with; the details rename it. */
			newPerson: 'New person',
			label: (name: string) => `Added ${name}`,
		},
		/** What a view not built yet shows (replaced by T14 to T17). */
		coming: {
			workload: 'The workload heatmap is coming.',
			resources: 'The resource lanes and table are coming.',
			calendar: 'The calendar of holidays and leaves is coming.',
			team: 'The team list is coming.',
		},
	},
	/** "New plan…" (ADR-0013): the chooser's entries and the sheet that makes the plan. */
	newPlan: {
		/** The chooser's first entry; the dots mean it opens a sheet. */
		chooser: 'New plan…',
		/** The chooser's group of built-in plans. */
		samplesGroup: 'Samples',
		/** How the chooser and the phone's header list a plan made here. */
		listed: (name: string) => `${name} (new)`,
		title: 'New plan',
		lead: 'A new plan starts empty. You add its first task after you create it.',
		name: 'Name',
		namePlaceholder: 'Website relaunch',
		start: 'Start',
		zone: 'Time zone',
		zoneNone: 'None (UTC)',
		frameNote: 'The plan runs for one year from the start. Project settings change that later.',
		create: 'Create',
		cancel: 'Cancel',
		errors: {
			'name-empty': 'Give the plan a name.',
			'name-unsafe': 'A name cannot contain ${…} or $(…): TaskJuggler would expand it.',
			'name-backslash': 'A name cannot end with a backslash.',
			start: 'Enter a start date from 1970 to 2035.',
			zone: 'Choose a time zone from the list.',
		},
	},
	/** The theme toggle: the preference now, and what pressing it switches to. */
	theme: {
		label: 'Theme',
		pref: { system: 'System', light: 'Light', dark: 'Dark' },
		button: (current: string, next: string) => `Theme: ${current}. Switch to ${next}`,
		/** The phone's status card: the same three choices as the toggle, as a group. */
		appearance: 'Appearance',
	},
	notice: 'Changes stay in this tab until saving arrives. Reloading the page discards them.',
	panels: {
		plan: 'Plan',
		gantt: 'Gantt',
		people: 'People',
		text: 'Text',
		tabs: 'Panels',
		outlineOpen: 'Outline',
		outlineClose: 'Close outline',
		/** The draggable divider between the editor and the Gantt in Split mode. */
		divider: 'Resize the editor and the chart',
		dividerValue: (percent: number, what: string) => `${what} ${percent}%`,
		/** The divider between the Gantt's task table and its chart. */
		tableDivider: 'Resize the task table and the chart',
		dividerTable: 'Table',
		dividerEditor: 'Editor',
		dividerChart: 'Chart',
	},
	outline: {
		title: 'Outline',
		tasks: 'Tasks',
		resources: 'Resources',
		noTasks: 'No tasks yet.',
		noResources: 'No resources yet.',
		textOnly: 'text only',
		errors: (n: number) => plural(n, 'error', 'errors'),
		reason: textOnlyStrings,
	},
	/** The switch between the editor, both side by side, and the Gantt (src/components/gantt). */
	view: {
		label: 'View',
		text: 'Text',
		split: 'Split',
		visual: 'Visual',
		/** The tooltip of a mode button: the shortcut Ctrl or Cmd plus the mode's number. */
		shortcut: (n: number) => `Ctrl or Cmd+${n}`,
	},
	gantt: {
		region: 'Gantt chart',
		toolbar: 'Gantt controls',
		/** The Add task (+) control (ADR-0013). */
		add: {
			label: 'Add task',
			/** The tooltip while no task is selected: the button adds at once, at the end. */
			hintEnd: 'Add a task at the end of the plan',
			/** The tooltip while one is: the button opens the two choices. */
			hintMenu: 'Add a task after the selected one, or a subtask of it',
			menu: 'Add task options',
			after: 'Add task after',
			subtask: 'Add subtask',
			/** Why "Add subtask" is off: the selected task has no id the edit API can name. */
			noSubtask: 'Not available for a task declared by a macro',
		},
		zoom: 'Zoom',
		level: { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' },
		/** The zoom is between two presets (after a pinch or Ctrl+wheel), nearest to this one. */
		levelCustom: (nearest: string) => `${nearest} (custom)`,
		criticalPath: 'Critical path',
		criticalUnavailable: 'The critical path is not computed yet',
		/**
		 * The critical path and float are display estimates derived from the schedule (ADR-0007):
		 * they ignore resource limits and leveling, so they are always labelled as estimates.
		 */
		estimate: {
			/** The critical-path chip's tooltip. */
			hint: 'Critical path and float are estimates: they ignore resource limits and leveling',
			/** Shown while the chip is on and the whole path ends before the status date. */
			allDone: 'Every task on the critical path ends before the status date',
			/**
			 * Ends a critical task's line, so the critical path is never colour alone (WCAG 1.4.1),
			 * and says it is an estimate.
			 */
			critical: 'On the critical path (estimate)',
			float: (amount: string) => `Float about ${amount} (estimate)`,
			days: (n: number) => (n === 1 ? '1 working day' : `${n} working days`),
			hours: (n: number) => (n === 1 ? '1 working hour' : `${n} working hours`),
		},
		/** The treegrid's live region says this after a reschedule (phase-2.md 10.1). */
		rescheduled: (finish: string | null, delta: string | null, moved: number) =>
			[
				'Rescheduled.',
				finish === null ? null : `Finish ${finish}${delta ? `, ${delta}` : ''}.`,
				moved === 0 ? 'No tasks moved.' : `${plural(moved, 'task moved', 'tasks moved')}.`,
			]
				.filter((p) => p !== null)
				.join(' '),
		/** Today has no line on the chart to go to (it is before or after the plan). */
		todayOff: 'Today (off the chart)',
		today: 'Today',
		legend: 'Lines on the chart',
		quarter: (q: number) => `Q${q}`,
		tasks: 'Tasks',
		noTasks: 'No tasks yet.',
		scheduling: 'Scheduling…',
		lastGood: 'Showing the last good schedule',
		notScheduled: 'not scheduled',
		lines: {
			today: 'Today',
			status: 'Status date',
			both: 'Today (status date)',
			/** A line whose date is outside the drawn chart, e.g. "Today, off the chart". */
			off: (line: string) => `${line}, off the chart`,
		},
		/** Summary line for the selected or hovered task, e.g. "Code: 3 Mar to 9 Mar 2026". */
		span: (name: string, from: string, to: string) => `${name}: ${from} to ${to}`,
		milestoneOn: (name: string, at: string) => `${name}: milestone on ${at}`,
		/** The task's line with the people on it, e.g. "Code: 3 Mar to 9 Mar 2026. Ana, Ben". */
		withPeople: (line: string, people: string) => `${line}. ${people}`,
		/** The task's line with its estimate note, e.g. "Code: 3 Mar to 9 Mar 2026. On the critical path (estimate)". */
		withNote: (line: string, note: string) => `${line}. ${note}`,
		unscheduledRow: (name: string) => `${name}: not scheduled yet`,
		/** The filter by person and flag (phase-3.md "Amendments from T19"; src/components/gantt/FilterPanel.svelte). */
		filter: {
			/** The toolbar button, and the name of its panel. */
			label: 'Filter',
			title: 'Show only the tasks of one person, or with one flag',
			panel: 'Filter tasks',
			/** The button's name while a filter is on, e.g. "Filter: Dev 1, flag key". */
			on: (summary: string) => `Filter: ${summary}`,
			summary: (person: string | null, flag: string | null) =>
				[person, flag === null ? null : `flag ${flag}`].filter((p) => p !== null).join(', '),
			clear: 'Clear filter',
			done: 'Done',
			person: 'Person',
			personSearch: 'Find a person to filter by',
			/** In the person list: the person the chart is filtered to. */
			personOn: 'filtering by this person',
			flag: 'Flag',
			anyFlag: 'Any flag',
			noFlags: 'No task in this plan has a flag.',
			/** What a screen reader hears after a flag's name: how many tasks carry it. */
			taskCount: (n: number) => (n === 1 ? '1 task' : `${n} tasks`),
			/** The live line in the panel and the toolbar: how many tasks the filter shows. */
			shown: (n: number) => (n === 1 ? '1 task shown' : `${n} tasks shown`),
			none: 'No task matches the filter',
			/** The chart when nothing matches. */
			empty: 'No task matches this filter.',
			/** A person or flag the plan no longer has (a text edit removed it). */
			gone: (what: string) => `${what} is no longer in the plan.`,
			/** A row's name for a screen reader when it is shown only for the tasks under it. */
			contextRow: (line: string) => `${line}. Shown because a task under it matches the filter`,
		},
	},
	/** The Gantt's task list, a treegrid (src/components/gantt/OutlineGrid.svelte, phase-2.md 10.1). */
	grid: {
		label: 'Tasks',
		/** Said after a first tap on a phone or tablet: the task is selected, a second tap opens it. */
		tapAgain: (name: string) => `Selected ${name}. Tap again for details.`,
		/** The column headers, in the order of the cells. */
		columns: {
			number: '#',
			name: 'Task',
			start: 'Start',
			end: 'End',
			effort: 'Effort or length',
			people: 'People',
			float: 'Float (estimate)',
			critical: 'Critical (estimate)',
			status: 'Status',
			predecessors: 'Predecessors',
			successors: 'Successors',
		},
		/** What a screen reader says for a header whose visible text is a symbol. */
		columnNames: { number: 'Row number' },
		/**
		 * The Predecessors and Successors cells (polish item 16). The eye reads row numbers: "3",
		 * "3SS +2d". A screen reader reads the task names, and the hover text the TaskJuggler ids,
		 * both through `linkWords`.
		 */
		links: {
			/** The cell's accessible name: "Predecessors: Research, Sketch". */
			predecessors: (list: string) => `Predecessors: ${list}`,
			successors: (list: string) => `Successors: ${list}`,
			/** The hover text: the same, by id. */
			predecessorsIds: (list: string) => `Waits for: ${list}`,
			successorsIds: (list: string) => `Followed by: ${list}`,
			/** The kind of link when it is not the usual finish to start, as a suffix of the number. */
			typeShort: {
				'finish-start': '',
				'start-start': 'SS',
				'finish-finish': 'FF',
				'start-finish': 'SF',
			},
			typeWords: {
				'finish-start': 'finish to start',
				'start-start': 'start to start',
				'finish-finish': 'finish to finish',
				'start-finish': 'start to finish',
			},
			/** A gap in words: "plus 2 days", and which clock it is on. */
			gapWords: (amount: string, calendar: boolean) =>
				`plus ${amount}${calendar ? ' calendar time' : ''}`,
			/** The units of a gap, said in full. */
			units: {
				d: (n: number) => (n === 1 ? '1 day' : `${n} days`),
				h: (n: number) => (n === 1 ? '1 hour' : `${n} hours`),
				min: (n: number) => (n === 1 ? '1 minute' : `${n} minutes`),
			},
			/** A link the schedule shown does not include yet. */
			pending: 'not scheduled yet',
			/** Joins what is in the brackets after a task's name. */
			and: ', ',
		},
		/** A cell with nothing to say: an en dash for the eye, a word for a screen reader. */
		empty: '–',
		emptyWords: 'none',
		yes: 'Yes',
		no: 'No',
		status: {
			scheduled: 'Scheduled',
			notScheduled: 'Not scheduled',
			pending: 'Pending',
			textOnly: 'Text only',
			/** The newest run failed: the dates are the last good schedule's. */
			outOfDate: 'Out of date',
		},
		/** The effort cell when the size is written with a macro or a variable, or does not parse. */
		sizingMacro: 'From a macro',
		sizingText: 'See the text',
		/** The effort or length cell: the value and which attribute it is, e.g. "5d effort". */
		sizing: (value: string, attr: string) => `${value} ${attr}`,
	},
	editor: {
		label: (path: string) => `Editor for ${path}`,
		files: 'Files',
		file: 'File',
		format: 'Format',
		docs: 'Docs',
		docsTitle: 'Documentation',
		close: 'Close',
	},
	status: {
		region: 'Plan status',
		engineStarting: 'Starting the scheduler…',
		scheduling: 'Scheduling…',
		ok: 'Scheduled',
		/** A plan with no task: not an error (ADR-0013 #3). */
		empty: 'No tasks yet',
		errors: 'Scheduled with problems',
		notScheduled: 'Not scheduled: fix the errors',
		failed: 'Scheduler failed',
		idle: 'Waiting for the first schedule',
		finish: 'Finish',
		noFinish: 'No finish date yet',
		lastGood: 'last good',
		later: (amount: string) => `${amount} later`,
		earlier: (amount: string) => `${amount} earlier`,
		counts: (errors: number, warnings: number) =>
			errors + warnings === 0
				? 'No problems'
				: [
						errors > 0 ? plural(errors, 'error', 'errors') : null,
						warnings > 0 ? plural(warnings, 'warning', 'warnings') : null,
					]
						.filter(Boolean)
						.join(', '),
		/** "TaskJuggler 3.8.4": the scheduler the plan runs on (it is the real one, in the browser). */
		engineVersion: (v: string) => `TaskJuggler ${v}`,
		lastRun: (time: string) => `Last run ${time}`,
		/** The button that opens the engine details; the accessible name says what it opens. */
		engineDetails: 'Engine details',
		engineDetailsTitle: 'The scheduler and its last run',
		/**
		 * The phone's top-bar status button (it replaces the footer strip): its name says the state
		 * and what it opens; the popover's own sections follow.
		 */
		button: {
			title: 'Plan status and engine details',
			/** "Plan status: Scheduled, 3 warnings. A new version is available. Engine and scheduler details" */
			name: (state: string, problems: string | null, updateAvailable: boolean) =>
				[
					`Plan status: ${[state, problems].filter((p) => p !== null).join(', ')}`.replace(
						/([^.…])$/,
						'$1.',
					),
					updateAvailable ? 'A new version is available.' : null,
					'Engine and scheduler details',
				]
					.filter((p) => p !== null)
					.join(' '),
			popoverTitle: 'Plan status',
			/** A new build is out: the popover's prominent button. */
			newVersion: 'New version',
		},
		timingTitle: 'Last run',
		/** Under the timings: the round trip is not all scheduling. */
		timingNote:
			'Waiting and round trip is the time from sending the plan to getting the result, queueing included. The first run also includes the scheduler starting up.',
		versionsTitle: 'Versions',
		timing: {
			engine: 'Scheduler total',
			writeFs: 'Loading the files',
			parse: 'Reading the plan',
			schedule: 'Computing the schedule',
			serialize: 'Preparing the result',
			roundTrip: 'Waiting and round trip',
			process: 'Handling the result',
			tj: 'TaskJuggler',
			commit: 'TaskJuggler commit',
			ruby: 'Ruby on WebAssembly',
			bundle: 'Engine bundle',
		},
		nextProblem: 'Go to the next problem',
		unlocated: (n: number) => plural(n, 'message without a place', 'messages without a place'),
		unlocatedTitle: 'Messages without a place in the text',
		severity: { error: 'Error', warning: 'Warning', info: 'Note' },
	},
	inspector: inspectorStrings,
	refusal: refusalStrings,
	history: historyStrings,
	workload: workloadStrings,
	lanes: lanesStrings,
} as const;

/**
 * The shell's engine line, e.g. "Engine: Ready". Without a status (before the page script runs,
 * or without JavaScript) it reads "Engine: not connected yet".
 */
export function engineLine(status?: EngineStatus): string {
	const text = status === undefined ? strings.engine.notConnected : strings.engine.status[status];
	return `${strings.engine.label}: ${text}`;
}
