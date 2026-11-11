// SPDX-License-Identifier: GPL-2.0-or-later
// All user-facing copy lives in this file (CLAUDE.md conventions).

export const engineStatusLabels = {
	booting: 'Starting the scheduler',
	ready: 'Ready',
	scheduling: 'Scheduling',
	failed: 'Failed',
} as const;

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
} as const;

/** The placeholder shell's engine line, e.g. "Engine: not connected yet". */
export function engineLine(): string {
	return `${strings.engine.label}: ${strings.engine.notConnected}`;
}
