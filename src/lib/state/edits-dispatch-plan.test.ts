// SPDX-License-Identifier: GPL-2.0-or-later
// `dispatchPlan` (ADR-0018 decision 3) and the checks through the dispatcher: a view planner runs
// on the fresh text on every plan of a call and on a gesture's base for a later call, its answers
// map to outcomes as the contract says, its call carries the stamp and round-trips `basedOn`, and a
// target the text now no longer holds is refused `target-changed` while the published index lags.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ganttActionStrings, refusalStrings, toastStrings } from '../strings';
import type { EditIntent } from '../tjp/edit/types';
import { harness, type Harness } from './edits-testing';
import { COALESCE_MS, type DispatchOutcome, type PlanBase, type ViewPlanner } from './edits.svelte';

const effort = (task: string, value: string): EditIntent => ({
	type: 'setAttr',
	task,
	attr: 'effort',
	value,
});
const label = { text: 'E', approx: false };
/** A planner that sets `task`'s effort, recording each base it was called on. */
function recording(task: string, value: string): { plan: ViewPlanner; seen: PlanBase[] } {
	const seen: PlanBase[] = [];
	return {
		seen,
		plan: (on) => {
			seen.push(on);
			return { status: 'intent', intent: effort(task, value), label };
		},
	};
}

let h: Harness;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	h = harness();
	await h.finish();
});

afterEach(() => {
	h.dispose();
	vi.useRealTimers();
});

function applied(o: DispatchOutcome): Extract<DispatchOutcome, { status: 'applied' }> {
	if (o.status !== 'applied') throw new Error(`expected applied, got ${JSON.stringify(o)}`);
	return o;
}

describe('what a planner answers', () => {
	it('applies its intent as one undo step with its label, planned on the text now', async () => {
		const r = recording('b', '3d');
		h.type('# note\n');
		const o = applied(await h.edits.dispatchPlan(r.plan));
		expect(h.text()).toContain('task b "B" {\n  effort 3d\n}');
		expect(h.history.top()?.label).toBe('E');
		const on = r.seen[0] as PlanBase;
		expect(on.index.version).toBe(on.snap.version);
		expect(on.snap.version).toBe(o.version - 1);
		// The outline is the fresh index's, built once.
		expect(on.outline().version).toBe(on.index.version);
		expect(on.outline()).toBe(on.outline());
	});

	it('maps unchanged to noop with its message, or the usual one', async () => {
		await expect(
			h.edits.dispatchPlan(() => ({ status: 'unchanged', message: 'It cannot move that way.' })),
		).resolves.toEqual({
			status: 'noop',
			reason: 'already-set',
			message: 'It cannot move that way.',
		});
		await expect(h.edits.dispatchPlan(() => ({ status: 'unchanged' }))).resolves.toMatchObject({
			message: ganttActionStrings.noop['already-set'],
		});
		expect(h.edits.toasts.at(-1)).toMatchObject({ status: 'noop' });
	});

	it('maps not-possible to a planner refusal with its sentence and place', async () => {
		const at = { file: 'plan.tjp', from: 0, to: 7 };
		const o = await h.edits.dispatchPlan(() => ({
			status: 'not-possible',
			message: 'Nowhere to put it.',
			at: [at],
		}));
		expect(o).toEqual({
			status: 'refused',
			reason: 'planner',
			at: [at],
			message: 'Nowhere to put it.',
		});
		const toast = h.edits.toasts.at(-1);
		expect(toast).toMatchObject({ status: 'refused', text: 'Nowhere to put it.' });
		h.edits.showToast(toast?.id ?? -1);
		expect(h.reveals).toEqual([at]);
	});

	it('refuses a planner that throws as unprepared', async () => {
		const errors: unknown[] = [];
		const onError = (e: unknown) => errors.push(e);
		process.on('uncaughtException', onError);
		const o = await h.edits.dispatchPlan(() => {
			throw new Error('a bug');
		});
		await new Promise((r) => setImmediate(r));
		process.off('uncaughtException', onError);
		expect(errors).toMatchObject([{ message: 'a bug' }]);
		expect(o).toMatchObject({
			status: 'refused',
			reason: 'unprepared',
			message: toastStrings.unprepared,
		});
	});

	it('runs the planner again on the fresh text when the text moved while it waited', async () => {
		const r = recording('b', '3d');
		h.held = true;
		const p = h.edits.dispatchPlan(r.plan);
		await vi.advanceTimersByTimeAsync(16);
		h.type('\n', h.text().indexOf('task b'));
		h.held = false;
		await vi.advanceTimersByTimeAsync(16);
		applied(await p);
		expect(r.seen.map((b) => b.index.version)).toEqual([
			(r.seen[0] as PlanBase).index.version,
			(r.seen[0] as PlanBase).index.version + 1,
		]);
	});

	it('runs a later call of a gesture on its base for the dry run, then on the text now', async () => {
		const first = recording('b', '3d');
		const later = recording('b', '4d');
		const a = h.edits.dispatchPlan(first.plan, { coalesceKey: 'k' });
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		applied(await a);
		const base = first.seen[0] as PlanBase;
		const b = h.edits.dispatchPlan(later.plan, { coalesceKey: 'k' });
		await vi.advanceTimersByTimeAsync(COALESCE_MS);
		applied(await b);
		expect(later.seen[0]?.index).toBe(base.index);
		expect(later.seen[1]?.snap.version).toBeGreaterThan(base.snap.version);
		expect(h.text()).toContain('effort 4d');
		h.history.undo();
		expect(h.text()).toContain('task b "B" {\n  effort 2d\n}');
	});
});

describe('basedOn on a planned call', () => {
	const SHARED = {
		entry: 'plan.tjp',
		files: {
			'plan.tjp':
				'project p "P" 2026-01-05 +1m\ntask g1 "G1"\ntask g2 "G2"\n' +
				'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
			't.tji': 'task t "T" {\n  effort 1d\n}\n',
		},
	};

	it('gets the stamp, round-trips it through confirm-shared, and isSame reads it', async () => {
		h.dispose();
		h = harness(SHARED);
		await h.finish();
		const shown = h.runner.state.indexVersion;
		h.type('# note\n');
		const seen: boolean[] = [];
		const plan: ViewPlanner = (on) => {
			seen.push(on.isSame('task', 'g1.t'));
			return { status: 'intent', intent: effort('g1.t', '2d'), label };
		};
		const o = await h.edits.dispatchPlan(plan);
		expect(o).toEqual({ status: 'confirm-shared', affects: ['g1.t', 'g2.t'], basedOn: shown });
		const again = applied(
			await h.edits.dispatchPlan(plan, { confirmShared: true, basedOn: shown }),
		);
		expect(h.text('t.tji')).toContain('effort 2d');
		expect(again.version).toBe(h.ws.snapshot().version);
		expect(seen).toEqual([true, true]);
	});
});

describe('target-changed through the dispatcher, while the published index lags', () => {
	beforeEach(async () => {
		h.dispose();
		h = harness({
			entry: 'plan.tjp',
			files: {
				'plan.tjp':
					'project p "P" 2026-01-05 +1m\ntask b "B" {\n  effort 2d\n}\n' +
					'task c "C" {\n  effort 1d\n}\ntask g "G"\n',
			},
		});
		await h.finish();
	});

	it('refuses an id intent after the rename chain, and a planner sees isSame false', async () => {
		const shown = h.runner.state.indexVersion;
		const rename = (task: string, id: string): EditIntent => ({
			type: 'renameTask',
			task,
			name: id.toUpperCase(),
			id,
		});
		applied(await h.edits.dispatch(rename('b', 'd'), { label }));
		applied(await h.edits.dispatch(rename('c', 'b'), { label }));
		// Nothing has been published since: the view still shows the old b.
		expect(h.runner.state.indexVersion).toBe(shown);
		const o = await h.edits.dispatch(effort('b', '5d'), { label });
		expect(o).toEqual({
			status: 'refused',
			reason: 'target-changed',
			at: [],
			message: refusalStrings['target-changed'],
		});
		expect(h.text()).not.toContain('effort 5d');
		let same: boolean | null = null;
		await h.edits.dispatchPlan((on) => {
			same = on.isSame('task', 'b');
			return { status: 'unchanged' };
		});
		expect(same).toBe(false);
		// Read in the version the renames made, it is the task now called b.
		const fresh = h.ws.snapshot().version;
		applied(await h.edits.dispatch(effort('b', '5d'), { label, basedOn: fresh }));
		expect(h.text()).toMatch(/task b "B" \{\n {2}effort 5d/);
	});

	it('lets an unrelated id intent through on the old stamp', async () => {
		const shown = h.runner.state.indexVersion;
		applied(await h.edits.dispatch(effort('c', '4d'), { label }));
		applied(
			await h.edits.dispatch({ type: 'renameTask', task: 'g', name: 'H', id: 'h' }, { label }),
		);
		expect(h.runner.state.indexVersion).toBe(shown);
		applied(await h.edits.dispatch(effort('b', '5d'), { label }));
		expect(h.text()).toContain('task b "B" {\n  effort 5d\n}');
	});

	it('refuses a positional intent whose parent’s children changed, and passes one whose did not', async () => {
		const shown = h.runner.state.indexVersion;
		applied(
			await h.edits.dispatch({ type: 'moveTask', task: 'c', parent: null, index: 0 }, { label }),
		);
		const move: EditIntent = { type: 'moveTask', task: 'g', parent: null, index: 1 };
		await expect(h.edits.dispatch(move, { label, basedOn: shown })).resolves.toMatchObject({
			reason: 'target-changed',
		});
		const into: EditIntent = { type: 'addTask', parent: 'g', index: 0, name: 'N' };
		applied(await h.edits.dispatch(into, { label, basedOn: shown }));
	});
});
