// SPDX-License-Identifier: GPL-2.0-or-later
// One file all sides have (file.ts): the fast paths, the parse context from ours' include graph,
// ids, and the same result when the merge is computed again.
import { describe, expect, it } from 'vitest';
import type { Tree } from '@lezer/common';
import { mergeFile, mergeFileSteps } from '../../sync/merge';
import { createWorkspace } from '../../workspace/workspace';
import { parseTjp } from '../document';
import { finish, mergeTexts } from './file';
import { contextOf } from './testing';

const HEAD = 'project p "P" 2027-01-04 +3m\n';
const ctx = contextOf('plan.tjp', { 'plan.tjp': HEAD });

describe('mergeTexts', () => {
	it('returns a side unchanged when the other did not change or both are equal', () => {
		const b = `${HEAD}task a "A"\n`;
		const x = `${HEAD}task a "A2"\n`;
		expect(mergeTexts('plan.tjp', b, x, b, ctx)).toEqual({ text: x, conflicts: [] });
		expect(mergeTexts('plan.tjp', b, b, x, ctx)).toEqual({ text: x, conflicts: [] });
		expect(mergeTexts('plan.tjp', b, x, x, ctx)).toEqual({ text: x, conflicts: [] });
	});

	it('refines a file included in the project header in its own context', () => {
		const files = {
			'plan.tjp': 'project p "P" 2027-01-04 +3m {\n  include "head.tji"\n}\n',
			'head.tji': 'timezone "Europe/Berlin"\ncurrency "EUR"\n',
		};
		const c = contextOf('plan.tjp', files);
		expect(c.includes.tops.get('head.tji')).toBe('project');
		const m = mergeTexts(
			'head.tji',
			files['head.tji'],
			'timezone "Europe/Paris"\ncurrency "EUR"\n',
			'timezone "Europe/Berlin"\ncurrency "USD"\n',
			c,
		);
		expect(m).toEqual({ text: 'timezone "Europe/Paris"\ncurrency "USD"\n', conflicts: [] });
	});

	it('gives the same result and ids when computed again', () => {
		const t = (e: string): string => `${HEAD}task a "A" {\n  effort ${e}\n}\n`;
		const first = mergeTexts('plan.tjp', t('1d'), t('2d'), t('3d'), ctx);
		expect(first.conflicts).toHaveLength(1);
		expect(mergeTexts('plan.tjp', t('1d'), t('2d'), t('3d'), ctx)).toEqual(first);
		// Newer ours elsewhere in the file: the same id.
		const newer = mergeTexts('plan.tjp', t('1d'), `${t('2d')}task z "Z"\n`, t('3d'), ctx);
		expect(newer.conflicts.map((c) => c.id)).toEqual(first.conflicts.map((c) => c.id));
	});

	it('tells apart conflicts equal in all an id is made of by their order', () => {
		const p = {
			subject: { kind: 'text' } as const,
			base: null,
			ours: 'x',
			theirs: 'y',
			at: { from: 0, to: 1 },
			atOurs: { from: 0, to: 1 },
			atBase: { from: 3, to: 3 },
			both: true,
		};
		const ids = finish('a.tji', [p, { ...p, at: { from: 2, to: 3 } }]).map((c) => c.id);
		expect(ids[1]).toBe(`${ids[0]}~1`);
	});
});

describe('mergeFileSteps and ours’ trees (rule 5)', () => {
	const big = (e: (i: number) => string): string =>
		HEAD +
		Array.from({ length: 400 }, (_, i) => `task t${i} "T${i}" {\n  effort ${e(i)}\n}\n`).join('');
	const base = big(() => '1d');
	const ours = big((i) => (i === 200 ? '2d' : i === 5 ? '4d' : '1d'));
	const theirs = big((i) => (i === 200 ? '3d' : i === 390 ? '6d' : '1d'));

	it('pauses during a large merge and gives mergeFile’s result', () => {
		const steps = mergeFileSteps('plan.tjp', base, ours, theirs, ctx);
		let pauses = 0;
		let r = steps.next();
		while (!r.done) {
			pauses++;
			r = steps.next();
		}
		expect(pauses).toBeGreaterThan(3);
		expect(r.value).toEqual(mergeFile('plan.tjp', base, ours, theirs, ctx));
		expect(r.value.conflicts.map((c) => c.subject.kind)).toEqual(['attribute']);
	});

	it('gives the same result with ours’ tree from the workspace, and ignores a tree of other text', () => {
		const tree = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': ours } })
			.snapshot()
			.files.get('plan.tjp')?.tree;
		expect(tree).toBeDefined();
		const plain = mergeFile('plan.tjp', base, ours, theirs, ctx);
		const withTree = { ...ctx, trees: new Map([['plan.tjp', tree as Tree]]) };
		expect(mergeFile('plan.tjp', base, `${ours}`, theirs, withTree)).toEqual(plain);
		const other = { ...ctx, trees: new Map([['plan.tjp', parseTjp(HEAD)]]) };
		expect(mergeFile('plan.tjp', base, ours, theirs, other)).toEqual(plain);
	});
});
