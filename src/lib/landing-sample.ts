// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plan drawn in the landing page's mocks (ADR-0011). It is a small TaskJuggler plan,
 * plan.tjp, that the browser engine scheduled on 2026-11-13: with `effort 5d` on Design the
 * milestone falls on Jan 6, 2026, and with `effort 8d` on Jan 9 (the pull-request mock). The bars
 * below follow those dates. Task names and plan text are plan data, not interface copy, so they
 * live apart from landing-copy.ts.
 */

/** A task in the illustrated plan: days are calendar days from the project start (Mon Dec 22). */
export interface SampleTask {
	id: string;
	name: string;
	start: number;
	end: number;
	critical: boolean;
	/** Fraction done, 0 to 1. */
	progress: number;
	milestone?: boolean;
	/** Initials of the people on the task (Ana, Ben and Cy). */
	people: readonly string[];
	/** Ids of the tasks this one depends on. */
	after: readonly string[];
}

const task = (
	id: string,
	name: string,
	start: number,
	end: number,
	extra: Partial<SampleTask> = {},
): SampleTask => ({
	id,
	name,
	start,
	end,
	critical: true,
	progress: 0,
	people: [],
	after: [],
	...extra,
});

/** The illustrated plan, laid out as TaskJuggler scheduled it: weekends are skipped. */
export const samplePlan: readonly SampleTask[] = [
	task('design', 'Design', 0, 5, { progress: 1, people: ['A'] }),
	task('build', 'Build', 7, 12, { progress: 0.3, people: ['A', 'B'], after: ['design'] }),
	task('docs', 'Docs', 7, 10, { critical: false, progress: 0.5, people: ['C'], after: ['design'] }),
	task('test', 'Test', 14, 16, { people: ['B'], after: ['build', 'docs'] }),
	task('launch', 'Launch', 16, 16, { after: ['test'], milestone: true }),
];

/** The short plan in the "drag, and the text changes" mock. */
export const demoPlan: readonly SampleTask[] = [
	task('design', 'Design', 0, 5, { progress: 1, people: ['A'] }),
	task('build', 'Build', 7, 12, { people: ['A', 'B'], after: ['design'] }),
	task('launch', 'Launch', 12, 12, { after: ['build'], milestone: true }),
];

/** The hero's plan: the four tasks whose text and bars sit side by side (Docs left out). */
export const heroPlan: readonly SampleTask[] = samplePlan
	.filter((t) => t.id !== 'docs')
	.map((t) => (t.id === 'test' ? { ...t, after: ['build'] } : t));

/** Lines 7 to 24 of plan.tjp, the editor beside the hero's Gantt: one block per task in `heroPlan`. */
export const mockPlanText: readonly string[] = [
	'task design "Design" {',
	'  effort 5d',
	'  allocate ana',
	'}',
	'task build "Build" {',
	'  depends !design',
	'  effort 10d',
	'  allocate ana, ben',
	'}',
	'task test "Test" {',
	'  depends !build',
	'  effort 2d',
	'  allocate ben',
	'}',
	'task launch "Launch" {',
	'  depends !test',
	'  milestone',
	'}',
];
/** Index in `mockPlanText` of the line the cursor is on, the edited `effort` line. */
export const mockActiveLine = 1;
/** The lines of the selected task (Design), which is also selected in the Gantt. */
export const mockSelectedLines: readonly [number, number] = [0, 3];
export const mockFirstLine = 7;

export type DiffKind = 'ctx' | 'add' | 'del';
export interface DiffLine {
	kind: DiffKind;
	/** Line number in the old file for a removed line, otherwise in the new file. */
	n: number;
	text: string;
}

/** The one-line plan change in the pull-request mock: Design takes eight days, not five. */
export const planDiff: readonly DiffLine[] = [
	{ kind: 'ctx', n: 7, text: 'task design "Design" {' },
	{ kind: 'del', n: 8, text: '  effort 5d' },
	{ kind: 'add', n: 8, text: '  effort 8d' },
	{ kind: 'ctx', n: 9, text: '  allocate ana' },
	{ kind: 'ctx', n: 10, text: '}' },
];
