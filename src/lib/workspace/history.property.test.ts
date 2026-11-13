// SPDX-License-Identifier: GPL-2.0-or-later
// Property tests for the workspace history (phase-2.md 13.1): random sequences of typing, typos
// fixed at once (a group that nets to nothing), cursor moves, intents (some across two files:
// deleteTask with a reference in another file, moveTask between files), format (through `apply`
// and as the editor commits it), undo and redo across three files keep the text equal to a model
// of the stacks; undo all gives the seed byte for byte and redo all the final text; re-stamped
// versions keep `undoEdit` valid for the top entry; and a change that bypasses the history (an
// insertion, or a same-length replacement that only the version check catches) gives `diverged`
// for the first entry that touches its file, without applying anything.
import { Transaction } from '@codemirror/state';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../tjp/index';
import { undoEdit } from '../tjp/edit/apply';
import type { EditIntent } from '../tjp/edit/types';
import { createHistory, type WorkspaceHistory } from './history';
import {
	FILES,
	format,
	intent,
	moveCursor,
	PATHS,
	seedWorkspace,
	type,
} from './testing/history-fixture';
import type { Workspace } from './workspace';

type Op =
	| { k: 'type'; file: number; line: number; text: string; dt: number; event: string }
	| { k: 'del'; file: number; line: number; dt: number; back: boolean }
	| { k: 'move'; file: number; line: number }
	| { k: 'typo'; file: number; line: number; dt: number }
	| { k: 'intent'; kind: number; task: number; value: number }
	| { k: 'format'; file: number; editor: boolean }
	| { k: 'undo' }
	| { k: 'redo' };

const file = fc.nat({ max: PATHS.length - 1 });
const line = fc.nat({ max: 40 });
const dt = fc.constantFrom(0, 100, 499, 500, 2000);
const op: fc.Arbitrary<Op> = fc.oneof(
	{
		weight: 4,
		arbitrary: fc.record({
			k: fc.constant('type' as const),
			file,
			line,
			text: fc.constantFrom('# c\n', '\n', '  ', 'x', 'é'),
			dt,
			event: fc.constantFrom('input.type', 'input.type', 'input.paste', 'input'),
		}),
	},
	{
		weight: 2,
		arbitrary: fc.record({ k: fc.constant('del' as const), file, line, dt, back: fc.boolean() }),
	},
	{ weight: 1, arbitrary: fc.record({ k: fc.constant('move' as const), file, line }) },
	{ weight: 1, arbitrary: fc.record({ k: fc.constant('typo' as const), file, line, dt }) },
	{
		weight: 3,
		arbitrary: fc.record({
			k: fc.constant('intent' as const),
			kind: fc.nat({ max: 4 }),
			task: fc.nat({ max: 9 }),
			value: fc.nat({ max: 4 }),
		}),
	},
	{
		weight: 1,
		arbitrary: fc.record({ k: fc.constant('format' as const), file, editor: fc.boolean() }),
	},
	{ weight: 3, arbitrary: fc.constant({ k: 'undo' as const }) },
	{ weight: 2, arbitrary: fc.constant({ k: 'redo' as const }) },
);

const pathOf = (i: number): string => PATHS[i % PATHS.length] ?? 'plan.tjp';

function lineStart(ws: Workspace, path: string, n: number): number {
	const doc = ws.state(path).doc;
	return doc.line((n % doc.lines) + 1).from;
}

function intentOf(ws: Workspace, o: Extract<Op, { k: 'intent' }>): EditIntent | null {
	const snap = ws.snapshot();
	const ids = [...buildIndex(snap, undefined, { cache: null }).tasks.keys()];
	const task = ids[o.task % Math.max(1, ids.length)];
	if (task === undefined) return null;
	const v = ['1d', '2d', '3w', '4h', '10d'][o.value] ?? '1d';
	if (o.kind === 0) return { type: 'setAttr', task, attr: 'effort', value: v };
	if (o.kind === 1) return { type: 'renameTask', task, name: `Task ${v}` };
	if (o.kind === 2) return { type: 'setAttr', task, attr: 'note', value: `note ${v}` };
	// Across files in the seed: deleting `a` edits `depends a` in b.tji; moving `top` under `a`
	// moves text from plan.tjp to a.tji.
	if (o.kind === 3) return { type: 'deleteTask', task };
	const parent = o.value === 0 ? null : (ids[(o.task + o.value) % ids.length] ?? null);
	return { type: 'moveTask', task, parent, index: 0 };
}

interface Model {
	done: Array<{ id: string; texts: Record<string, string> }>;
	undone: Array<{ id: string; texts: Record<string, string> }>;
}

/** Runs one recorded op (anything but undo and redo). */
function run(ws: Workspace, o: Op, clock: { t: number }): void {
	switch (o.k) {
		case 'type': {
			clock.t += o.dt;
			const p = lineStart(ws, pathOf(o.file), o.line);
			type(ws, pathOf(o.file), p, o.text, { time: clock.t, userEvent: o.event });
			return;
		}
		case 'del': {
			clock.t += o.dt;
			const path = pathOf(o.file);
			const p = lineStart(ws, path, o.line);
			const len = ws.state(path).doc.length;
			const [from, to] = o.back ? [p - 1, p] : [p, p + 1];
			if (from < 0 || to > len) return;
			type(ws, path, from, '', {
				time: clock.t,
				to,
				userEvent: o.back ? 'delete.backward' : 'delete.forward',
			});
			return;
		}
		case 'move':
			moveCursor(ws, pathOf(o.file), lineStart(ws, pathOf(o.file), o.line));
			return;
		case 'typo': {
			clock.t += o.dt;
			const path = pathOf(o.file);
			const p = lineStart(ws, path, o.line);
			type(ws, path, p, 'x', { time: clock.t });
			type(ws, path, p, '', { time: clock.t + 50, to: p + 1 });
			clock.t += 50;
			return;
		}
		case 'intent': {
			const i = intentOf(ws, o);
			if (i) intent(ws, i);
			return;
		}
		case 'format':
			format(ws, pathOf(o.file), o.editor ? 'editor' : 'apply');
			return;
		default:
			return;
	}
}

function step(ws: Workspace, h: WorkspaceHistory, m: Model, o: Op, clock: { t: number }): void {
	if (o.k === 'undo' || o.k === 'redo') {
		const [from, to] = o.k === 'undo' ? [m.done, m.undone] : [m.undone, m.done];
		const r = o.k === 'undo' ? h.undo() : h.redo();
		const moved = from.pop();
		if (!moved) {
			expect(r.status).toBe('empty');
			return;
		}
		expect(r.status).toBe('done');
		to.push(moved);
		const now = o.k === 'undo' ? (m.done[m.done.length - 1]?.texts ?? FILES) : moved.texts;
		expect(ws.texts()).toEqual(now);
		return;
	}
	const before = ws.texts();
	run(ws, o, clock);
	const after = ws.texts();
	const top = h.top();
	// The "x" of a typo is recorded, and clears redo, before Backspace takes it away.
	if (o.k === 'typo') m.undone = [];
	if (JSON.stringify(after) === JSON.stringify(before) || !top) return;
	const last = m.done[m.done.length - 1];
	if (last && last.id === top.id) last.texts = after;
	else m.done.push({ id: top.id, texts: after });
	m.undone = [];
}

function check(ws: Workspace, h: WorkspaceHistory, m: Model): void {
	expect(h.canUndo).toBe(m.done.length > 0);
	expect(h.canRedo).toBe(m.undone.length > 0);
	const top = h.top();
	if (top) expect(undoEdit(top.applied, ws.snapshot())).not.toBeNull();
}

describe('workspace history (property)', () => {
	it('keeps the text equal to a model; undo all gives the seed, redo all the final text', () => {
		fc.assert(
			fc.property(fc.array(op, { minLength: 1, maxLength: 30 }), (ops) => {
				const ws = seedWorkspace();
				const h = createHistory(ws);
				const m: Model = { done: [], undone: [] };
				const clock = { t: 0 };
				for (const o of ops) {
					step(ws, h, m, o, clock);
					check(ws, h, m);
				}
				while (h.redo().status === 'done');
				const final = ws.texts();
				while (h.undo().status === 'done');
				expect(ws.texts()).toEqual(FILES);
				expect(h.canUndo).toBe(false);
				while (h.redo().status === 'done');
				expect(ws.texts()).toEqual(final);
			}),
			{ numRuns: 60 },
		);
	});

	it('gives diverged for the first entry that touches a file changed outside the history', () => {
		fc.assert(
			fc.property(
				fc.array(op, { minLength: 1, maxLength: 20 }),
				file,
				fc.nat({ max: 3 }),
				fc.boolean(),
				(ops, bypassed, undos, sameLength) => {
					const ws = seedWorkspace();
					const h = createHistory(ws);
					const m: Model = { done: [], undone: [] };
					const clock = { t: 0 };
					for (const o of ops) step(ws, h, m, o, clock);
					for (let i = 0; i < undos; i++) step(ws, h, m, { k: 'undo' }, clock);
					const path = pathOf(bypassed);
					const bypass = { annotations: [Transaction.addToHistory.of(false)] };
					// A same-length replacement keeps every length check happy: only versions tell.
					const first = ws.state(path).doc.sliceString(0, 1);
					if (sameLength && first !== '') {
						type(ws, path, 0, first === '#' ? '%' : '#', { to: 1, spec: bypass });
					} else {
						type(ws, path, 0, '#', { spec: bypass });
					}
					for (;;) {
						const top = h.top();
						const before = ws.texts();
						const r = h.undo();
						if (!top) {
							expect(r.status).toBe('empty');
							break;
						}
						if (path in top.applied.edit.changes) {
							expect(r.status).toBe('diverged');
							expect(ws.texts()).toEqual(before);
							expect([h.canUndo, h.canRedo]).toEqual([false, false]);
							break;
						}
						expect(r.status).toBe('done');
						m.done.pop();
						const want: Record<string, string> = { ...(m.done[m.done.length - 1]?.texts ?? FILES) };
						want[path] = ws.texts()[path] ?? '';
						expect(ws.texts()).toEqual(want);
					}
				},
			),
			{ numRuns: 60 },
		);
	});
});
