// SPDX-License-Identifier: GPL-2.0-or-later
import { Transaction } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../strings';
import type { Sample } from '../workspace/samples';
import { FakeEngineClient, flush, message, task } from '../workspace/testing/fake-engine-client';
import { AppState } from './app.svelte';

const PLAN = [
	'project p "P" 2026-01-05 +1m',
	'task a "Alpha" { effort 1d }',
	'task b "Beta" { effort 2d }',
	'',
].join('\n');

function sample(id: string, files: Record<string, string>, entry = 'plan.tjp'): Sample {
	return { id: id as Sample['id'], label: id, load: () => Promise.resolve({ entry, files }) };
}

const A = sample('one', { 'plan.tjp': PLAN });
const B = sample('two', { 'plan.tjp': PLAN + 'include "x.tji"\n', 'x.tji': 'task c "C"\n' });

let app: AppState | null = null;
afterEach(() => {
	app?.dispose();
	app = null;
	vi.useRealTimers();
});

async function open(confirm = () => true): Promise<{ app: AppState; client: FakeEngineClient }> {
	const client = new FakeEngineClient();
	app = new AppState({ client, samples: [A, B], confirm });
	await flush();
	return { app, client };
}

describe('AppState', () => {
	it('opens the first sample and follows the runner', async () => {
		const { app, client } = await open();
		expect(app.phase).toBe('ready');
		expect(app.sampleId).toBe('one');
		expect(app.activeFile).toBe('plan.tjp');
		expect(app.files).toEqual(['plan.tjp']);
		expect(app.status?.kind).toBe('scheduling');
		client.done(1, { tasks: [task('a', 2, 600), task('b', 3, 1500)] });
		// The runner shows a result in an idle task (Node: a 50 ms timer).
		await vi.waitFor(() => expect(app.status?.kind).toBe('ok'));
		expect(app.status).toMatchObject({ kind: 'ok', counts: strings.status.counts(0, 0) });
		expect(app.outline.tasks.map((n) => n.localId)).toEqual(['a', 'b']);
	});

	it('asks before replacing an edited plan, and keeps it when declined', async () => {
		const confirm = vi.fn(() => false);
		const { app } = await open(confirm);
		expect(await app.openSample('two')).toBe(true);
		expect(app.files).toEqual(['plan.tjp', 'x.tji']);
		const ws = app.workspace;
		const state = ws?.state('plan.tjp');
		if (!ws || !state) throw new Error('no workspace');
		ws.commit('plan.tjp', state.update({ changes: { from: 0, insert: '# hi\n' } }), 'typing');
		expect(app.dirty).toBe(true);
		expect(await app.openSample('one')).toBe(false);
		expect(confirm).toHaveBeenCalledWith(strings.topBar.confirmSwitch);
		expect(app.sampleId).toBe('two');
		expect(app.workspace).toBe(ws);
	});

	it('replaces the plan when the switch is confirmed', async () => {
		const { app } = await open(() => true);
		const first = app.workspace;
		expect(await app.openSample('two')).toBe(true);
		expect(app.workspace).not.toBe(first);
		expect(app.dirty).toBe(false);
	});

	it('reveals a range in another file and switches to the Text panel', async () => {
		const { app } = await open();
		await app.openSample('two');
		app.phoneTab = 'plan';
		app.revealRange('x.tji', 5, 6);
		expect(app.activeFile).toBe('x.tji');
		expect(app.phoneTab).toBe('text');
		expect(app.reveal).toMatchObject({ file: 'x.tji', from: 5, to: 6 });
		app.openFile('nope.tji');
		expect(app.activeFile).toBe('x.tji');
	});

	it('undoes across files through app.history, revealing and naming the change', async () => {
		const { app } = await open();
		await app.openSample('two');
		const ws = app.workspace;
		if (!ws) throw new Error('no workspace');
		expect(app.history.canUndo).toBe(false);
		const typed = ws.state('x.tji').update({
			changes: { from: 0, insert: '# x\n' },
			userEvent: 'input.type',
		});
		ws.commit('x.tji', typed, 'typing');
		expect(app.history.canUndo).toBe(true);
		expect(app.history.undoLabel).toBe('Undo: typing');
		// The editor shows plan.tjp: the undo opens x.tji at the change and says what it undid.
		expect(app.activeFile).toBe('plan.tjp');
		app.phoneTab = 'plan';
		expect(app.history.undo()).toBe(true);
		expect(ws.texts()['x.tji']).toBe('task c "C"\n');
		expect(app.activeFile).toBe('x.tji');
		expect(app.phoneTab).toBe('plan');
		expect(app.reveal).toMatchObject({
			file: 'x.tji',
			from: 0,
			to: 0,
			focus: false,
			select: false,
		});
		expect(app.note).toBe(strings.history.undone('typing', 'x.tji'));
		expect(app.history.redoLabel).toBe('Redo: typing');
		expect(app.history.redo()).toBe(true);
		expect(ws.texts()['x.tji']).toBe('# x\ntask c "C"\n');
	});

	describe('rewindHistory (the phone History sheet)', () => {
		async function typed3() {
			const { app } = await open();
			await app.openSample('two');
			const ws = app.workspace;
			if (!ws) throw new Error('no workspace');
			const before = ws.texts();
			// Three entries (time apart, so they do not group): one in x.tji, two in plan.tjp.
			const type = (path: string, insert: string, time: number) =>
				ws.commit(
					path,
					ws.state(path).update({
						changes: { from: 0, insert },
						userEvent: 'input.type',
						annotations: [Transaction.time.of(time)],
					}),
					'typing',
				);
			type('x.tji', '# 1\n', 1000);
			type('plan.tjp', '# 2\n', 5000);
			type('x.tji', '# 3\n', 9000);
			return { app, ws, before };
		}

		it('lists the stack newest first and rewinds N steps in one go, then redo steps forward', async () => {
			const { app, ws, before } = await typed3();
			expect(app.history.items().map((i) => i.files[0])).toEqual(['x.tji', 'plan.tjp', 'x.tji']);
			app.rewindHistory(3);
			expect(ws.texts()).toEqual(before);
			// The compact message names what happened; the editor's per-step note stays quiet.
			expect(app.edits?.toasts.at(-1)?.text).toBe(strings.history.rewound(3));
			expect(app.note).toBeNull();
			expect(app.history.redoLabel).toBe('Redo: typing');
			expect(app.history.redo()).toBe(true);
			expect(ws.texts()['x.tji']).toBe(`# 1\n${before['x.tji']}`);
			expect(ws.texts()['plan.tjp']).toBe(before['plan.tjp']);
		});

		it('does nothing for a count beyond the stack', async () => {
			const { app, ws } = await typed3();
			const text = ws.texts();
			app.rewindHistory(4);
			app.rewindHistory(0);
			expect(ws.texts()).toEqual(text);
		});

		it('stops with a sticky message where an undo is refused, and applies nothing past it', async () => {
			const { app, ws } = await typed3();
			// x.tji changes outside the history after the newest entry was made.
			ws.commit(
				'x.tji',
				ws.state('x.tji').update({
					changes: { from: 0, insert: 'Z' },
					annotations: [Transaction.addToHistory.of(false)],
				}),
				'typing',
			);
			const text = ws.texts();
			app.rewindHistory(3);
			// The newest entry (x.tji) diverges at once: nothing was undone.
			expect(ws.texts()).toEqual(text);
			const last = app.edits?.toasts.at(-1);
			expect(last?.status).toBe('refused');
			expect(last?.text).toBe(strings.history.rewindStopped(0, 3));
			expect(app.history.canUndo).toBe(false);
		});

		it('waits for a held Android key, and refuses when the top changed meanwhile', async () => {
			const { app, ws } = await typed3();
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			try {
				let held = true;
				app.editorKeys = { keyHeld: () => held };
				const text = ws.texts();
				app.rewindHistory(2);
				expect(ws.texts()).toEqual(text);
				// Typing lands while the key is held: the entries it was asked about are no longer on top.
				ws.commit(
					'plan.tjp',
					ws.state('plan.tjp').update({
						changes: { from: 0, insert: '# 4\n' },
						userEvent: 'input.type',
						annotations: [Transaction.time.of(20_000)],
					}),
					'typing',
				);
				held = false;
				await vi.advanceTimersByTimeAsync(40);
				expect(app.edits?.toasts.at(-1)?.text).toBe(strings.history.rewindChanged);
				expect(ws.texts()['plan.tjp']).toContain('# 4');
			} finally {
				vi.useRealTimers();
			}
		});
	});

	it('maps an outline node through the edits made since the index', async () => {
		const { app, client } = await open();
		client.done(1, { tasks: [task('a', 2, 600), task('b', 3, 1500)] });
		await flush();
		const node = app.outline.tasks[1];
		const ws = app.workspace;
		if (!node || !ws) throw new Error('no node');
		const before = node.at.from;
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		// Type at the start: the index (of the old version) lags behind the text.
		const state = ws.state('plan.tjp');
		ws.commit('plan.tjp', state.update({ changes: { from: 0, insert: '# x\n' } }), 'typing');
		app.revealNode(node);
		expect(app.reveal?.from).toBe(before + 4);
		expect(app.outlineOpen).toBe(false);
	});

	it('selects a task from the Gantt: its source is marked, no focus, no tab switch', async () => {
		const { app, client } = await open();
		client.done(1, { tasks: [task('a', 2, 600), task('b', 3, 1500)] });
		await flush();
		app.phoneTab = 'gantt';
		const node = app.outline.byKey.get('task:b');
		if (!node) throw new Error('no node');
		app.selectTask('task:b');
		expect(app.selectedTask).toBe('task:b');
		expect(app.phoneTab).toBe('gantt');
		// The editor shows the block and, without the focus, puts its cursor on the id (the panel does).
		expect(app.reveal).toBeNull();
		expect(app.sourceMark).toMatchObject({
			file: 'plan.tjp',
			from: node.block.from,
			to: node.block.to,
			scroll: true,
			cursor: { from: node.at.from, to: node.at.to },
		});
		// A task the outline does not know is selected without moving the editor.
		app.selectTask('task:gone');
		expect(app.selectedTask).toBe('task:gone');
		expect(app.sourceMark).toBeNull();
		// Opening another plan clears the selection.
		await app.openSample('two');
		expect(app.selectedTask).toBeNull();
	});

	it('toggles outline nodes', async () => {
		const { app } = await open();
		app.toggleNode('task:a');
		expect(app.collapsed.has('task:a')).toBe(true);
		app.toggleNode('task:a');
		expect(app.collapsed.has('task:a')).toBe(false);
	});

	it('jumps to the next problem, wrapping, and reports none when there is none', async () => {
		const { app, client } = await open();
		expect(app.goToNextProblem()).toBe(false);
		client.done(1, {
			ok: false,
			tasks: [],
			messages: [message('error', 2, 'bad a'), message('warning', 3, 'odd b')],
		});
		await vi.waitFor(() => expect(app.run?.latest?.revision).toBe(1));
		expect(app.goToNextProblem()).toBe(true);
		const first = app.reveal;
		expect(first?.file).toBe('plan.tjp');
		expect(app.diagnostics.filter((d) => d.precision !== 'none').length).toBeGreaterThan(1);
	});

	it('retries by running the scheduler at once', async () => {
		const { app, client } = await open();
		client.fail(1, { kind: 'crash', message: 'trap' });
		await flush();
		expect(app.status?.kind).toBe('failed');
		app.retry();
		await flush();
		expect(client.requests.length).toBe(2);
	});

	it('reports a sample that cannot load', async () => {
		const client = new FakeEngineClient();
		const bad: Sample = {
			id: 'bad' as Sample['id'],
			label: 'Bad',
			load: () => Promise.reject(new Error('x')),
		};
		app = new AppState({ client, samples: [bad] });
		await flush();
		expect(app.phase).toBe('failed');
		expect(app.loadError).toBe(strings.topBar.loadFailed('Bad'));
	});

	it('checks zone-dependent values: Kathmandu with a 30 minute timing resolution', async () => {
		const kathmandu = sample('kathmandu', {
			'plan.tjp': [
				'project p "P" 2026-01-05 +1m {',
				'  timezone "Asia/Kathmandu"',
				'  timingresolution 30min',
				'}',
				'task t "T" { effort 1d }',
				'',
			].join('\n'),
		});
		const client = new FakeEngineClient();
		app = new AppState({ client, samples: [kathmandu] });
		await flush();
		const found = app.localDiagnostics.filter((d) => d.source === 'value');
		expect(found.length).toBeGreaterThan(0);
		expect(app.status?.errors).toBeGreaterThan(0);
		// The marks go to the editor's local channel, with a place in the text.
		expect(found.every((d) => d.file === 'plan.tjp' && d.precision !== 'none')).toBe(true);
	});
});
