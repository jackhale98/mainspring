// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	inheritedSites,
	insertAttr,
	macroWritten,
	otherScenarioSites,
	ownSites,
	readBefore,
	removeSites,
	resourceOf,
	topOf,
} from './props';
import { ops, setup } from './testing';

const PLAN = `project p "P" 2026-01-05 +2m {
  scenario base "Base" { scenario alt "Alt" }
}
resource g "G" {
  rate 10
  resource a "A" {
    alt:rate 20
    base:rate 30
  }
  rate 40
  resource b "B"
}
`;

describe('props', () => {
	const s = setup(PLAN);
	const res = (id: string) => {
		const r = resourceOf(s.ctx, id);
		if ('status' in r) throw new Error(id);
		return r;
	};

	it('splits own sites (top scenario) from other scenarios', () => {
		expect(topOf(s.index)).toBe('base');
		expect(ownSites(s.index, res('a').attrs, 'rate').map((x) => x.scenario)).toEqual(['base']);
		expect(otherScenarioSites(s.index, res('a').attrs, 'rate').map((x) => x.scenario)).toEqual([
			'alt',
		]);
		expect(macroWritten(res('a').attrs)).toBeNull();
		expect(resourceOf(s.ctx, 'nobody')).toMatchObject({ reason: 'unknown-target' });
	});

	it('inherits only what the parent set before the child was declared', () => {
		const a = inheritedSites(s.ctx, res('a'), 'rate').map((x) =>
			s.file().text.sliceString(x.statement.from, x.statement.to),
		);
		expect(a).toEqual(['rate 10']);
		const b = inheritedSites(s.ctx, res('b'), 'rate').map((x) =>
			s.file().text.sliceString(x.statement.from, x.statement.to),
		);
		expect(b).toEqual(['rate 10', 'rate 40']);
		expect(readBefore(s.ctx, res('g').decl.block, res('b').decl.block)).toBe(true);
	});

	it('inserts before another scenario site of the attribute, and removes sites', () => {
		const a = res('a');
		const others = otherScenarioSites(s.index, a.attrs, 'rate');
		const ins = ops(insertAttr(s.ctx, a.decl.block, 'resource', 'rate', 'rate 5', others));
		expect(ins[0]?.from).toBe(PLAN.indexOf('    alt:rate'));
		const del = ops(removeSites(s.ctx, ownSites(s.index, a.attrs, 'rate')));
		expect(PLAN.slice(del[0]?.from, del[0]?.to)).toBe('    base:rate 30\n');
	});
});
