// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { depOnEnd, itemNode, orphanDeps } from './dep-orphans';
import { setup } from './testing';

const HEAD = 'project p "P" 2026-01-05 +2m\n';

describe('orphanDeps', () => {
	it('resolves items of unnamed declarations from the named task around them', () => {
		const s = setup(
			HEAD +
				'task top "Top" {\n  task wp1 "WP1"\n  task del "Del" {\n' +
				'    task "Item 1" { depends !!wp1 }\n' +
				'    task "Item 2" {\n      task "Deep" { depends !!!wp1, top.wp1 { onstart } }\n    }\n' +
				'    task "Item 3" { precedes !x, !!!!wp1 }\n  }\n}\n',
		);
		const o = orphanDeps(s.snap, s.index);
		expect(o.map((x) => [x.within, x.form, x.target, x.onEnd])).toEqual([
			['top.del', 'depends', 'top.wp1', true],
			['top.del', 'depends', 'top.wp1', true],
			['top.del', 'depends', 'top.wp1', false],
		]);
		// The two items of "Deep" share one owner, distinct from "Item 1".
		expect(new Set(o.map((x) => x.owner)).size).toBe(2);
	});

	it('skips named owners and unresolvable references', () => {
		const s = setup(HEAD + 'task a "A"\ntask b "B" { depends !a }\ntask "C" { depends nope }\n');
		expect(orphanDeps(s.snap, s.index)).toEqual([]);
	});
});

describe('itemNode and depOnEnd', () => {
	it('find the item and read onstart/onend', () => {
		const s = setup(
			HEAD +
				'task a "A"\ntask b "B" { depends !a { onstart } }\ntask c "C" { precedes !a { onend } }\n',
		);
		const [b, c] = s.index.dependencies;
		if (!b || !c) throw new Error('two sites');
		expect(itemNode(s.snap, b.item.file, b.item)?.name).toBe('DepItem');
		expect(itemNode(s.snap, b.item.file, { from: b.item.from, to: b.item.to - 1 })).toBeNull();
		expect(depOnEnd(s.snap, b)).toBe(false);
		expect(depOnEnd(s.snap, c)).toBe(true);
	});
});
