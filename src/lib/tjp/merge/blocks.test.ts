// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseTjp } from '../document';
import { blocksTouched, touchedByBoth } from './blocks';
import { diff3Regions, lineStarts, splitLines } from './lines';

const H = 'project p "P" 2027-01-04 +3m\n';

/** The base text of each block both sides changed statements of. */
function forced(base: string, ours: string, theirs: string): string[] {
	const [o, a, b] = [base, ours, theirs].map(splitLines) as [string[], string[], string[]];
	const tree = parseTjp(base);
	return touchedByBoth(tree, diff3Regions(o, a, b), lineStarts(o)).blocks.map(
		(r) => base.slice(r.from, r.to).split('\n')[0],
	) as string[];
}

describe('touchedByBoth', () => {
	const base = `${H}task a "A" {\n  effort 1d\n  task b "B" {\n    effort 2d\n  }\n  note "x"\n}\ntask c "C" {\n  effort 3d\n}\n`;

	it('finds a block both sides changed statements of, at different lines', () => {
		const ours = base.replace('effort 1d', 'effort 4d');
		const theirs = base.replace('note "x"', 'note "y"');
		expect(forced(base, ours, theirs)).toEqual(['task a "A" {']);
	});

	it('leaves blocks only one side changed alone', () => {
		const ours = base.replace('effort 1d', 'effort 4d');
		const theirs = base.replace('effort 3d', 'effort 5d');
		expect(forced(base, ours, theirs)).toEqual([]);
	});

	it('counts additions before the closing brace', () => {
		const ours = base.replace('  note "x"\n}', '  note "x"\n  priority 1\n}');
		const theirs = base.replace('effort 1d', 'effort 6d');
		expect(forced(base, ours, theirs)).toEqual(['task a "A" {']);
	});

	it('forces a nested block both change inside, not the block around it', () => {
		const ours = base.replace('  note "x"\n}', '  note "x"\n  priority 1\n}');
		expect(forced(base, ours, base.replace('effort 2d', 'effort 6d'))).toEqual([]);
		const inner = base.replace('    effort 2d\n', '    effort 2d\n    note "b"\n');
		expect(forced(base, inner, base.replace('effort 2d', 'effort 6d'))).toEqual(['task b "B" {']);
	});

	it('sees one-line bodies and a brace on its own line', () => {
		const one = `${H}task a "A" { effort 1d }\ntask c "C"\n{\n  effort 3d\n}\n`;
		expect(
			forced(
				one,
				one.replace('{ effort 1d', '{ priority 1 effort 1d'),
				one.replace('effort 1d }', 'effort 1d note "n" }'),
			),
		).toEqual(['task a "A" { effort 1d }']);
		expect(
			forced(
				one,
				one.replace('{\n  effort 3d', '{\n  priority 1\n  effort 3d'),
				one.replace('  effort 3d\n}', '  effort 3d\n  note "n"\n}'),
			),
		).toEqual(['task c "C"']);
	});

	it('sees a task without an id', () => {
		const anon = `${H}task "A" {\n  effort 1d\n  note "x"\n}\n`;
		const ours = anon.replace('effort 1d', 'effort 4d');
		const theirs = anon.replace('note "x"', 'note "y"');
		expect(forced(anon, ours, theirs)).toEqual(['task "A" {']);
	});
});

describe('blocksTouched', () => {
	it('gives the innermost block holding a range, and the blocks the range reaches into', () => {
		const t = `${H}task a "A" {\n  task b "B" { effort 1d }\n}\n`;
		const tree = parseTjp(t);
		const at = t.indexOf('effort');
		const names = (from: number, to: number): string[] =>
			blocksTouched(tree, from, to).owners.map((n) => t.slice(n.from, t.indexOf('"', n.from)));
		expect(names(at, at + 6)).toEqual(['task b ']);
		expect(names(at, at)).toEqual(['task b ']);
		const line = t.indexOf('  task b');
		expect(names(line, t.indexOf('\n', line) + 1).sort()).toEqual(['task a ', 'task b ']);
	});
});
