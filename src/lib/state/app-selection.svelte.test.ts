// @vitest-environment jsdom
// SPDX-License-Identifier: GPL-2.0-or-later
// Selection sync in the app (phase-2.md 6.10, 11.2): the text selects a task and the Gantt is asked
// to follow; a visual selects and the editor is asked to show the source (`sourceMark`), again
// from a fresher index without scrolling; a link marks its depends statement; the selection
// follows a moveTask's new id; a toast's Show opens the source sheet in Visual mode.
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sample } from '../workspace/samples';
import { FakeEngineClient, flush, message, task } from '../workspace/testing/fake-engine-client';
import { AppState } from './app.svelte';

const PLAN = [
	'project p "P" 2026-01-05 +1m',
	'task a "Alpha" {',
	'  effort 1d',
	'}',
	'task b "Beta" {',
	'  depends a',
	'  effort 2d',
	'}',
	'task g "Group"',
	'',
].join('\n');

const SAMPLE: Sample = {
	id: 'one' as Sample['id'],
	label: 'one',
	load: () => Promise.resolve({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } }),
};

const MACRO: Sample = {
	id: 'macro' as Sample['id'],
	label: 'macro',
	load: () =>
		Promise.resolve({
			entry: 'plan.tjp',
			files: {
				'plan.tjp': [
					'project p "P" 2026-01-05 +1m',
					'macro tid [t1]',
					'task ${tid} "M" { effort 1d }',
					'',
				].join('\n'),
			},
		}),
};

let app: AppState | null = null;
afterEach(() => {
	app?.dispose();
	app = null;
	vi.useRealTimers();
});

async function open(id = 'one'): Promise<{ app: AppState; client: FakeEngineClient }> {
	const client = new FakeEngineClient();
	app = new AppState({ client, samples: [SAMPLE, MACRO], initial: id, keyTarget: null });
	await flush();
	client.done(1, {
		tasks: id === 'one' ? [task('a', 2, 600), task('b', 5, 1500), task('g', 9, 2000)] : [],
	});
	await vi.waitFor(() => expect(app?.status?.kind).toBe('ok'));
	return { app, client };
}

const text = (a: AppState): string =>
	a.workspace?.snapshot().files.get('plan.tjp')?.text.toString() ?? '';

describe('text to visual', () => {
	it('selects the task at the cursor from the text, asks the Gantt to follow, marks nothing', async () => {
		const { app } = await open();
		app.cursorMoved('plan.tjp', text(app).indexOf('depends a'));
		expect(app.selection.current).toEqual({ kind: 'task', id: 'b', origin: 'text' });
		expect(app.selectedTask).toBe('task:b');
		expect(app.selection.follow).toMatchObject({ key: 'task:b' });
		expect(app.sourceMark).toBeNull();
		expect(app.reveal).toBeNull();
		// The cursor in the project header: no task there, the selection stays.
		app.cursorMoved('plan.tjp', 4);
		expect(app.selectedTask).toBe('task:b');
	});

	it('does not touch the editor or the follow request while the cursor stays in the task', async () => {
		const { app } = await open();
		app.cursorMoved('plan.tjp', text(app).indexOf('depends a'));
		const follow = app.selection.follow;
		const current = app.selection.current;
		app.cursorMoved('plan.tjp', text(app).indexOf('effort 2d'));
		expect(app.selection.follow).toBe(follow);
		expect(app.selection.current).toBe(current);
	});
});

describe('visual to text', () => {
	it('marks the block of a selected task, scrolling once, and moves the highlight with a fresh index', async () => {
		const { app, client } = await open();
		app.phoneTab = 'gantt';
		app.selectTask('task:b');
		const block = text(app).slice(text(app).indexOf('task b'), text(app).indexOf('task g') - 1);
		const m = app.sourceMark;
		expect(m).toMatchObject({ file: 'plan.tjp', scroll: true });
		expect(text(app).slice(m?.from, m?.to)).toBe(block);
		expect(text(app).slice(m?.cursor?.from, m?.cursor?.to)).toBe('b');
		// A phone stays on its tab, and the editor was not asked for the focus.
		expect(app.phoneTab).toBe('gantt');
		expect(app.reveal).toBeNull();

		// Typed above it, before the index has seen it: the mark does not move by itself ...
		const ws = app.workspace;
		if (!ws) throw new Error('no workspace');
		ws.commit(
			'plan.tjp',
			ws.state('plan.tjp').update({ changes: { from: 0, insert: '# top\n' } }),
			'typing',
		);
		expect(app.sourceMark).toBe(m);
		// ... and when the index catches up it is made again at the new place, without a scroll.
		await vi.waitFor(() => {
			expect(app.run?.indexVersion).toBe(app.run?.version);
			expect(app.sourceMark).not.toBe(m);
		});
		const after = app.sourceMark;
		expect(after?.scroll).toBe(false);
		expect(after?.from).toBe((m?.from ?? 0) + 6);
		expect(client.requests.length).toBeGreaterThan(0);
	});

	it('shows the source of a click on the same row again, and clears it for the text', async () => {
		const { app } = await open();
		app.selectTask('task:a');
		const first = app.sourceMark;
		app.selectTask('task:a');
		expect(app.sourceMark).not.toBe(first);
		expect(app.sourceMark?.scroll).toBe(true);
		app.cursorMoved('plan.tjp', text(app).indexOf('depends a'));
		expect(app.sourceMark).toBeNull();
	});

	it('marks the depends statement of a selected link, and drops it for a task', async () => {
		const { app } = await open();
		app.selectTask('task:a');
		app.inspector.showLink('a', 'b');
		expect(app.selectedTask).toBeNull();
		expect(app.inspector.link).toEqual({ pred: 'a', succ: 'b' });
		const m = app.sourceMark;
		expect(text(app).slice(m?.from, m?.to)).toBe('depends a');
		expect(m?.scroll).toBe(true);
		app.selectTask('task:b');
		expect(app.inspector.link).toBeNull();
		expect(text(app).slice(app.sourceMark?.from, app.sourceMark?.to)).toMatch(/^task b/);
	});

	it('marks the outline place of a declaration the index cannot name', async () => {
		const { app } = await open('macro');
		const node = app.outline.tasks.find((n) => n.id === null);
		if (!node) throw new Error('no unresolved node');
		app.selectTask(node.key);
		const m = app.sourceMark;
		expect(text(app).slice(m?.from, m?.to)).toBe('task ${tid} "M" { effort 1d }');
		// A key nothing knows is selected, and shows nothing.
		app.selectTask('task:nobody');
		expect(app.selectedTask).toBe('task:nobody');
		expect(app.sourceMark).toBeNull();
	});

	it('forgets the selection and the mark when another plan opens', async () => {
		const { app } = await open();
		app.selectTask('task:a');
		app.inspector.showLink('a', 'b');
		expect(app.sourceMark).not.toBeNull();
		await app.openSample('macro');
		expect(app.selection.current).toBeNull();
		expect(app.sourceMark).toBeNull();
		expect(app.inspector.link).toBeNull();
	});
});

describe('renames', () => {
	it('moves the selection to the new id while a moveTask is pending', async () => {
		const { app, client } = await open();
		app.selectTask('task:b');
		const edits = app.edits;
		if (!edits) throw new Error('no dispatcher');
		const o = await edits.dispatch(
			{ type: 'moveTask', task: 'b', parent: 'g', index: 0 },
			{ label: { text: 'Move Beta', approx: false } },
		);
		expect(o.status).toBe('applied');
		expect(edits.pending.renames.get('b')).toBe('g.b');
		flushSync();
		expect(app.selection.current).toEqual({ kind: 'task', id: 'g.b', origin: 'visual' });
		expect(app.selectedTask).toBe('task:g.b');
		// Settling does not undo it.
		const rev = client.open.at(-1);
		if (rev !== undefined) {
			client.done(rev, { tasks: [task('a', 2, 600), task('g', 5, 2000), task('g.b', 6, 1500)] });
		}
		await flush();
		expect(app.selectedTask).toBe('task:g.b');
	});
});

describe("a toast's Show", () => {
	async function failing(): Promise<{ app: AppState; toast: number }> {
		const { app, client } = await open();
		const o = await app.edits?.dispatch(
			{ type: 'setAttr', task: 'b', attr: 'effort', value: '3d' },
			{ label: { text: 'Effort of Beta', approx: false } },
		);
		if (o?.status !== 'applied') throw new Error('not applied');
		const rev = client.open.at(-1);
		if (rev === undefined) throw new Error('no run');
		client.done(rev, { ok: false, tasks: [], messages: [message('error', 7, 'Beta is bad')] });
		await o.settled;
		return { app, toast: o.toast };
	}

	it('reveals the place in the text where an editor is on screen', async () => {
		const { app, toast } = await failing();
		app.shell = { editorShown: () => true, showInText: vi.fn() };
		app.edits?.showToast(toast);
		expect(app.reveal).toMatchObject({ file: 'plan.tjp' });
		expect(app.inspector.source).toBeNull();
	});

	it('opens the source sheet of the task there in Visual mode', async () => {
		const { app, toast } = await failing();
		const showInText = vi.fn();
		app.shell = { editorShown: () => false, showInText };
		app.edits?.showToast(toast);
		expect(app.inspector.source).toBe('b');
		expect(app.reveal).toBeNull();
		expect(showInText).not.toHaveBeenCalled();
	});

	it('brings the editor on screen for a place that is in no task', async () => {
		const { app } = await open();
		const showInText = vi.fn();
		app.shell = { editorShown: () => false, showInText };
		const o = await app.edits?.dispatch(
			{ type: 'setAttr', task: 'b', attr: 'effort', value: '3d' },
			{ label: { text: 'Effort of Beta', approx: false } },
		);
		expect(o?.status).toBe('applied');
		// The error is on the project line: no task holds it.
		const client = app.client as FakeEngineClient;
		const rev = client.open.at(-1);
		if (rev === undefined || o?.status !== 'applied') throw new Error('no run');
		client.done(rev, { ok: false, tasks: [], messages: [message('error', 1, 'Bad project')] });
		await o.settled;
		app.edits?.showToast(o.toast);
		expect(app.inspector.source).toBeNull();
		expect(showInText).toHaveBeenCalledTimes(1);
	});
});
