// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	inheritedItems,
	inheritedLink,
	isAncestor,
	linkItems,
	linkTasks,
	rangeKey,
	unprefixed,
} from './deps-links';
import { setup } from './testing';

const PLAN =
	'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario d "D"\n  }\n}\n' +
	'task a "A" { precedes !b }\ntask b "B" { depends !a d:depends !a }\n' +
	'task g "G" {\n  depends a\n  task x "X"\n}\n';

describe('link helpers', () => {
	const s = setup(PLAN);

	it('finds the own items of a link, once each', () => {
		const items = linkItems(s.index, 'b', 'a');
		expect(items.map((d) => `${d.form}:${d.scenario ?? ''}`).sort()).toEqual([
			'depends:',
			'depends:d',
			'precedes:',
		]);
		expect(new Set(items.map((d) => rangeKey(d.item))).size).toBe(3);
		expect(linkItems(s.index, 'a', 'b')).toEqual([]);
	});

	it('treats the top scenario prefix as none', () => {
		expect(unprefixed(s.index, null)).toBe(true);
		expect(unprefixed(s.index, 'plan')).toBe(true);
		expect(unprefixed(s.index, 'd')).toBe(false);
	});

	it('knows ancestors and inherited links', () => {
		expect(isAncestor(s.index, 'g', 'g.x')).toBe(true);
		expect(isAncestor(s.index, 'g.x', 'g')).toBe(false);
		expect(isAncestor(s.index, 'g', 'g')).toBe(false);
		expect(inheritedLink(s.ctx, 'g.x', 'a')).toBe(true);
		expect(inheritedLink(s.ctx, 'g', 'a')).toBe(false);
		expect(inheritedItems(s.index, 'g.x', 'a')).toHaveLength(1);
	});

	it('refuses unknown tasks', () => {
		expect(linkTasks(s.ctx, 'b', 'zz')).toMatchObject({
			status: 'refused',
			reason: 'unknown-target',
		});
		expect(linkTasks(s.ctx, 'b', 'a')).toMatchObject({ succ: { id: 'b' }, pred: { id: 'a' } });
	});
});
