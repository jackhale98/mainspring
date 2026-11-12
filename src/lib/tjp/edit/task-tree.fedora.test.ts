// SPDX-License-Identifier: GPL-2.0-or-later
// Task tree intents on Fedora 20 with the golden's engine hints (ids written with macros): the
// re-index check carries the hints through the edit (task-hints.ts), so reorders and additions
// under macro-id parents go through, and the edited text indexed with the carried hints has the
// tree the intent asks for. With the built engine the edited workspace is also scheduled in wasm
// and its task tree compared with the golden's (TJP_EDIT_ENGINE=1 makes a missing engine fail).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../../tests/grammar/corpus';
import { bootNodeEngine, loadCorpus, planRequest } from '../../../../engine/golden/run-wasm.mjs';
import type { ScheduleRequest, ScheduleResult } from '../../../engine/protocol';
import { createWorkspace } from '../../workspace/workspace';
import { buildIndex, hintsFromResult } from '../index';
import { applyIntent } from './apply';
import { mapHints } from './task-hints';
import { snapshotAfter } from './task-verify';
import { treeDiff } from './testing-plans';
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

// Each intent re-indexes Fedora twice; under a full parallel run that can pass 5 s.
describe('task tree intents on Fedora 20 with engine hints', { timeout: 60_000 }, () => {
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

const ENGINE = path.join(ROOT, 'public/engine/manifest.json');
const REQUIRED = process.env['TJP_EDIT_ENGINE'] === '1';

// Independent of the index: the edited Fedora workspace is scheduled by the wasm engine and its
// task tree compared with the golden's, mapped through the intent.
describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('Fedora 20 edits in the engine', () => {
	it('schedule with the tree the intent asks for and no new errors', async () => {
		const engine = await bootNodeEngine({ log: () => {} });
		const [entry] = loadCorpus(['upstream-fedora-20']) as Array<{
			plan: { id: string; root: string };
			golden: {
				entry: string;
				files: string[];
				options: { now: string | null };
				result: ScheduleResult;
			};
		}>;
		if (!entry) throw new Error('no Fedora golden');
		const request = planRequest(entry.plan, entry.golden, 1) as ScheduleRequest;
		const { snap, index } = fedora();
		const base = entry.golden.result;
		const errors = (r: ScheduleResult): string[] =>
			r.messages
				.filter((m) => m.level === 'error' || m.level === 'fatal')
				.map((m) => m.id)
				.sort();
		const intents: EditIntent[] = [
			{
				type: 'moveTask',
				task: 'f20.PlanningPhase.rawhide_spins',
				parent: 'f20.PlanningPhase',
				index: 0,
			},
			{ type: 'moveTask', task: 'f20.supplement_wallpaper', parent: 'f20', index: 0 },
			{ type: 'addTask', parent: 'f20.PlanningPhase', index: 0, name: 'Added' },
			{ type: 'deleteTask', task: 'f20.PlanningPhase.rawhide_spins' },
		];
		const failures: string[] = [];
		let revision = 1;
		for (const intent of intents) {
			const r = applyIntent(snap, index, intent);
			if (r.status !== 'edit') {
				failures.push(`${JSON.stringify(intent)}: ${r.status}`);
				continue;
			}
			const files: Record<string, string> = {};
			for (const [p, f] of snap.files) {
				const cs = r.edit.changes[p];
				files[p] = cs ? cs.apply(f.text).toString() : f.text.toString();
			}
			const result = engine.schedule({ ...request, files, revision: ++revision });
			if (result.ok !== base.ok) failures.push(`${JSON.stringify(intent)}: ok ${result.ok}`);
			if (errors(result).join() !== errors(base).join()) {
				failures.push(`${JSON.stringify(intent)}: errors ${errors(result).join()}`);
			}
			for (const d of treeDiff(base, result, intent))
				failures.push(`${JSON.stringify(intent)}: ${d}`);
		}
		expect(failures).toEqual([]);
	}, 300_000);
});
