// SPDX-License-Identifier: GPL-2.0-or-later
// Fragments for incremental reparsing (fragments.ts). Equality with fresh parses over random edits
// is in parser.property.test.ts; this checks reuse and the error cut.
import { describe, expect, it } from 'vitest';
import { reuseFragments } from './fragments';
import { tjpGlobalParser } from './parser';

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
