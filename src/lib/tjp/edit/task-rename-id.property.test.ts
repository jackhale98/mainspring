// SPDX-License-Identifier: GPL-2.0-or-later
// The id follows the name, over generated plans (task-rename-id-testing.ts), text only (the engine
// half is task-rename-id.engine.test.ts):
// - sound: a task that anything refers to, or that has children, keeps its id; so does one
//   without an automatic id;
// - complete: an automatic-id task that nothing names gets the slug of its new name, unless that
//   is its id already (no claim when another task with the same local id is named);
// - the edit changes only the header's id token and name string, the new text parses with no new
//   error, and a fresh index reads the same tree with the task under its new id, every
//   dependency naming the same (mapped) tasks;
// - the inverse restores the text byte for byte.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { syntaxIssues } from '../document';
import type { SymbolIndex } from '../index';
import { slugId } from '../values';
import { applyIntent } from './apply';
import { idMap } from './task-refs';
import { followingId, isAutomaticId } from './task-rename-id';
import { FIRST_NAME, genPlan } from './task-rename-id-testing';
import { setup, textsAfter } from './testing';

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const deps = (index: SymbolIndex, map: (id: string) => string = (x) => x): string[] =>
	index.dependencies.map((d) => `${map(d.succ ?? '?')}<-${map(d.pred ?? '?')}`).sort();

describe('the id follows the name (generated plans)', () => {
	it('is sound, complete, local, parses and keeps the tree', () => {
		let changed = 0;
		fc.assert(
			fc.property(genPlan, (g) => {
				const s = setup(g.text);
				const sym = s.index.tasks.get(g.task);
				expect(sym).toBeDefined();
				if (!sym) return;
				const id = followingId(s.index, g.task, g.name, FIRST_NAME);
				const auto = isAutomaticId(sym.localId, FIRST_NAME);
				if (!auto || g.named.has(g.task)) {
					expect(id).toBeNull();
					return;
				}
				// A reference to another task with the same local id may keep this one too (the index's
				// mention scan matches `!new_task` and `.new_task`, the safe side): no claim then.
				const local = (x: string): string => x.slice(x.lastIndexOf('.') + 1);
				if ([...g.named].some((x) => local(x) === sym.localId)) return;
				const siblings = (
					sym.parent === null ? s.index.taskRoots : (s.index.tasks.get(sym.parent)?.children ?? [])
				)
					.filter((x) => x !== sym.id)
					.map((x) => x.slice(x.lastIndexOf('.') + 1));
				// An id a report mentions (its full id, or `.local` in a longer one) would give that text a
				// new meaning: it counts as taken.
				const full = (x: string): string => (sym.parent === null ? x : `${sym.parent}.${x}`);
				const mentioned = (x: string): boolean =>
					g.opaque.some((t) => t === full(x) || (t.includes('.') && local(t) === x));
				const slug = slugId(g.name, (x) => siblings.includes(x) || mentioned(x));
				expect(id).toBe(slug === sym.localId ? null : slug);
				if (id === null) return;
				const r = applyIntent(s.snap, s.index, {
					type: 'renameTask',
					task: g.task,
					name: g.name,
					id,
				});
				if (r.status !== 'edit') throw new Error(`${r.status} ${JSON.stringify(r)}`);
				changed++;
				const header = sym.decl.header;
				for (const t of r.edit.targets['plan.tjp'] ?? []) {
					expect(t.from).toBeGreaterThanOrEqual(header.from);
					expect(t.to).toBeLessThanOrEqual(header.to);
				}
				const out = textsAfter(s.snap, r)['plan.tjp'] ?? '';
				const after = setup(out);
				const file = after.file();
				expect(syntaxIssues(file.tree, file.text)).toEqual([]);
				const next = sym.parent === null ? id : `${sym.parent}.${id}`;
				const map = idMap(sym.id, next);
				expect([...after.index.tasks.keys()]).toEqual([...s.index.tasks.keys()].map(map));
				for (const [old, t] of s.index.tasks) {
					const now = after.index.tasks.get(map(old));
					expect(now?.parent).toBe(t.parent === null ? null : map(t.parent));
					expect(now?.name).toBe(old === sym.id ? g.name : t.name);
				}
				expect(deps(after.index)).toEqual(deps(s.index, map));
				const inv = r.edit.inverse['plan.tjp'];
				expect(inv?.apply(after.file().text).toString()).toBe(g.text);
			}),
			{ numRuns: 300, ...SEED },
		);
		// The generator must reach the edit, not only the cases that keep the id.
		expect(changed).toBeGreaterThan(20);
	});
});
