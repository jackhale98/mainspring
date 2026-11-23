// SPDX-License-Identifier: GPL-2.0-or-later
// Repeatable and single-valued statements (keywords.ts).
import type { SyntaxNode } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import { parseTjp } from '../document';
import { statementsIn } from '../tree';
import { keywordOf, repeatable, REPEATABLE, slotOf } from './keywords';

describe('keywords', () => {
	it('marks the list attributes and accumulating rules repeatable, the rest single-valued', () => {
		for (const k of [
			'depends',
			'allocate',
			'flags',
			'booking',
			'leaves',
			'workinghours',
			'shifts',
		]) {
			expect(repeatable(k), k).toBe(true);
		}
		for (const k of [
			'priority',
			'start',
			'complete',
			'rate',
			'timezone',
			'effort',
			'limits',
			'nosuch',
		]) {
			expect(repeatable(k), k).toBe(false);
		}
		expect(REPEATABLE.size).toBe(30);
	});

	it('gives the sizing criteria one slot per scenario, and other statements their key', () => {
		const t =
			'task a "A" {\n  effort 1d\n  delayed:length 2d\n  milestone\n  priority 5\n  depends b\n}\n';
		const body = statementsIn(parseTjp(t).topNode)[0]?.getChild('Body') as SyntaxNode;
		const stmts = statementsIn(body);
		expect(stmts.map((s) => slotOf(s, t))).toEqual([
			'sizing',
			'delayed:sizing',
			'sizing',
			'priority',
			'depends',
		]);
		expect(stmts.map((s) => keywordOf(s, t))).toEqual([
			'effort',
			'length',
			'milestone',
			'priority',
			'depends',
		]);
	});
});
