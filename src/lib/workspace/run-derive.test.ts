// SPDX-License-Identifier: GPL-2.0-or-later
// The runner's derive steps (run-derive.ts, phase-2.md 6.9): which step comes next, what each one
// changes, the index of the sent text for engine messages, ensureIndex, and errors that must not
// make a step spin.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeSetOf } from '../tjp/document';
import { Deriver, type Arrival, type StepOutcome } from './run-derive';
import { message, result, task } from './testing/fake-engine-client';
import { FILES } from './testing/history-fixture';
import { applyEdit, PLAN, TASKS, typeInto } from './testing/runner-fixture';
import { createWorkspace, type Workspace } from './workspace';

let clock = 0;
const now = () => clock;

function setup(files: Record<string, string> = { 'plan.tjp': PLAN }): {
	ws: Workspace;
	d: Deriver;
} {
	const ws = createWorkspace({ entry: 'plan.tjp', files });
	return { ws, d: new Deriver(ws, undefined, now) };
}

/** A result of the workspace as it is now (or as `sent`), arrived now. */
function arrival(ws: Workspace, over: Parameters<typeof result>[1] = {}, revision = 1): Arrival {
	const snapshot = ws.snapshot();
	return {
		sent: { revision, snapshot, at: 0 },
		started: 0,
		result: result(revision, over),
		latest: true,
		at: 0,
	};
}

/** The kinds of every step until none is due. */
function drain(d: Deriver, follow = true): string[] {
	const kinds: string[] = [];
	for (let out = d.step(follow); out; out = d.step(follow)) kinds.push(out.kind);
	return kinds;
}

function shownOf(out: StepOutcome | null) {
	if (out?.kind !== 'shown') throw new Error(`expected a shown step, got ${out?.kind ?? 'none'}`);
	return out.shown;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('step order', () => {
	it('shows a result first, then links the index with its hints, then checks', () => {
		const { ws, d } = setup();
		const before = d.view;
		expect(d.due(true)).toBe(false);
		d.accept(arrival(ws, { tasks: TASKS }));
		expect(d.waiting).toBe(1);
		const shown = shownOf(d.step(true));
		expect(shown.hints.tasks.map((h) => h.id)).toEqual(['t1', 'b']);
		expect(d.waiting).toBe(0);
		// Shown with the index it had: the hints come with the next step.
		expect(d.view.index).toBe(before.index);
		expect(d.view.index.tasks.has('t1')).toBe(false);
		expect(d.indexCurrent).toBe(false);
		expect(d.step(true)?.kind).toBe('view');
		expect(d.view.index.tasks.get('t1')?.idSource).toBe('engine');
		expect(d.indexCurrent).toBe(true);
		const linked = d.view;
		expect(d.step(true)?.kind).toBe('view');
		expect(d.view.index).toBe(linked.index);
		expect(d.view.checks).not.toBe(linked.checks);
		expect(d.step(true)).toBeNull();
	});

	it('holds the index and checks back while typing goes on, but not a result', () => {
		const { ws, d } = setup();
		typeInto(ws, '# a\n');
		d.typed();
		expect(d.view).toMatchObject({ version: 1, indexVersion: 0 });
		expect(d.due(false)).toBe(false);
		expect(d.step(false)).toBeNull();
		d.accept(arrival(ws, { tasks: [task('t1', 4, 600), task('b', 7, 1500)] }));
		expect(d.due(false)).toBe(true);
		expect(d.step(false)?.kind).toBe('shown');
		expect(d.step(false)).toBeNull();
		expect(drain(d)).toEqual(['work', 'view', 'view']);
		expect(d.view).toMatchObject({ version: 1, indexVersion: 1, checksVersion: 1 });
	});

	it('links after one scan per file, even when typing goes on between idle tasks', () => {
		const { ws, d } = setup();
		typeInto(ws, '# a\n');
		expect(d.step(true)?.kind).toBe('work');
		typeInto(ws, '# b\n');
		// The file changed again: the link scans it itself, rather than another scan step.
		expect(d.step(true)?.kind).toBe('view');
		expect(d.view.indexVersion).toBe(2);
		typeInto(ws, '# c\n');
		expect(d.step(true)?.kind).toBe('work');
	});

	it('scans one changed file per step before it links', () => {
		const { ws, d } = setup({ ...FILES });
		const snap = ws.snapshot();
		const edit = (path: string, find: string, insert: string) => {
			const file = snap.files.get(path);
			if (!file) throw new Error(path);
			const from = file.text.toString().indexOf(find);
			return changeSetOf({ from, to: from + find.length, insert }, file.text.length);
		};
		const r = ws.apply({
			id: 'two-files',
			intent: { type: 'setAttr' },
			base: { 'a.tji': 0, 'b.tji': 0 },
			changes: { 'a.tji': edit('a.tji', '1d', '2d'), 'b.tji': edit('b.tji', '4d', '5d') },
		});
		expect(r).toBe('applied');
		expect(drain(d)).toEqual(['work', 'work', 'view', 'view']);
		expect(d.view.indexVersion).toBe(ws.snapshot().version);
	});
});

describe('engine messages and the index of the sent text', () => {
	it('links the index first when the text is unchanged since the run', () => {
		const { ws, d } = setup();
		d.accept(arrival(ws, { ok: false, tasks: TASKS, messages: [message('error', 7, 'bad')] }));
		// The view's index has no hints; the messages are refined with one that has them.
		expect(d.step(true)?.kind).toBe('view');
		const shown = shownOf(d.step(true));
		expect(shown.diagnostics.map((x) => [x.line, x.stale])).toEqual([[7, false]]);
		expect(d.view.diagnostics.find((x) => x.source === 'engine')?.line).toBe(7);
	});

	it('builds an index of the sent text when the text changed since the run', () => {
		const { ws, d } = setup();
		const sent = arrival(ws, { ok: false, tasks: TASKS, messages: [message('error', 7, 'bad')] });
		typeInto(ws, '# during the run\n');
		d.typed();
		d.accept(sent);
		expect(d.step(false)?.kind).toBe('work');
		const shown = shownOf(d.step(false));
		// In the sent text, then mapped to the text now.
		expect(shown.diagnostics.map((x) => x.line)).toEqual([7]);
		const now = d.view.diagnostics.find((x) => x.source === 'engine');
		expect(now).toMatchObject({ line: 8, stale: true });
	});

	it('shows a result without messages with no index at all', () => {
		const { ws, d } = setup();
		typeInto(ws, '# a\n');
		d.accept(arrival(ws, { tasks: TASKS }));
		expect(d.step(false)?.kind).toBe('shown');
	});
});

describe('ensureIndex', () => {
	it('returns the view index when it is current', () => {
		const { d } = setup();
		expect(d.ensureIndex()).toBe(d.view.index);
	});

	it('builds the index of the text now once, without changing the view, and the link reuses it', () => {
		const { ws, d } = setup();
		applyEdit(ws, 'setAttr', 'effort 2d', 'effort 3d');
		const view = d.view;
		const index = d.ensureIndex();
		expect(index.version).toBe(ws.snapshot().version);
		expect(d.ensureIndex()).toBe(index);
		expect(d.view).toBe(view);
		// No scan step: the files are known.
		expect(d.step(true)?.kind).toBe('view');
		expect(d.view.index).toBe(index);
	});

	it('uses the hints of a result that arrived and is not shown yet', () => {
		const { ws, d } = setup();
		d.accept(arrival(ws, { tasks: TASKS }));
		expect(d.ensureIndex().tasks.get('t1')?.idSource).toBe('engine');
	});
});

describe('errors', () => {
	it('reports a step that throws, keeps the view, and does not take it again', () => {
		const ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN } });
		let broken = false;
		const failing = new Proxy(ws, {
			get(target, p) {
				if (p === 'changesSince' && broken) {
					return () => {
						throw new Error('broken');
					};
				}
				const v: unknown = Reflect.get(target, p, target);
				return typeof v === 'function' ? v.bind(target) : v;
			},
		});
		const d = new Deriver(failing, undefined, now);
		d.accept(arrival(ws, { tasks: TASKS }));
		drain(d);
		const thrown: unknown[] = [];
		vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((fn) => {
			try {
				fn();
			} catch (e) {
				thrown.push(e);
			}
		});
		typeInto(ws, '# a\n');
		broken = true;
		const view = d.view;
		expect(drain(d)).toEqual(['work', 'work']);
		expect(thrown).toEqual([new Error('broken')]);
		expect(d.view).toBe(view);
		expect(d.due(true)).toBe(false);
		broken = false;
		typeInto(ws, '# b\n');
		expect(drain(d)).toEqual(['work', 'view', 'view']);
		expect(d.view.indexVersion).toBe(2);
	});

	it('shows a result whose diagnostics cannot be derived', () => {
		const { ws, d } = setup();
		const thrown: unknown[] = [];
		vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((fn) => {
			try {
				fn();
			} catch (e) {
				thrown.push(e);
			}
		});
		const bad = arrival(ws, { tasks: TASKS, messages: [message('error', 7)] });
		Object.defineProperty(bad.result, 'messages', {
			get() {
				throw new Error('unreadable');
			},
		});
		d.accept(bad);
		const kinds: string[] = [];
		for (let i = 0; i < 5 && d.waiting > 0; i++) kinds.push(d.step(true)?.kind ?? 'none');
		expect(kinds.at(-1)).toBe('shown');
		expect(d.waiting).toBe(0);
		expect(thrown.length).toBeGreaterThan(0);
	});
});

describe('timings', () => {
	it('adds up the step time a result waited and its longest task', () => {
		const { ws, d } = setup();
		d.accept(arrival(ws, { ok: false, tasks: TASKS, messages: [message('error', 7)] }));
		const tick = vi.fn(() => (clock += 5));
		d.beginTask();
		tick();
		// The link step (5 ms of fake time around it).
		d.step(true);
		d.endTask();
		d.beginTask();
		const out = shownOf(d.step(true));
		expect(out.processMs).toBeGreaterThanOrEqual(0);
		expect(out.longestTaskMs).toBeGreaterThanOrEqual(5);
	});
});
