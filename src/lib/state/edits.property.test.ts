// SPDX-License-Identifier: GPL-2.0-or-later
// Interleavings of the edit dispatcher's pending and settle state machine (phase-2.md 6.8, 11.2;
// the settle rule in workspace/run-types.ts). Random sequences of intents (some coalesced, some
// with a preview), typing, undo (Mod-Z and the toast's), a held Android key, timers and engine
// outcomes (ok, ok with errors the good run before had or not, not ok, an older run, superseded,
// failed, the engine giving up for a moment or staying down while edits are made), against a real
// workspace, history and runner over the fake engine client, one harness per run. Checked:
// - every apply starts from the file version just before it (never a stale patch), and writes the
//   value asked for;
// - each applied edit settles exactly as the first runner state that includes its version says
//   (the rule and the error baseline are worked out here, not taken from edits-settle.ts), or
//   `undone` (`replaced` for a coalesced one) when the history undid it before that state;
// - at every step: `pending.count` is the number of unsettled edits, a pending toast belongs to
//   one, and only the toast of the history's top entry can undo;
// - after the engine has answered everything, nothing is pending and no toast hangs.
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tjpEditId } from '../workspace/workspace';
import { flush, message } from '../workspace/testing/fake-engine-client';
import type { ScheduleResult } from '../../engine/protocol';
import type { RunnerState } from '../workspace/run-types';
import { harness, type Harness } from './edits-testing';
import type { Settlement } from './edits-settle';
import type { DispatchOutcome } from './edits.svelte';

type Op =
	| { op: 'dispatch'; task: 'b' | 'c'; n: number; preview: boolean; coalesce: boolean }
	| { op: 'type' }
	| { op: 'undo' }
	| { op: 'toast-undo'; i: number }
	| { op: 'hold'; on: boolean }
	| { op: 'time'; ms: number }
	| { op: 'done'; kind: 'ok' | 'errors' | 'bad'; ids: string[]; oldest: boolean }
	| { op: 'fail' }
	| { op: 'supersede' }
	| { op: 'die' }
	| { op: 'down' }
	| { op: 'up' }
	| { op: 'flush' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
	{
		weight: 5,
		arbitrary: fc.record({
			op: fc.constant('dispatch' as const),
			task: fc.constantFrom('b' as const, 'c' as const),
			n: fc.integer({ min: 1, max: 9 }),
			preview: fc.boolean(),
			coalesce: fc.boolean(),
		}),
	},
	{ weight: 2, arbitrary: fc.constant({ op: 'type' as const }) },
	{ weight: 2, arbitrary: fc.constant({ op: 'undo' as const }) },
	{ weight: 1, arbitrary: fc.record({ op: fc.constant('toast-undo' as const), i: fc.nat(3) }) },
	{ weight: 2, arbitrary: fc.record({ op: fc.constant('hold' as const), on: fc.boolean() }) },
	{
		weight: 3,
		arbitrary: fc.record({ op: fc.constant('time' as const), ms: fc.constantFrom(16, 300, 600) }),
	},
	{
		weight: 4,
		arbitrary: fc.record({
			op: fc.constant('done' as const),
			kind: fc.constantFrom('ok' as const, 'errors' as const, 'bad' as const),
			ids: fc.subarray(['e1', 'e2']),
			oldest: fc.boolean(),
		}),
	},
	{ weight: 1, arbitrary: fc.constant({ op: 'fail' as const }) },
	{ weight: 1, arbitrary: fc.constant({ op: 'supersede' as const }) },
	{ weight: 1, arbitrary: fc.constant({ op: 'die' as const }) },
	{ weight: 1, arbitrary: fc.constant({ op: 'down' as const }) },
	{ weight: 1, arbitrary: fc.constant({ op: 'up' as const }) },
	{ weight: 1, arbitrary: fc.constant({ op: 'flush' as const }) },
);

/** A result's messages: errors with the given ids (ok or not), or none. */
function resultOf(op: Extract<Op, { op: 'done' }>): Partial<ScheduleResult> {
	const errors = op.ids.map((id) => ({ ...message('error', 1, id), id }));
	if (op.kind === 'ok') return {};
	if (op.kind === 'errors') return { messages: errors };
	return { ok: false, messages: [...errors, { ...message('fatal', 1, 'bad'), id: 'fatal' }] };
}

/** The error ids of a result, worked out here. */
function errorIds(r: ScheduleResult | undefined): Set<string> {
	const out = new Set<string>();
	for (const m of r?.messages ?? []) if (m.level === 'error' || m.level === 'fatal') out.add(m.id);
	return out;
}

/**
 * The settle rule of workspace/run-types.ts and phase-2.md 11.2, written out again here (not
 * edits-settle.ts) as the oracle: how state `s` settles an edit of version `v` made when the good
 * run had the errors `baseline`, or null when it does not include it.
 */
function oracle(s: RunnerState, v: number, baseline: Set<string>): Settlement['status'] | null {
	if (s.engine === 'failed') return 'failed';
	const r = s.latest && s.latest.workspaceVersion >= v ? s.latest : null;
	const f = s.failure && s.failure.workspaceVersion >= v ? s.failure : null;
	if (f && (!r || f.revision > r.revision)) return 'failed';
	if (!r) return null;
	if (!r.result.ok) return 'not-scheduled';
	return [...errorIds(r.result)].some((id) => !baseline.has(id)) ? 'new-error' : 'scheduled';
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
	vi.useRealTimers();
});

interface Tracked {
	readonly entry: string;
	readonly version: number;
	readonly coalesced: boolean;
	settled: Settlement | null;
}

async function settleAll(h: Harness): Promise<void> {
	for (let i = 0; i < 6; i++) await flush();
	h.idle.run();
}

/** One run on a harness of its own, disposed whatever happens. */
async function run(ops: readonly Op[]): Promise<void> {
	const h = harness();
	try {
		await runOn(h, ops);
	} finally {
		h.dispose();
	}
}

async function runOn(h: Harness, ops: readonly Op[]): Promise<void> {
	await h.finish();
	let seq = 0;
	const states: Array<{ seq: number; s: RunnerState }> = [];
	const applyAt = new Map<string, number>();
	const baselines = new Map<string, Set<string>>();
	const undoneAt = new Map<string, number>();
	const outcomes: Array<DispatchOutcome | null> = [];
	const tracked: Tracked[] = [];
	const versions = new Map<string, number>();
	for (const [p, f] of h.ws.snapshot().files) versions.set(p, f.version);
	h.runner.subscribe((s) => void states.push({ seq: seq++, s }));
	h.history.subscribe((hist) => {
		const id = hist.redoTop()?.id;
		if (id !== undefined && !undoneAt.has(id)) undoneAt.set(id, seq++);
	});
	// Problems seen inside listeners, reported at the end (a throw there would hit the caller).
	const problems: string[] = [];
	h.ws.subscribe((snap, origin, info) => {
		const id = info.transactions[0]?.annotation(tjpEditId);
		const intent = info.edit?.intent as { task?: string; value?: string } | undefined;
		if (origin === 'intent' && info.edit && id !== undefined) {
			applyAt.set(id, seq++);
			baselines.set(id, errorIds(h.runner.state.lastGood?.result));
			for (const [p, base] of Object.entries(info.edit.base)) {
				if (base !== versions.get(p))
					problems.push(`${id} applied to ${base}, not ${versions.get(p)}`);
			}
			const task = intent?.task ?? '';
			const block = new RegExp(`task ${task} "${task.toUpperCase()}" \\{\\n  effort (\\S+)\\n`);
			const got = block.exec(snap.files.get('plan.tjp')?.text.toString() ?? '')?.[1];
			if (got !== intent?.value) problems.push(`${id} wrote ${got}, asked ${intent?.value}`);
		}
		for (const [p, f] of snap.files) versions.set(p, f.version);
	});

	const check = (): void => {
		const open = tracked.filter((t) => t.settled === null);
		expect(h.edits.pending.count).toBe(open.length);
		const top = h.history.top()?.id ?? null;
		for (const t of h.edits.toasts) {
			expect(t.canUndo).toBe(t.entry !== null && t.entry === top);
			if (t.status === 'pending') expect(open.some((x) => x.entry === t.entry)).toBe(true);
		}
	};

	for (const op of ops) {
		switch (op.op) {
			case 'dispatch': {
				const i = outcomes.push(null) - 1;
				const value = `${op.n}d`;
				void h.edits
					.dispatch(
						{ type: 'setAttr', task: op.task, attr: 'effort', value },
						{
							label: { text: `effort ${op.task}`, approx: false },
							...(op.coalesce ? { coalesceKey: op.task } : {}),
						},
						op.preview ? { task: op.task, start: 0, end: op.n * 480 } : undefined,
					)
					.then((o) => {
						outcomes[i] = o;
						if (o.status !== 'applied') return;
						const t: Tracked = {
							entry: o.entry,
							version: o.version,
							coalesced: op.coalesce,
							settled: null,
						};
						tracked.push(t);
						void o.settled.then((st) => (t.settled = st));
					});
				break;
			}
			case 'type':
				h.type('#');
				break;
			case 'undo':
				h.history.undo();
				break;
			case 'toast-undo': {
				const t = h.edits.toasts[op.i];
				if (t) h.edits.undoToast(t.id);
				break;
			}
			case 'hold':
				h.held = op.on;
				break;
			case 'time':
				await vi.advanceTimersByTimeAsync(op.ms);
				break;
			case 'done': {
				const r = op.oldest ? h.client.open[0] : h.client.open.at(-1);
				if (r !== undefined) h.client.done(r, resultOf(op));
				break;
			}
			case 'fail': {
				const r = h.client.open[0];
				if (r !== undefined) h.client.fail(r);
				break;
			}
			case 'supersede': {
				const [a, b] = [h.client.open[0], h.client.open.at(-1)];
				if (a !== undefined && b !== undefined && a < b) h.client.supersede(a, b);
				break;
			}
			case 'die':
				h.client.setState('failed');
				await settleAll(h);
				h.client.setState('idle');
				break;
			case 'down':
				h.client.setState('failed');
				break;
			case 'up':
				h.client.setState('idle');
				break;
			case 'flush':
				h.edits.flush();
				break;
		}
		await settleAll(h);
		check();
	}

	// Drain: the key clears, every timer and coalesced call runs, the engine answers everything.
	h.held = false;
	h.client.setState('idle');
	for (let i = 0; i < 40; i++) {
		h.edits.flush();
		await vi.advanceTimersByTimeAsync(1000);
		for (const r of h.client.open) h.client.done(r);
		await settleAll(h);
		if (h.client.open.length === 0 && outcomes.every((o) => o !== null)) break;
	}
	check();
	expect(problems).toEqual([]);
	expect(
		outcomes.every((o) => o !== null),
		'every call ends',
	).toBe(true);
	expect(h.edits.pending.count).toBe(0);
	expect(h.edits.toasts.filter((t) => t.status === 'pending')).toEqual([]);
	expect([...h.edits.pending.byTask.values()].filter((b) => b.state !== 'not-scheduled')).toEqual(
		[],
	);

	for (const t of tracked) {
		expect(t.settled, `edit at version ${t.version} settled`).not.toBeNull();
		const applied = applyAt.get(t.entry) ?? -1;
		const baseline = baselines.get(t.entry) ?? new Set<string>();
		// The state the dispatcher held at the apply (the engine may be down), then later ones.
		const before = states.filter((x) => x.seq < applied).at(-1)?.seq ?? -1;
		const first = states.find((x) => x.seq >= before && oracle(x.s, t.version, baseline) !== null);
		const undone = undoneAt.get(t.entry);
		if (undone !== undefined && (!first || undone < first.seq)) {
			// A coalesced edit undone by its own gesture is `replaced`; Mod-Z makes it `undone`.
			const allowed = t.coalesced ? ['undone', 'replaced'] : ['undone'];
			expect(allowed).toContain(t.settled?.status);
		} else {
			expect(first, 'a state includes it').toBeDefined();
			expect(t.settled?.status).toBe(first && oracle(first.s, t.version, baseline));
		}
	}
}

describe('the pending and settle state machine', () => {
	it('settles every edit on the first state that includes it, in any interleaving', async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 30 }), (ops) => run(ops)),
			{ numRuns: 120 },
		);
	}, 30_000);

	// The named cases the task asks for, as fixed sequences.
	const cases: Array<[string, Op[]]> = [
		[
			'a superseded edit',
			[
				{ op: 'dispatch', task: 'b', n: 3, preview: true, coalesce: false },
				{ op: 'dispatch', task: 'c', n: 4, preview: false, coalesce: false },
				{ op: 'supersede' },
				{ op: 'done', kind: 'ok', ids: [], oldest: false },
			],
		],
		[
			'a failed run',
			[{ op: 'dispatch', task: 'b', n: 3, preview: true, coalesce: false }, { op: 'fail' }],
		],
		[
			'undo while pending',
			[
				{ op: 'dispatch', task: 'b', n: 3, preview: true, coalesce: false },
				{ op: 'undo' },
				{ op: 'done', kind: 'bad', ids: [], oldest: true },
			],
		],
		[
			'a text edit racing an intent at the Android gate',
			[
				{ op: 'hold', on: true },
				{ op: 'dispatch', task: 'b', n: 5, preview: true, coalesce: false },
				{ op: 'time', ms: 16 },
				{ op: 'type' },
				{ op: 'hold', on: false },
				{ op: 'time', ms: 16 },
				{ op: 'type' },
				{ op: 'time', ms: 300 },
				{ op: 'done', kind: 'ok', ids: [], oldest: false },
			],
		],
		[
			'the engine giving up',
			[
				{ op: 'dispatch', task: 'b', n: 2, preview: false, coalesce: true },
				{ op: 'time', ms: 300 },
				{ op: 'die' },
			],
		],
		[
			'an edit made while the engine is down',
			[
				{ op: 'down' },
				{ op: 'dispatch', task: 'b', n: 4, preview: true, coalesce: false },
				{ op: 'up' },
			],
		],
		[
			'a new error against an old one',
			[
				{ op: 'done', kind: 'errors', ids: ['e1'], oldest: false },
				{ op: 'dispatch', task: 'b', n: 3, preview: false, coalesce: false },
				{ op: 'done', kind: 'errors', ids: ['e1', 'e2'], oldest: false },
				{ op: 'dispatch', task: 'c', n: 3, preview: false, coalesce: false },
				{ op: 'done', kind: 'errors', ids: ['e1', 'e2'], oldest: false },
			],
		],
		[
			'a gesture replaced while pending',
			[
				{ op: 'dispatch', task: 'b', n: 3, preview: true, coalesce: true },
				{ op: 'time', ms: 300 },
				{ op: 'dispatch', task: 'b', n: 5, preview: true, coalesce: true },
				{ op: 'time', ms: 300 },
				{ op: 'done', kind: 'ok', ids: [], oldest: false },
			],
		],
	];
	for (const [name, ops] of cases) {
		it(name, async () => {
			await run(ops);
		});
	}
});
