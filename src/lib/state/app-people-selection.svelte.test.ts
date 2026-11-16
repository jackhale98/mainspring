// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// The People selections in the app (phase-3.md 6.7, T13): a person and a heatmap cell show the
// person's declaration in the editor (`sourceMark`), days show nothing, and all of them go through
// a task's rename, an index that catches up with the text, and an undo and redo of Add person
// (a person that is gone stays selected and shows no mark, and the mark returns with the person).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { addPersonFlow } from '../people/add-person';
import type { Sample } from '../workspace/samples';
import { FakeEngineClient, flush, task } from '../workspace/testing/fake-engine-client';
import { AppState } from './app.svelte';

const WITH_PEOPLE = [
	'project p "P" 2026-01-05 +1m',
	'resource dev "Dev"',
	'resource ops "Ops"',
	'task a "Alpha" { effort 1d }',
	'task b "Beta" { effort 2d }',
	'',
].join('\n');
const NO_PEOPLE = ['project p "P" 2026-01-05 +1m', 'task a "Alpha" { effort 1d }', ''].join('\n');

const sample = (id: string, text: string): Sample => ({
	id: id as Sample['id'],
	label: id,
	load: () => Promise.resolve({ entry: 'plan.tjp', files: { 'plan.tjp': text } }),
});

let app: AppState | null = null;
afterEach(() => {
	app?.dispose();
	app = null;
});

async function open(id: 'people' | 'none'): Promise<AppState> {
	const client = new FakeEngineClient();
	app = new AppState({
		client,
		samples: [sample('people', WITH_PEOPLE), sample('none', NO_PEOPLE)],
		initial: id,
		keyTarget: null,
	});
	await flush();
	client.done(1, { tasks: [task('a', 2, 600), task('b', 5, 1500)] });
	await vi.waitFor(() => expect(app?.status?.kind).toBe('ok'));
	return app;
}

const text = (a: AppState): string =>
	a.workspace?.snapshot().files.get('plan.tjp')?.text.toString() ?? '';
const marked = (a: AppState): string | null =>
	a.sourceMark === null ? null : text(a).slice(a.sourceMark.from, a.sourceMark.to);

describe('a person in the editor', () => {
	it('marks the declaration of a selected person and of the person of a cell, not of days', async () => {
		const a = await open('people');
		a.selection.selectResource('ops', 'visual');
		expect(marked(a)).toBe('resource ops "Ops"');
		expect(a.sourceMark?.scroll).toBe(true);
		expect(text(a).slice(a.sourceMark?.cursor?.from, a.sourceMark?.cursor?.to)).toBe('ops');
		a.selection.selectCell('dev', 4, 'week');
		expect(marked(a)).toBe('resource dev "Dev"');
		a.selection.selectDays({ kind: 'global' }, 0, 1440);
		expect(a.sourceMark).toBeNull();
		// A person nothing declares shows nothing, and stays selected.
		a.selection.selectResource('ghost', 'visual');
		expect(a.sourceMark).toBeNull();
		expect(a.selection.person).toBe('ghost');
	});

	it('leaves a person from the text unmarked, as a task from the text is', async () => {
		const a = await open('people');
		a.selection.selectResource('dev', 'text');
		expect(a.sourceMark).toBeNull();
	});

	it('moves the mark when the index catches up with text typed above it, without scrolling', async () => {
		const a = await open('people');
		a.selection.selectResource('dev', 'visual');
		const m = a.sourceMark;
		const ws = a.workspace;
		if (!ws) throw new Error('no workspace');
		ws.commit(
			'plan.tjp',
			ws.state('plan.tjp').update({ changes: { from: 0, insert: '# top\n' } }),
			'typing',
		);
		expect(a.sourceMark).toBe(m);
		await vi.waitFor(() => {
			expect(a.run?.indexVersion).toBe(a.run?.version);
			expect(a.sourceMark).not.toBe(m);
		});
		expect(a.sourceMark?.scroll).toBe(false);
		expect(a.sourceMark?.from).toBe((m?.from ?? 0) + 6);
		expect(marked(a)).toBe('resource dev "Dev"');
	});

	it('stays selected through a task rename that has the same id, and through its undo', async () => {
		const a = await open('people');
		const edits = a.edits;
		if (!edits) throw new Error('no dispatcher');
		a.selection.selectResource('dev', 'visual');
		// A task called like the person: its rename is not the person's.
		const o = await edits.dispatch(
			{ type: 'renameTask', task: 'a', name: 'Dev', id: 'dev' },
			{ label: { text: 'Rename Alpha', approx: false } },
		);
		expect(o.status).toBe('applied');
		flushSync();
		expect(a.selection.current).toEqual({ kind: 'resource', id: 'dev', origin: 'visual' });
		expect(a.history.undo()).toBe(true);
		expect(a.selection.current).toEqual({ kind: 'resource', id: 'dev', origin: 'visual' });
		expect(a.history.redo()).toBe(true);
		expect(a.selection.person).toBe('dev');
	});

	it('forgets the selection when another plan opens', async () => {
		const a = await open('people');
		a.selection.selectCell('dev', 1, 'day');
		await a.openSample('none');
		expect(a.selection.current).toBeNull();
		expect(a.sourceMark).toBeNull();
	});
});

describe('moving about the heatmap', () => {
	it('marks nothing again for another cell of the same person, and once for another person', async () => {
		const a = await open('people');
		a.selection.selectCell('dev', 0, 'week');
		const first = a.sourceMark;
		expect(first?.scroll).toBe(true);
		expect(marked(a)).toBe('resource dev "Dev"');
		a.selection.selectCell('dev', 1, 'week');
		a.selection.selectCell('dev', 2, 'day');
		expect(a.sourceMark).toBe(first);
		// The same cell again changes nothing either.
		a.selection.selectCell('dev', 2, 'day');
		expect(a.sourceMark).toBe(first);
		a.selection.selectCell('ops', 1, 'week');
		expect(marked(a)).toBe('resource ops "Ops"');
		expect(a.sourceMark?.scroll).toBe(true);
		const second = a.sourceMark;
		a.selection.selectCell('ops', 4, 'week');
		expect(a.sourceMark).toBe(second);
	});

	it('does not switch the editor file for a person while no editor is on screen', async () => {
		const client = new FakeEngineClient();
		app = new AppState({
			client,
			samples: [
				{
					id: 'two' as Sample['id'],
					label: 'two',
					load: () =>
						Promise.resolve({
							entry: 'plan.tjp',
							files: {
								'plan.tjp': WITH_PEOPLE.replace('resource dev "Dev"\n', '') + 'include "x.tji"\n',
								'x.tji': 'resource dev "Dev"\n',
							},
						}),
				},
			],
			initial: 'two',
			keyTarget: null,
		});
		await flush();
		client.done(1, { tasks: [task('a', 2, 600), task('b', 5, 1500)] });
		await vi.waitFor(() => expect(app?.status?.kind).toBe('ok'));
		const a = app;
		expect(a.activeFile).toBe('plan.tjp');
		a.shell = { editorShown: () => false, showInText: vi.fn() };
		a.selection.selectResource('dev', 'visual');
		expect(a.sourceMark?.file).toBe('x.tji');
		expect(a.activeFile).toBe('plan.tjp');
		// With an editor on screen the file is shown, as for a task.
		a.shell = { editorShown: () => true, showInText: vi.fn() };
		a.selection.selectResource('ops', 'visual');
		a.selection.selectResource('dev', 'visual');
		expect(a.activeFile).toBe('x.tji');
	});
});

describe('Add person on a plan with no people', () => {
	/** What the "No people" button runs, over the app's own dispatcher. */
	function add(a: AppState): Promise<string | null> {
		return addPersonFlow({
			plan: () => a.edits,
			resources: () => a.outline.resources,
			dispatch: (intent, o) =>
				a.edits ? a.edits.dispatch(intent, o) : Promise.resolve({ status: 'cancelled' }),
			headerOf: (edit) => {
				const at = edit.select;
				return at
					? (a.workspace?.snapshot().files.get(at.file)?.text.sliceString(at.from, at.to) ?? null)
					: null;
			},
			select: (id) => a.selection.selectResource(id, 'visual'),
		});
	}

	it('writes the resource, selects the new person and marks it once the index has it', async () => {
		const a = await open('none');
		expect(a.outline.resources).toHaveLength(0);
		const id = await add(a);
		expect(id).toBe('new_person');
		expect(text(a)).toContain('resource new_person "New person"');
		expect(a.selection.current).toEqual({ kind: 'resource', id: 'new_person', origin: 'visual' });
		await vi.waitFor(() => expect(marked(a)).toBe('resource new_person "New person"'));
		expect(a.sourceMark?.scroll).toBe(true);
		expect(a.outline.resources.map((n) => n.id)).toEqual(['new_person']);
	});

	it('keeps the person selected through undo and redo; the mark goes and returns with them', async () => {
		const a = await open('none');
		await add(a);
		await vi.waitFor(() => expect(marked(a)).not.toBeNull());
		expect(a.history.undo()).toBe(true);
		expect(text(a)).not.toContain('new_person');
		expect(a.selection.person).toBe('new_person');
		await vi.waitFor(() => {
			expect(a.run?.indexVersion).toBe(a.run?.version);
			expect(a.outline.resources).toHaveLength(0);
			expect(a.sourceMark).toBeNull();
		});
		expect(a.history.redo()).toBe(true);
		await vi.waitFor(() => expect(marked(a)).toBe('resource new_person "New person"'));
		expect(a.selection.person).toBe('new_person');
	});

	it('gives the second person its own id and counts both at the top level', async () => {
		const a = await open('none');
		await add(a);
		await vi.waitFor(() => expect(a.outline.resources).toHaveLength(1));
		expect(await add(a)).toBe('new_person_2');
		await vi.waitFor(() => expect(a.outline.resources).toHaveLength(2));
		expect(a.selection.person).toBe('new_person_2');
	});
});
