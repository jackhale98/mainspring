// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// What plan health asks of the app (T18): "Show in Gantt" for a person's task filters the chart to
// the person when the filter would show the task (and drops a filter that would hide it), selects
// the task and shows the Gantt; "Open in Workload" selects the person, shows the heatmap and files a
// request the heatmap takes; "Why here?" selects the task and asks the details for the section for
// that selection; and the app keeps the health state of its plan.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sample } from '../workspace/samples';
import { FakeEngineClient, flush, task } from '../workspace/testing/fake-engine-client';
import { AppState } from './app.svelte';

const TEXT = [
	'project p "P" 2026-01-05 +1m',
	'resource dev "Dev"',
	'resource ops "Ops"',
	'task a "Alpha" { effort 1d allocate dev }',
	'task b "Beta" { effort 2d allocate ops }',
	'',
].join('\n');
const sample: Sample = {
	id: 'plan' as Sample['id'],
	label: 'plan',
	load: () => Promise.resolve({ entry: 'plan.tjp', files: { 'plan.tjp': TEXT } }),
};

let app: AppState | null = null;
afterEach(() => {
	app?.dispose();
	app = null;
});

async function open(): Promise<{ a: AppState; views: string[] }> {
	const client = new FakeEngineClient();
	app = new AppState({ client, samples: [sample], initial: 'plan', keyTarget: null });
	await flush();
	const a = task('a', 4, 600);
	const b = task('b', 5, 1500);
	for (const [t, who] of [
		[a, 'dev'],
		[b, 'ops'],
	] as const) {
		const s = t.scenarios['plan'];
		if (s) s.allocated = [who];
	}
	client.done(1, { tasks: [a, b] });
	await vi.waitFor(() => expect(app?.status?.kind).toBe('ok'));
	const views: string[] = [];
	app.shell = {
		editorShown: () => false,
		showInText: vi.fn(),
		showView: (v) => void views.push(v),
	};
	return { a: app, views };
}

describe('Show in Gantt for a person', () => {
	it('filters to the person when they are on the task, selects it and shows the Gantt', async () => {
		const { a, views } = await open();
		await a.showInGantt('a', 'dev');
		expect(a.ganttFilter.person).toBe('dev');
		expect(a.selection.current).toMatchObject({ kind: 'task', id: 'a' });
		expect(views).toEqual(['gantt']);
	});

	it('does not leave a filter that would hide the task: it is dropped', async () => {
		const { a } = await open();
		a.ganttFilter.showPerson('ops');
		// Alpha is Dev's: the cell of Dev showed it, so the chart must too.
		await a.showInGantt('a', 'dev');
		expect(a.ganttFilter.person).toBe('dev');
		// A task the person is not on is selected without any filter.
		await a.showInGantt('b', 'dev');
		expect(a.ganttFilter.person).toBeNull();
		expect(a.selection.current).toMatchObject({ kind: 'task', id: 'b' });
	});

	it('a task with no person (a group cell) is selected and the filter is left alone', async () => {
		const { a, views } = await open();
		a.ganttFilter.showPerson('ops');
		await a.showInGantt('b', null);
		expect(a.ganttFilter.person).toBe('ops');
		expect(views).toEqual(['gantt']);
	});
});

describe('Open in Workload', () => {
	it('selects the person, shows the heatmap and files one request per call', async () => {
		const { a, views } = await open();
		a.openInWorkload('dev', 600);
		expect(a.selection.current).toMatchObject({ kind: 'resource', id: 'dev' });
		expect(views).toEqual(['workload']);
		const first = a.peopleGoto;
		expect(first).toMatchObject({ resource: 'dev', at: 600 });
		a.openInWorkload('dev', 600);
		expect(a.peopleGoto?.serial).toBe((first?.serial ?? 0) + 1);
	});
});

describe('Why here?', () => {
	it('selects the task and asks the details for it, for that selection', async () => {
		const { a } = await open();
		a.showWhy('b');
		expect(a.selection.current).toMatchObject({ kind: 'task', id: 'b' });
		expect(a.inspector.sheet).toBe(true);
		expect(a.inspector.why).toEqual({ task: 'b', serial: a.selection.serial });
	});
});

describe('the app keeps plan health', () => {
	it('has a closed panel and no count before a result is checked', async () => {
		const { a } = await open();
		expect(a.health.open).toBe(false);
		expect(a.health.count).toBeNull();
	});
});
