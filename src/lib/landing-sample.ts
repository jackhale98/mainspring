// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The plan drawn in the landing page's mocks (ADR-0011). It is a small TaskJuggler plan,
 * relaunch.tjp, that the browser engine scheduled on 2026-11-13; the bars below follow its dates.
 * Task names and plan text are plan data, not interface copy, so they live apart from
 * landing-copy.ts.
 */

/** A task in the illustrated plan: days are calendar days from the project start (a Monday). */
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

/** The illustrated plan, laid out as TaskJuggler would: weekends are skipped. */
export const samplePlan: readonly SampleTask[] = [
	{
		id: 'design',
		name: 'Design',
		start: 0,
		end: 5,
		critical: true,
		progress: 1,
		people: ['A'],
		after: [],
	},
	{
		id: 'build',
		name: 'Build',
		start: 7,
		end: 12,
		critical: true,
		progress: 0.3,
		people: ['A', 'B'],
		after: ['design'],
	},
	{
		id: 'docs',
		name: 'Docs',
		start: 7,
		end: 10,
		critical: false,
		progress: 0.5,
		people: ['C'],
		after: ['design'],
	},
	{
		id: 'test',
		name: 'Test',
		start: 14,
		end: 18,
		critical: true,
		progress: 0,
		people: ['B'],
		after: ['build', 'docs'],
	},
	{
		id: 'launch',
		name: 'Launch',
		start: 18,
		end: 18,
		critical: true,
		progress: 0,
		people: [],
		after: ['test'],
		milestone: true,
	},
];

/** The short plan beside the chart in "How it works". */
export const demoPlan: readonly SampleTask[] = [
	{
		id: 'design',
		name: 'Design',
		start: 0,
		end: 5,
		critical: true,
		progress: 1,
		people: ['A'],
		after: [],
	},
	{
		id: 'build',
		name: 'Build',
		start: 7,
		end: 12,
		critical: true,
		progress: 0,
		people: ['A', 'B'],
		after: ['design'],
	},
	{
		id: 'launch',
		name: 'Launch',
		start: 12,
		end: 12,
		critical: true,
		progress: 0,
		people: [],
		after: ['build'],
		milestone: true,
	},
];

/** The plan text shown in the product mock (from line 8 of relaunch.tjp). */
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
	'task docs "Docs" {',
	'  depends !design',
	'  effort 3d',
	'  allocate cy',
	'}',
	'task test "Test" {',
	'  depends !build, !docs',
];
/** Index in `mockPlanText` of the line the cursor is on. */
export const mockActiveLine = 6;
export const mockFirstLine = 8;

/** The plan text shown in "How it works". */
export const demoPlanText: readonly string[] = [
	'task design "Design" {',
	'  effort 5d',
	'  allocate ana',
	'}',
	'task build "Build" {',
	'  depends !design',
	'  effort 10d',
	'  allocate ana, ben',
	'}',
	'task launch "Launch" {',
	'  depends !build',
	'  milestone',
	'}',
];
export const demoActiveLine = 6;
