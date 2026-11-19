// SPDX-License-Identifier: GPL-2.0-or-later
// ADR-0018 (T27c), the property of the dispatcher's checks. A call is planned on version v0 with a
// target the view read there: a leave item (by its range), a task id, or a slot (a `moveTask`
// parent and index). Then a random mix of intents, typing, undo, redo and index catch-ups runs up
// to version vN, and the call is dispatched with `basedOn: v0`. The checks, worked out here again
// (not from edits-rebase.ts) from unique markers (every leave item and task has its own name) and
// from the change sets the workspace announces:
// - safety: the call either refuses, or changes the same logical target. A leave: the item with the
//   marker, and nothing else, and no change overlapped its span. An id: the block with the marker
//   and no other. A slot: the tasks end in the order a call on v0 alone gives, which holds only if
//   the neighbours (the others by marker) are the ones the view saw.
// - liveness: when nothing touched the target, the call resolves. A leave: no change overlapped or
//   met its span. An id: the declaration still starts where its start maps to, still with its id. A
//   slot: that holds for the moved task and the others (the ids, minus the moved one) are the same
//   list in the same order.
// Typing is a comment line at the start of a line or of the file, or letters in a resource's name
// (some of them the length of an item and its ", ", which moves an item onto the old range of
// another).
//
// MARK (T27c): `it.fails` until T27b lands. The leave and id calls are refused as `unknown-target`
// as soon as typing moved the text, so the liveness property fails today. When T27b is merged,
// change `it.fails` to `it` in this file; the examples below stay (the rename shift, the id chain).
import fc from 'fast-check';
import type { ChangeSet } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditIntent, SourceRange } from '../tjp/edit/types';
import { harness, type Harness } from './edits-testing';

const FILE = 'plan.tjp';
const RUNS = Number(process.env['REBASE_RUNS'] ?? 200);
/** A fixed fast-check seed (FC_SEED), else a random one. */
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const LEAVE_START = ['', '2026-02-02', '2026-02-09', '2026-02-16'] as const;
const PLAN = [
	'project p "P" 2026-01-05 +3m',
	'resource r1 "R1" {',
	'  leaves annual "L1" 2026-02-02 - 2026-02-06, annual "L2" 2026-02-09 - 2026-02-13, annual "L3" 2026-02-16 - 2026-02-20',
	'}',
	'task t1 "T1" {',
	'  effort 1d',
	'}',
	'task t2 "T2" {',
	'  effort 2d',
	'}',
	'task t3 "T3" {',
	'  effort 3d',
	'}',
	'task t4 "T4" {',
	'  effort 4d',
	'}',
	'',
].join('\n');

type Op =
	| { op: 'type'; where: 'start' | 'end' | 'line'; line: number }
	| { op: 'name'; n: number }
	| { op: 'effort'; t: number; n: number }
	| { op: 'leave'; j: number; end: string }
	| { op: 'rename'; t: number; to: string }
	| { op: 'move'; t: number; index: number }
	| { op: 'delete'; t: number }
	| { op: 'undo' }
	| { op: 'redo' }
	| { op: 'catchUp' };

type Scenario =
	| { kind: 'leave'; k: number; ops: Op[] }
	| { kind: 'id'; t: number; ops: Op[] }
	| { kind: 'slot'; t: number; index: number; ops: Op[] };

const task = fc.integer({ min: 1, max: 4 });
const opArb: fc.Arbitrary<Op> = fc.oneof(
	{
		weight: 3,
		arbitrary: fc.record({
			op: fc.constant('type' as const),
			where: fc.constantFrom('start' as const, 'end' as const, 'line' as const),
			line: fc.nat(30),
		}),
	},
	{
		weight: 2,
		// 37 is the length of an item and its ", ": the items of the plan are 35 long.
		arbitrary: fc.record({ op: fc.constant('name' as const), n: fc.constantFrom(1, 3, 37, 74) }),
	},
	{
		weight: 2,
		arbitrary: fc.record({
			op: fc.constant('effort' as const),
			t: task,
			n: fc.integer({ min: 1, max: 5 }),
		}),
	},
	{
		weight: 2,
		arbitrary: fc.record({
			op: fc.constant('leave' as const),
			j: fc.integer({ min: 1, max: 3 }),
			end: fc.constantFrom('2026-02-14', '2026-02-15', '2026-02-16', '2026-02-24'),
		}),
	},
	{
		weight: 2,
		arbitrary: fc.record({
			op: fc.constant('rename' as const),
			t: task,
			to: fc.constantFrom('t1', 't2', 't3', 't4', 'u1', 'u2'),
		}),
	},
	{
		weight: 1,
		arbitrary: fc.record({ op: fc.constant('move' as const), t: task, index: fc.nat(3) }),
	},
	{ weight: 1, arbitrary: fc.record({ op: fc.constant('delete' as const), t: task }) },
	{ weight: 2, arbitrary: fc.constant({ op: 'undo' as const }) },
	{ weight: 1, arbitrary: fc.constant({ op: 'redo' as const }) },
	{ weight: 1, arbitrary: fc.constant({ op: 'catchUp' as const }) },
);
const opsArb = fc.array(opArb, { maxLength: 8 });
const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(
	fc.record({
		kind: fc.constant('leave' as const),
		k: fc.integer({ min: 1, max: 3 }),
		ops: opsArb,
	}),
	fc.record({ kind: fc.constant('id' as const), t: task, ops: opsArb }),
	fc.record({
		kind: fc.constant('slot' as const),
		t: task,
		index: fc.nat(3),
		ops: opsArb,
	}),
);

// ---- Reading the text by markers ------------------------------------------------------------

const idOf = (text: string, t: number): string | null =>
	new RegExp(`^task (\\w+) "T${t}" \\{`, 'm').exec(text)?.[1] ?? null;
const topIds = (text: string): string[] =>
	[...text.matchAll(/^task (\w+) "T\d"/gm)].map((m) => m[1] ?? '');
const topMarkers = (text: string): string[] =>
	[...text.matchAll(/^task \w+ "(T\d)"/gm)].map((m) => m[1] ?? '');
const leaveRe = (k: number): RegExp =>
	new RegExp(`annual "L${k}" \\d{4}-\\d\\d-\\d\\d - \\d{4}-\\d\\d-\\d\\d`);
const blockRe = (t: number): RegExp => new RegExp(`task \\w+ "T${t}" \\{\\n  effort (\\S+)\\n\\}`);

function leaveRange(text: string, k: number): SourceRange | null {
	const m = leaveRe(k).exec(text);
	return m ? { file: FILE, from: m.index, to: m.index + m[0].length } : null;
}

// ---- The oracle's own tracking of a span through every change ------------------------------

interface Tracked {
	from: number;
	to: number;
	/** A change replaced or split the open interval (from, to). */
	overlapped: boolean;
	/** A change touched the closed interval [from, to] (overlapped, or met an end). */
	met: boolean;
}

function track(h: Harness, from: number, to: number): Tracked {
	const t: Tracked = { from, to, overlapped: false, met: false };
	h.ws.subscribe((_s, _o, info) => {
		for (const tr of info.transactions) {
			const cs: ChangeSet = tr.changes;
			cs.iterChanges((fromA, toA) => {
				if (fromA < t.to && toA > t.from) t.overlapped = true;
				if (fromA <= t.to && toA >= t.from) t.met = true;
			});
			t.from = cs.mapPos(t.from, 1);
			t.to = cs.mapPos(t.to, -1);
		}
	});
	return t;
}

// ---- The random ops --------------------------------------------------------------------------

const LABEL = { label: { text: 'op', approx: false } };

async function runOp(h: Harness, op: Op, catchUps: { n: number }): Promise<void> {
	const text = h.text();
	const basedOn = h.ws.snapshot().version;
	const send = async (intent: EditIntent): Promise<void> =>
		void (await h.edits.dispatch(intent, { ...LABEL, basedOn }));
	switch (op.op) {
		case 'type': {
			const lines = text.split('\n');
			const at =
				op.where === 'start'
					? 0
					: op.where === 'end'
						? text.length
						: lines.slice(0, op.line % lines.length).reduce((n, l) => n + l.length + 1, 0);
			h.type('# c\n', at);
			return;
		}
		case 'name': {
			const m = /resource r1 "R1x*"/.exec(text);
			if (m) h.type('x'.repeat(op.n), m.index + m[0].length - 1);
			return;
		}
		case 'effort': {
			const id = idOf(text, op.t);
			if (id) await send({ type: 'setAttr', task: id, attr: 'effort', value: `${op.n}d` });
			return;
		}
		case 'leave': {
			const r = leaveRange(text, op.j);
			if (r) {
				const leave = { item: r, basedOn };
				await send({
					type: 'updateLeave',
					leave,
					to: { type: 'annual', name: `L${op.j}`, start: LEAVE_START[op.j] ?? '', end: op.end },
				});
			}
			return;
		}
		case 'rename': {
			const id = idOf(text, op.t);
			const taken = topIds(text).includes(op.to);
			if (id && !taken) await send({ type: 'renameTask', task: id, name: `T${op.t}`, id: op.to });
			return;
		}
		case 'move': {
			const id = idOf(text, op.t);
			if (id) await send({ type: 'moveTask', task: id, parent: null, index: op.index });
			return;
		}
		case 'delete': {
			const id = idOf(text, op.t);
			if (id) await send({ type: 'deleteTask', task: id });
			return;
		}
		case 'undo':
			h.history.undo();
			return;
		case 'redo':
			h.history.redo();
			return;
		case 'catchUp':
			// The ring keeps the last 4 published indexes: at most two more than v0 stay safe.
			if (catchUps.n++ < 2) h.idle.run();
			return;
	}
}

// ---- One scenario ----------------------------------------------------------------------------

let open: Harness[] = [];
afterEach(() => {
	for (const h of open) h.dispose();
	open = [];
});

const make = async (): Promise<Harness> => {
	const h = harness({ entry: FILE, files: { [FILE]: PLAN } });
	open.push(h);
	await h.finish();
	return h;
};

async function run(sc: Scenario): Promise<void> {
	const h = await make();
	const v0 = h.runner.state.indexVersion;
	expect(v0).toBe(h.ws.snapshot().version);
	const t0 = h.text();

	// The call as the view planned it on v0, and the oracle's span for its target.
	let intent: EditIntent;
	let span: Tracked;
	let reference: string[] = [];
	let mover = '';
	switch (sc.kind) {
		case 'leave': {
			const r = leaveRange(t0, sc.k);
			if (!r) throw new Error('no item');
			intent = {
				type: 'updateLeave',
				leave: { item: r, basedOn: v0 },
				to: { type: 'annual', name: `L${sc.k}`, start: LEAVE_START[sc.k] ?? '', end: '2026-03-27' },
			};
			span = track(h, r.from, r.to);
			break;
		}
		case 'id': {
			const id = idOf(t0, sc.t);
			if (!id) throw new Error('no task');
			intent = { type: 'setAttr', task: id, attr: 'effort', value: '9d' };
			const from = t0.indexOf(`task ${id} "T${sc.t}"`);
			span = track(h, from, from);
			break;
		}
		case 'slot': {
			mover = idOf(t0, sc.t) ?? '';
			intent = { type: 'moveTask', task: mover, parent: null, index: sc.index };
			const from = t0.indexOf(`task ${mover} "T${sc.t}"`);
			span = track(h, from, from);
			// What the call does on v0 alone, by markers.
			const ref = await make();
			const done = await ref.edits.dispatch(intent, {
				...LABEL,
				basedOn: ref.ws.snapshot().version,
			});
			// A move to where the task already is has no outcome to compare.
			if (done.status !== 'applied') return;
			reference = topMarkers(ref.text());
			break;
		}
	}
	const others0 = topIds(t0).filter((x) => x !== mover);

	const catchUps = { n: 0 };
	for (const op of sc.ops) await runOp(h, op, catchUps);

	const before = h.text();
	// What the oracle saw before the call itself changes the text.
	const { overlapped, met } = span;
	const o = await h.edits.dispatch(intent, { ...LABEL, basedOn: v0 });

	// Liveness: when nothing touched the target, the call resolves.
	let required: boolean;
	switch (sc.kind) {
		case 'leave':
			required = !met;
			break;
		case 'id': {
			const id = idOf(t0, sc.t) ?? '';
			required = before.startsWith(`task ${id} "T${sc.t}"`, span.from);
			break;
		}
		case 'slot': {
			const intact = before.startsWith(`task ${mover} "T${sc.t}"`, span.from);
			const others = topIds(before).filter((x) => x !== mover);
			required =
				intact && others.length === others0.length && others.every((x, i) => x === others0[i]);
			break;
		}
	}
	// A move to the slot the task now holds is a legitimate no-op.
	if (o.status === 'noop' && sc.kind === 'slot') {
		expect(topMarkers(before)).toEqual(reference);
		return;
	}
	if (o.status !== 'applied') {
		expect(required, `refused (${o.status}) though nothing touched the target`).toBe(false);
		expect(h.text()).toBe(before);
		return;
	}

	// Safety: an applied call changed the same logical target.
	const after = h.text();
	switch (sc.kind) {
		case 'leave': {
			expect(overlapped, 'applied on an item that was rewritten in the meantime').toBe(false);
			const a = leaveRe(sc.k).exec(after)?.[0];
			const b = leaveRe(sc.k).exec(before)?.[0];
			expect(a && b, 'the marked item').toBeTruthy();
			expect(after.replace(a ?? '', b ?? ''), 'only the marked item changed').toBe(before);
			break;
		}
		case 'id': {
			const re = blockRe(sc.t);
			const a = re.exec(after);
			expect(a?.[1], 'the marked task got the value').toBe('9d');
			expect(after.replace(re, '<T>'), 'no other task changed').toBe(before.replace(re, '<T>'));
			break;
		}
		case 'slot':
			expect(topMarkers(after), 'the moved task has the neighbours the view saw').toEqual(
				reference,
			);
			break;
	}
}

const prop = () => fc.asyncProperty(scenarioArb, async (sc) => run(sc));

// The shift of the ADR's e2e: the name grows by one item and its ", ", so the old range of L2 is
// the new range of L1.
const examples: Array<[Scenario]> = [
	[{ kind: 'leave', k: 2, ops: [{ op: 'name', n: 37 }] }],
	[{ kind: 'leave', k: 1, ops: [{ op: 'type', where: 'start', line: 0 }] }],
	// The chain: t1 becomes u1, then t2 takes t1.
	[
		{
			kind: 'id',
			t: 1,
			ops: [
				{ op: 'rename', t: 1, to: 'u1' },
				{ op: 'rename', t: 2, to: 't1' },
			],
		},
	],
	[{ kind: 'slot', t: 1, index: 2, ops: [{ op: 'effort', t: 3, n: 2 }, { op: 'undo' }] }],
	[{ kind: 'slot', t: 1, index: 2, ops: [{ op: 'move', t: 3, index: 0 }] }],
];

describe('a call planned on an old index (ADR-0018)', () => {
	// `it.fails` until T27b: see the header.
	it.fails(
		'refuses or resolves to the same logical target; resolves when nothing touched it',
		async () => {
			await fc.assert(prop(), { numRuns: RUNS, examples, ...SEED });
		},
		120_000,
	);
});
