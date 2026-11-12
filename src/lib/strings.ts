// SPDX-License-Identifier: GPL-2.0-or-later
// All user-facing copy lives in this file (CLAUDE.md conventions).
import type { ValueErrorCode } from './tjp/values/result';

/**
 * Diagnostics the document layer finds itself (src/lib/tjp/diagnostics*.ts). Engine messages
 * keep TaskJuggler's own text.
 */
export const diagnosticStrings = {
	syntax: {
		unexpected: (token: string) => `Unexpected ${token}.`,
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

export const engineStatusLabels = {
	booting: 'Starting the scheduler',
	idle: 'Ready',
	busy: 'Scheduling',
	failed: 'Failed',
} as const;

/** Keys match `EngineState` in the engine protocol (phase-0 spec 3.3). */
export type EngineStatus = keyof typeof engineStatusLabels;

export const strings = {
	appName: 'Mainspring',
	tagline: 'TaskJuggler plans, scheduled in your browser.',
	skipToContent: 'Skip to main content',
	engine: {
		label: 'Engine',
		notConnected: 'not connected yet',
		status: engineStatusLabels,
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
	},
} as const;

/**
 * The shell's engine line, e.g. "Engine: Ready". Without a status (before the page script runs,
 * or without JavaScript) it reads "Engine: not connected yet".
 */
export function engineLine(status?: EngineStatus): string {
	const text = status === undefined ? strings.engine.notConnected : strings.engine.status[status];
	return `${strings.engine.label}: ${text}`;
}
