// SPDX-License-Identifier: GPL-2.0-or-later
// The copies in sites.ts give what the originals give: `ownSites` as tjp/edit/props.ts does, and
// `siteState` as inspector/field.ts does, over every attribute of a plan with own, scenario, macro and
// unreadable statements; and the reading-order helpers.
import { describe, expect, it } from 'vitest';
import { siteState as original } from '../inspector/field';
import { ownSites as originalOwn } from '../tjp/edit/props';
import { setup } from '../tjp/edit/testing';
import { ownSites, readBeforeOf, sameFileBefore, siteState, UNSET } from './sites';

const TEXT = `project p "P" 2026-03-02 +8w {
  scenario plan "Plan" { scenario delayed "Delayed" }
}
macro R [ 450 ]
resource a "A" {
  efficiency 0.8
  rate \${R}
  email "a@example.com"
  delayed:efficiency 0.5
  managers boss, lead
  workinghours mon 9:00 - 12:00
  workinghours tue off
}
resource boss "Boss"
resource lead "Lead"
`;
const s = setup(TEXT);

describe('ownSites and siteState are the originals’ results', () => {
	const a = s.index.resources.get('a')!;
	const keywords = ['efficiency', 'rate', 'email', 'managers', 'workinghours', 'nothing'];

	it('ownSites picks the same sites, in the same order, of the top scenario', () => {
		for (const k of keywords) {
			expect(ownSites(s.index, a.attrs, k)).toEqual(originalOwn(s.index, a.attrs, k));
		}
		expect(ownSites(s.index, a.attrs, 'workinghours')).toHaveLength(2);
		expect(ownSites(s.index, a.attrs, 'efficiency')).toHaveLength(1);
	});

	it('siteState says the same of each site: own, or text only with the reason', () => {
		for (const k of keywords) {
			for (const site of ownSites(s.index, a.attrs, k)) {
				expect(siteState(site)).toEqual(original(site));
			}
		}
		const rate = ownSites(s.index, a.attrs, 'rate')[0]!;
		expect(siteState(rate)).toMatchObject({ kind: 'text-only', reason: 'macro-call' });
		expect(siteState(ownSites(s.index, a.attrs, 'efficiency')[0]!)).toMatchObject({
			kind: 'own',
			text: '0.8',
		});
	});

	it('UNSET is the unset state', () => {
		expect(UNSET).toEqual({ kind: 'unset' });
	});
});

describe('reading order', () => {
	const at = (file: string, from: number) => ({ file, from, to: from + 1 });

	it('without the includes, a position in one file is before one further on, other files count as before', () => {
		expect(sameFileBefore(at('plan.tjp', 1), at('plan.tjp', 5))).toBe(true);
		expect(sameFileBefore(at('plan.tjp', 5), at('plan.tjp', 1))).toBe(false);
		expect(sameFileBefore(at('a.tji', 9), at('plan.tjp', 1))).toBe(true);
	});

	it('with the includes of the plan, an included file is read where it is included', () => {
		const ws = setup({
			'plan.tjp': 'project p "P" 2026-03-02 +8w\ninclude "a.tji"\nresource z "Z"\n',
			'a.tji': 'resource y "Y"\n',
		});
		const before = readBeforeOf(ws.snap.includes);
		const y = ws.index.resources.get('y')!.decl.header;
		const z = ws.index.resources.get('z')!.decl.header;
		expect(before(y, z)).toBe(true);
		expect(before(z, y)).toBe(false);
	});
});
