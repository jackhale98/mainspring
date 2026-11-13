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
		declareFlag: 'declare flag',
		format: 'format',
	} satisfies Record<Exclude<IntentType, AttrIntent>, string>,
} as const;

const plural = (n: number, one: string, other: string): string => `${n} ${n === 1 ? one : other}`;

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
	/** The theme toggle: the preference now, and what pressing it switches to. */
	theme: {
		label: 'Theme',
		pref: { system: 'System', light: 'Light', dark: 'Dark' },
		button: (current: string, next: string) => `Theme: ${current}. Switch to ${next}`,
	},
	notice: 'Changes stay in this tab until saving arrives. Reloading the page discards them.',
	/** The same notice in the compact form that a phone shows on every tab. */
	noticeShort: 'Changes stay in this tab',
	panels: {
		plan: 'Plan',
		gantt: 'Gantt',
		text: 'Text',
		tabs: 'Panels',
		outlineOpen: 'Outline',
		outlineClose: 'Close outline',
		/** The draggable divider between the editor and the Gantt in Split mode. */
		divider: 'Resize the editor and the chart',
		dividerValue: (percent: number, what: string) => `${what} ${percent}%`,
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
			/** The treegrid's float column (T18). */
			floatColumn: 'Float (estimate)',
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
		taskColumn: 'Task',
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
	},
	/** The Gantt's task list, a treegrid (src/components/gantt/OutlineGrid.svelte, phase-2.md 10.1). */
	grid: {
		label: 'Tasks',
		/** The column headers, in the order of the cells. */
		columns: {
			name: 'Task',
			start: 'Start',
			end: 'End',
			effort: 'Effort or length',
			people: 'People',
			float: 'Float (estimate)',
			critical: 'Critical (estimate)',
			status: 'Status',
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
		},
		/** The effort or length cell: the value and which attribute it is, e.g. "5d effort". */
		sizing: (value: string, attr: string) => `${value} ${attr}`,
		expandTask: 'Expand',
		collapseTask: 'Collapse',
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
		timingTitle: 'Last run',
		versionsTitle: 'Versions',
		timing: {
			engine: 'Scheduler total',
			writeFs: 'Loading the files',
			parse: 'Reading the plan',
			schedule: 'Computing the schedule',
			serialize: 'Preparing the result',
			roundTrip: 'Request to result',
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
	refusal: refusalStrings,
	history: historyStrings,
} as const;

/**
 * The shell's engine line, e.g. "Engine: Ready". Without a status (before the page script runs,
 * or without JavaScript) it reads "Engine: not connected yet".
 */
export function engineLine(status?: EngineStatus): string {
	const text = status === undefined ? strings.engine.notConnected : strings.engine.status[status];
	return `${strings.engine.label}: ${text}`;
}
