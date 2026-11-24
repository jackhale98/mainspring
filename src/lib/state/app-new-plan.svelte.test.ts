// SPDX-License-Identifier: GPL-2.0-or-later
// "New plan…" in the app state (ADR-0013 #2): the plan is the header only, opens in this tab with
// an empty history, is listed as "Name (new)", and is replaced by another new plan or a sample
// with a question once it was edited.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../strings';
import type { Sample } from '../workspace/samples';
import { FakeEngineClient, flush, message, task } from '../workspace/testing/fake-engine-client';
import { AppState } from './app.svelte';

const PLAN = 'project p "P" 2026-01-05 +1m\ntask a "Alpha" { effort 1d }\n';
const A: Sample = {
	id: 'one' as Sample['id'],
	label: 'one',
	load: () => Promise.resolve({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } }),
};

let app: AppState | null = null;
afterEach(() => {
	app?.dispose();
	app = null;
});

async function open(confirm = () => true): Promise<AppState> {
	app = new AppState({ client: new FakeEngineClient(), samples: [A], confirm });
	await flush();
	return app;
}

const SPEC = { name: 'Website', start: '2026-11-16', timezone: 'Europe/Berlin' };
const HEADER = 'project website "Website" 2026-11-16 +1y {\n  timezone "Europe/Berlin"\n}\n';

function type(a: AppState, insert: string): void {
	const ws = a.workspace;
	const state = ws?.state('plan.tjp');
	if (!ws || !state) throw new Error('no workspace');
	ws.commit(
		'plan.tjp',
		state.update({ changes: { from: 0, insert }, userEvent: 'input.type' }),
		'typing',
	);
}

describe('openNewPlan', () => {
	it('opens the header as the plan, with an empty history, listed as "Name (new)"', async () => {
		const a = await open();
		expect(await a.openNewPlan(SPEC)).toBe(true);
		expect(a.phase).toBe('ready');
		expect(a.planKey).toBe('new');
		expect(a.activeFile).toBe('plan.tjp');
		expect(a.files).toEqual(['plan.tjp']);
		expect(a.workspace?.texts()).toEqual({ 'plan.tjp': HEADER });
		expect(a.dirty).toBe(false);
		expect(a.history.canUndo).toBe(false);
		expect(a.history.canRedo).toBe(false);
		expect(a.fresh).toBe(true);
		expect(a.planLabel).toBe('Website (new)');
		expect(a.planLabel).toBe(strings.newPlan.listed('Website'));
	});

	it('writes no timezone for None (UTC)', async () => {
		const a = await open();
		await a.openNewPlan({ name: 'Launch plan', start: '2027-01-04', timezone: null });
		expect(a.workspace?.texts()['plan.tjp']).toBe(
			'project launch_plan "Launch plan" 2027-01-04 +1y\n',
		);
	});

	it('does not open a plan the text cannot hold', async () => {
		const a = await open();
		const ws = a.workspace;
		expect(await a.openNewPlan({ ...SPEC, name: '  ' })).toBe(false);
		expect(a.planKey).toBe('one');
		expect(a.workspace).toBe(ws);
	});

	it('is replaced by a sample without asking while unedited, and the label goes back', async () => {
		const confirm = vi.fn(() => false);
		const a = await open(confirm);
		await a.openNewPlan(SPEC);
		expect(await a.openSample('one')).toBe(true);
		expect(confirm).not.toHaveBeenCalled();
		expect(a.planKey).toBe('one');
		expect(a.fresh).toBe(false);
		expect(a.planLabel).toBe('one');
	});

	it('asks first when the new plan was edited and the store cannot keep it, for a sample and for another new plan', async () => {
		// No IndexedDB here (jsdom): the new plan stays in memory, so its changes would be lost.
		const confirm = vi.fn(() => false);
		const a = await open(confirm);
		await a.openNewPlan(SPEC);
		const ws = a.workspace;
		type(a, '# edited\n');
		expect(a.dirty).toBe(true);

		expect(await a.openSample('one')).toBe(false);
		expect(await a.openNewPlan({ ...SPEC, name: 'Other' })).toBe(false);
		expect(confirm).toHaveBeenCalledTimes(2);
		expect(confirm).toHaveBeenCalledWith(strings.topBar.confirmSwitch);
		expect(a.workspace).toBe(ws);
		expect(a.planLabel).toBe('Website (new)');

		confirm.mockReturnValue(true);
		expect(await a.openNewPlan({ ...SPEC, name: 'Other' })).toBe(true);
		expect(a.planLabel).toBe('Other (new)');
		expect(a.workspace).not.toBe(ws);
		expect(a.dirty).toBe(false);
		// Each plan that opens counts: the views start over for it (plan-follow.ts).
		expect(a.openSerial).toBe(3);
	});

	it('is an empty plan, not an error, once the engine answers no_tasks', async () => {
		const client = new FakeEngineClient();
		app = new AppState({ client, samples: [A], confirm: () => true });
		await flush();
		await app.openNewPlan(SPEC);
		await flush();
		client.done(client.requests.at(-1)?.revision ?? 1, {
			ok: false,
			tasks: [],
			messages: [{ ...message('error', null, 'No tasks'), id: 'no_tasks', file: null }],
		});
		await vi.waitFor(() => expect(app?.status?.kind).toBe('empty'));
		expect(app.emptyPlan).toBe(true);
		expect(app.status).toMatchObject({ label: strings.status.empty, errors: 0, unlocated: [] });
	});

	describe('the empty state (emptyPlan)', () => {
		const withText = (text: string): Sample => ({
			id: 'one' as Sample['id'],
			label: 'one',
			load: () => Promise.resolve({ entry: 'plan.tjp', files: { 'plan.tjp': text } }),
		});
		async function openText(text: string): Promise<{ a: AppState; client: FakeEngineClient }> {
			const client = new FakeEngineClient();
			app = new AppState({ client, samples: [withText(text)], confirm: () => true });
			await flush();
			return { a: app, client };
		}

		it('is not shown for a plan whose tasks all come from a macro, which the engine schedules', async () => {
			const { a, client } = await openText(
				'macro mk [task a "A" { effort 1d }]\nproject p "P" 2026-01-05 +1m\n${mk}\n',
			);
			client.done(client.requests.at(-1)?.revision ?? 1, { tasks: [task('a', 3, 600)] });
			await vi.waitFor(() => expect(a.status?.kind).toBe('ok'));
			expect(a.emptyPlan).toBe(false);
			// Touching the macro's definition drops the engine's hints for the tasks it makes, so the
			// outline has none until the next result, while the engine's last answer is a schedule.
			const ws = a.workspace;
			const at = ws?.texts()['plan.tjp']?.indexOf('effort') ?? -1;
			const state = ws?.state('plan.tjp');
			if (!ws || !state || at < 0) throw new Error('no workspace');
			ws.commit(
				'plan.tjp',
				state.update({ changes: { from: at, insert: ' ' }, userEvent: 'input.type' }),
				'typing',
			);
			await vi.waitFor(() => expect(a.outline.tasks).toHaveLength(0), { timeout: 3000 });
			expect(a.status?.kind).not.toBe('errors');
			expect(a.emptyPlan).toBe(false);
		});

		it('is not shown while a run waits on a text with a syntax error', async () => {
			const { a } = await openText('project p "P" 2026-01-05 +1m\ntask {\n');
			expect(a.run?.latest).toBeNull();
			expect(a.localDiagnostics.some((d) => d.severity === 'error')).toBe(true);
			expect(a.emptyPlan).toBe(false);
		});

		it('is shown before the first result for a clean header-only text, and not for a failure', async () => {
			const { a, client } = await openText('project p "P" 2026-01-05 +1m\n');
			expect(a.run?.latest).toBeNull();
			expect(a.emptyPlan).toBe(true);
			client.done(client.requests.at(-1)?.revision ?? 1, {
				ok: false,
				tasks: [],
				messages: [message('error', 1, 'broken')],
			});
			await vi.waitFor(() => expect(a.status?.kind).toBe('errors'));
			expect(a.emptyPlan).toBe(false);
		});
	});

	it('asks first when it replaces an edited sample', async () => {
		const confirm = vi.fn(() => false);
		const a = await open(confirm);
		type(a, '# edited\n');
		expect(await a.openNewPlan(SPEC)).toBe(false);
		expect(confirm).toHaveBeenCalledOnce();
		expect(a.planKey).toBe('one');
	});
});
