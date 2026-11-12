// SPDX-License-Identifier: GPL-2.0-or-later
// Task tree intents on Fedora 20 with the golden's engine hints (ids written with macros): the
// re-index check carries the hints through the edit (task-hints.ts), so reorders and additions
// under macro-id parents go through, and the edited text indexed with the carried hints has the
// tree the intent asks for.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../../tests/grammar/corpus';
import type { ScheduleResult } from '../../../engine/protocol';
import { createWorkspace } from '../../workspace/workspace';
import { buildIndex, hintsFromResult } from '../index';
import { applyIntent } from './apply';
import { mapHints } from './task-hints';
import { snapshotAfter } from './task-verify';
import type { EditIntent, EditOp } from './types';

const DIR = 'engine/tj/examples/Fedora-20';

function fedora() {
	const g = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/expected/upstream-fedora-20.json'), 'utf8'),
	) as { entry: string; files: string[]; result: ScheduleResult };
	const files: Record<string, string> = {};
	for (const f of g.files) files[f] = fs.readFileSync(path.join(ROOT, DIR, f), 'utf8');
	const snap = createWorkspace({ entry: g.entry, files }).snapshot();
	const lines = (f: string): string[] => snap.files.get(f)?.text.toString().split('\n') ?? [];
	const hints = hintsFromResult(
		g.result,
		(_f, line) => line,
		(f, line) => lines(f)[line - 1] ?? null,
	);
	return { snap, index: buildIndex(snap, hints) };
}

describe('task tree intents on Fedora 20 with engine hints', () => {
	const { snap, index } = fedora();

	/** The children of `parent` after the intent, indexed with the carried hints. */
	function childrenAfter(intent: EditIntent, parent: string): readonly string[] {
		const r = applyIntent(snap, index, intent);
		if (r.status !== 'edit') throw new Error(JSON.stringify(r));
		const ops: EditOp[] = [];
		for (const [file, cs] of Object.entries(r.edit.changes)) {
			cs.iterChanges((from, to, _a, _b, ins) =>
				ops.push({ file, from, to, insert: ins.toString(), element: { from, to } }),
			);
		}
		const next = snapshotAfter(snap, ops);
		const map = (id: string): string => id;
		const after = buildIndex(next.snap, mapHints(index, snap, next.snap, next.changes, map).hints);
		return after.tasks.get(parent)?.children ?? [];
	}

	it('resolves the macro-id root through hints', () => {
		expect(index.tasks.get('f20')?.idSource).toBe('engine');
	});

	it('reorders a task under a macro-id ancestor', () => {
		const kids = childrenAfter(
			{
				type: 'moveTask',
				task: 'f20.PlanningPhase.rawhide_spins',
				parent: 'f20.PlanningPhase',
				index: 0,
			},
			'f20.PlanningPhase',
		);
		expect(kids[0]).toBe('f20.PlanningPhase.rawhide_spins');
	});

	it('reorders a child of the macro-id root', () => {
		const kids = childrenAfter(
			{ type: 'moveTask', task: 'f20.supplement_wallpaper', parent: 'f20', index: 0 },
			'f20',
		);
		expect(kids[0]).toBe('f20.supplement_wallpaper');
	});

	it('adds a task under PlanningPhase', () => {
		const kids = childrenAfter(
			{ type: 'addTask', parent: 'f20.PlanningPhase', index: 0, name: 'Added' },
			'f20.PlanningPhase',
		);
		expect(kids[0]).toBe('f20.PlanningPhase.added');
	});

	it('cannot name the macro-id tasks without hints', () => {
		const bare = buildIndex(snap);
		const r = applyIntent(snap, bare, {
			type: 'addTask',
			parent: 'f20.PlanningPhase',
			index: 0,
			name: 'X',
		});
		expect(r).toMatchObject({ status: 'refused', reason: 'unknown-target' });
	});
});
