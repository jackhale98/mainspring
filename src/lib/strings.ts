// SPDX-License-Identifier: GPL-2.0-or-later
// All user-facing copy lives in this file (CLAUDE.md conventions).

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
