// SPDX-License-Identifier: GPL-2.0-or-later
// Fragments for incremental reparsing (fragments.ts). Equality with fresh parses over random edits
// is in parser.property.test.ts; this checks reuse and the error cut.
import type { TreeFragment } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import { readTjp, serialize } from '../../../../tests/grammar/corpus';
import { reparse, reuseFragments } from './fragments';
import { tjpGlobalParser, tjpParser } from './parser';

const tasks = (n: number): string =>
	Array.from({ length: n }, (_, i) => `task t${i} "T${i}" {\n  effort ${i + 1}d\n}\n`).join('');

describe('reuseFragments', () => {
	it('keeps error-free text reusable around an edit', () => {
		const text = tasks(200);
		const tree = tjpGlobalParser.parse(text);
		const at = text.indexOf('task t100');
		const fragments = reuseFragments(tree, [{ fromA: at, toA: at, fromB: at, toB: at + 1 }]);
		const covered = fragments.reduce((n, f) => n + (f.to - f.from), 0);
		expect(covered).toBeGreaterThan(text.length * 0.9);
		const edited = `${text.slice(0, at)}#${text.slice(at)}`;
		expect(tjpGlobalParser.parse(edited, fragments).toString()).toBe(
			tjpGlobalParser.parse(edited).toString(),
		);
	});

	it('drops the text around an old error node', () => {
		const text = tasks(100);
		const bad = text.indexOf('task t50');
		const broken = `${text.slice(0, bad)}@${text.slice(bad)}`;
		const tree = tjpGlobalParser.parse(broken);
		const fragments = reuseFragments(tree, [{ fromA: 0, toA: 0, fromB: 0, toB: 0 }]);
		for (const f of fragments) expect(f.to <= bad - 256 || f.from >= bad + 257).toBe(true);
		expect(fragments.length).toBeGreaterThan(1);
	});
});

describe('reparse', () => {
	it('equals a fresh parse when an edit creates errors far from the old ones', () => {
		// Regression (fast-check): in the prolog context, `*(` and then `{(` at the start turn the
		// rest of Fedora's reports.tji into a parenthesised group inside a body; recovery from a
		// new error deep inside used to reuse old nodes and recover differently.
		const parser = tjpParser('prolog');
		let text = readTjp('engine/tj/examples/Fedora-20/reports.tji');
		let tree = parser.parse(text);
		let fragments: readonly TreeFragment[] = [];
		for (const [from, del, insert] of [
			[0, 0, '*('],
			[0, 1, '{'],
		] as const) {
			text = text.slice(0, from) + insert + text.slice(from + del);
			const change = [{ fromA: from, toA: from + del, fromB: from, toB: from + insert.length }];
			({ tree, fragments } = reparse(parser, text, tree, change, fragments));
			expect(serialize(tree)).toEqual(serialize(parser.parse(text)));
		}
	});

	it('reuses error-free text', () => {
		const text = tasks(200);
		const tree = tjpGlobalParser.parse(text);
		const at = text.indexOf('task t100');
		const edited = `${text.slice(0, at)}# c\n${text.slice(at)}`;
		const change = [{ fromA: at, toA: at, fromB: at, toB: at + 4 }];
		const result = reparse(tjpGlobalParser, edited, tree, change);
		const covered = result.fragments.reduce((n, f) => n + (f.to - f.from), 0);
		expect(covered).toBeGreaterThan(text.length * 0.9);
		expect(result.tree.toString()).toBe(tjpGlobalParser.parse(edited).toString());
	});

	describe('when the edit creates an error next to reused text', () => {
		// `#` comments out a task header, so its body's attributes stand at the top level.
		const text = tasks(200);
		const tree = tjpGlobalParser.parse(text);
		const at = text.indexOf('task t100');
		const edited = `${text.slice(0, at)}#${text.slice(at)}`;
		const change = [{ fromA: at, toA: at, fromB: at, toB: at + 1 }];
		const fresh = serialize(tjpGlobalParser.parse(edited));

		it('cuts the error region and still reuses the rest', () => {
			const result = reparse(tjpGlobalParser, edited, tree, change);
			expect(serialize(result.tree)).toEqual(fresh);
			const covered = result.fragments.reduce((n, f) => n + (f.to - f.from), 0);
			expect(covered).toBeGreaterThan(text.length * 0.9);
		});

		it('parses afresh once the rounds run out', () => {
			const result = reparse(tjpGlobalParser, edited, tree, change, undefined, 1);
			expect(result.fragments).toEqual([]);
			expect(serialize(result.tree)).toEqual(fresh);
		});
	});
});
