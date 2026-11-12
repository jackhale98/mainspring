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
const REMOVABLE: readonly TaskAttr[] = [
	'effort',
	'priority',
	'note',
	'complete',
	'milestone',
	'scheduling',
	'flags',
	'responsible',
];
const DATES: readonly TaskAttr[] = ['start', 'end', 'minstart', 'maxend'];
const DAY = 86_400;

/** A date `days` after the project start, as TaskJuggler text (`2026-01-07`), or null. */
function dateIn(c: AttrCorpus, days: number): string | null {
	const p = c.index.project;
	if (p?.start == null || p.end == null) return null;
	const span = Math.floor((p.end - p.start) / DAY);
	if (span < 6) return null;
	const at = p.start + (2 + (days % (span - 4))) * DAY;
	return new Date(at * 1000).toISOString().slice(0, 10);
}

/** Up to two items of `all`, chosen by `value`. */
function some(all: readonly string[], value: number): string[] {
	const a = all[value % Math.max(1, all.length)];
	const b = all[Math.floor(value / 7) % Math.max(1, all.length)];
	return [...new Set([a, b].filter((x): x is string => x !== undefined))];
}

/** Tasks the edit API must refuse to touch: expanded only, or with own sites written as macros. */
export function textOnlyTasks(c: AttrCorpus): string[] {
	return c.tasks.filter((t) => {
		const sym = c.index.tasks.get(t);
		return sym && (sym.expandedOnly || sym.attrs.some((a) => a.textOnly !== null));
	});
}

const TASK_ATTRS: ReadonlySet<string> = new Set<TaskAttr>([
	...VALUES.map(([a]) => a),
	...REMOVABLE,
	...DATES,
]);

/**
 * A random intent for a corpus (`pick` chooses the task, `value` the rest). Kinds: 0 a value from
 * VALUES, 1 `milestone`, 2 `removeAttr`, 3 `renameTask`, 4 `flags` or `declareFlag`, 5 a date,
 * 6 `responsible`, 7 an intent aimed at a text-only element (falls back to kind 0).
 */
export function intentFor(c: AttrCorpus, kind: number, pick: number, value: number): EditIntent {
	const task = c.tasks[pick % c.tasks.length] ?? '';
	switch (kind) {
		case 0: {
			const [attr, v] = VALUES[value % VALUES.length] ?? ['priority', '650'];
			return { type: 'setAttr', task, attr, value: v };
		}
		case 1:
			return { type: 'setAttr', task, attr: 'milestone', value: value % 2 === 0 };
		case 2: {
			// Mostly an attribute the task has, so that removals are not all no-ops. Half of them go to
			// a task (from `pick` on) with an attribute other than a size: removing the last size of an
			// allocated leaf is often refused (it would be underspecified), and corpus tasks seldom
			// have anything else to remove.
			const sizes = new Set(['effort', 'length', 'duration', 'milestone']);
			const has = (t: string, a: string): boolean =>
				c.index.tasks.get(t)?.attrs.some((s) => s.keyword === a) ?? false;
			const others = REMOVABLE.filter((a) => !sizes.has(a));
			if (value % 2 === 0) {
				for (let i = 0; i < c.tasks.length; i++) {
					const t = c.tasks[(pick + i) % c.tasks.length] ?? '';
					const there = others.filter((a) => has(t, a));
					if (there.length > 0) {
						return { type: 'removeAttr', task: t, attr: there[value % there.length] ?? 'note' };
					}
				}
			}
			const present = REMOVABLE.filter((a) => has(task, a));
			const from = present.length > 0 && value % 4 !== 0 ? present : REMOVABLE;
			return { type: 'removeAttr', task, attr: from[value % from.length] ?? 'note' };
		}
		case 3:
			return { type: 'renameTask', task, name: `Renamed ${value % 7} "q" 'x'` };
		case 5: {
			const attr = DATES[value % DATES.length] ?? 'start';
			return { type: 'setAttr', task, attr, value: dateIn(c, value) ?? '2026-01-07' };
		}
		case 6: {
			const ids = some([...c.index.resources.keys()], value);
			return { type: 'setAttr', task, attr: 'responsible', value: ids };
		}
		case 7: {
			const hit = textOnlyTasks(c);
			const t = hit[pick % Math.max(1, hit.length)];
			const sym = t === undefined ? undefined : c.index.tasks.get(t);
			if (!t || !sym) return intentFor(c, 0, pick, value);
			const site = sym.attrs.find((a) => a.textOnly !== null && TASK_ATTRS.has(a.keyword));
			if (!site) return intentFor(c, value % 2 === 0 ? 0 : 3, c.tasks.indexOf(t), value);
			const attr = site.keyword as TaskAttr;
			if (value % 2 === 0) return { type: 'removeAttr', task: t, attr };
			const v = VALUES.find(([a]) => a === attr)?.[1] ?? dateIn(c, value) ?? '1d';
			return { type: 'setAttr', task: t, attr, value: v };
		}
		default: {
			const flags = [...c.index.flags.keys()];
			const f = flags[value % (flags.length + 1)];
			if (f !== undefined && value % 2 === 0) {
				return { type: 'setAttr', task, attr: 'flags', value: some(flags, value) };
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
