// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the task attribute intents: corpora (golden plans and T16 fixtures) with their
 * index, and random intents over them (task-attrs.property.test.ts, task-attrs.engine.test.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { CORPORA, ROOT, readTjp } from '../../../../tests/grammar/corpus';
import { createWorkspace, type WorkspaceSnapshot } from '../../workspace/workspace';
import { buildIndex, type SymbolIndex } from '../index';
import type { EditIntent, EditResult, TaskAttr } from './types';

export interface AttrCorpus {
	readonly name: string;
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
	readonly tasks: readonly string[];
}

export function loadCorpus(name: string, entry: string, files: Record<string, string>): AttrCorpus {
	const snap = createWorkspace({ entry, files }).snapshot();
	const index = buildIndex(snap);
	return { name, snap, index, tasks: [...index.tasks.keys()] };
}

/** The golden plans (by manifest id) and the T16 fixtures (by directory), with tasks. */
export function attrCorpora(): AttrCorpus[] {
	const manifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/manifest.json'), 'utf8'),
	) as Array<{ id: string; root: string }>;
	const out: AttrCorpus[] = [];
	for (const plan of manifest) {
		const g = JSON.parse(
			fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${plan.id}.json`), 'utf8'),
		) as { entry: string; files: string[] };
		const files: Record<string, string> = {};
		for (const f of g.files) files[f] = readTjp(`${plan.root}/${f}`);
		out.push(loadCorpus(plan.id, g.entry, files));
	}
	const all = CORPORA.find((c) => c.name === 'fixtures')?.files ?? [];
	const root = 'tests/fixtures/tjp';
	for (const d of fs.readdirSync(path.join(ROOT, root), { withFileTypes: true })) {
		if (!d.isDirectory()) continue;
		const dir = `${root}/${d.name}`;
		const files: Record<string, string> = {};
		for (const f of all) if (f.startsWith(`${dir}/`)) files[f.slice(dir.length + 1)] = readTjp(f);
		if (files['plan.tjp'] !== undefined) out.push(loadCorpus(dir, 'plan.tjp', files));
	}
	return out.filter((c) => c.tasks.length > 0);
}

/** Values valid in any project context (no dates: frames differ). */
const VALUES: ReadonlyArray<readonly [TaskAttr, string]> = [
	['effort', '3d'],
	['length', '2d'],
	['duration', '1w'],
	['priority', '650'],
	['complete', '40'],
	['note', '"Property note"'],
	['scheduling', 'alap'],
];
const REMOVABLE: readonly TaskAttr[] = ['effort', 'priority', 'note', 'complete', 'milestone'];

/** A random intent of kind 0 to 4 for a corpus (`pick` chooses the task, `value` the rest). */
export function intentFor(c: AttrCorpus, kind: number, pick: number, value: number): EditIntent {
	const task = c.tasks[pick % c.tasks.length] ?? '';
	switch (kind) {
		case 0: {
			const [attr, v] = VALUES[value % VALUES.length] ?? ['priority', '650'];
			return { type: 'setAttr', task, attr, value: v };
		}
		case 1:
			return { type: 'setAttr', task, attr: 'milestone', value: value % 2 === 0 };
		case 2:
			return { type: 'removeAttr', task, attr: REMOVABLE[value % REMOVABLE.length] ?? 'note' };
		case 3:
			return { type: 'renameTask', task, name: `Renamed ${value % 7} "q" 'x'` };
		default: {
			const flags = [...c.index.flags.keys()];
			const f = flags[value % (flags.length + 1)];
			if (f !== undefined && value % 3 === 0) {
				return { type: 'setAttr', task, attr: 'flags', value: [f] };
			}
			return { type: 'declareFlag', flag: `prop_${value % 5}` };
		}
	}
}

/** Every file's text after an edit result (all files, changed or not). */
export function filesAfter(snap: WorkspaceSnapshot, r: EditResult): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [p, f] of snap.files) {
		const cs = r.status === 'edit' ? r.edit.changes[p] : undefined;
		out[p] = cs ? cs.apply(f.text).toString() : f.text.toString();
	}
	return out;
}
