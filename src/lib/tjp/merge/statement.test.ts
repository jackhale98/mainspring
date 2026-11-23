// SPDX-License-Identifier: GPL-2.0-or-later
// Aligned elements (statement.ts): statements sharing a line, a replaced sizing statement, a body
// given on both sides, comments above a statement.
import { describe, expect, it } from 'vitest';
import { merge1, resolveAll } from './testing';

const HEAD = 'project p "P" 2027-01-04 +3m\nresource dev "Dev"\n';
const text = (m: ReturnType<typeof merge1>): string => m.files.get('plan.tjp') ?? '';
const one = (body: string): string => `${HEAD}task a "A" {${body}}\n`;

describe('statements sharing a line', () => {
	it('merges different statements of a one-line body cleanly', () => {
		const m = merge1(
			one(' effort 2h depends b '),
			one(' effort 3h depends b '),
			one(' effort 2h depends c '),
		);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(one(' effort 3h depends c '));
	});

	it('makes one statement of a one-line body changed both ways an attribute conflict', () => {
		const m = merge1(
			one(' effort 2h depends b '),
			one(' effort 3h depends b '),
			one(' effort 4h depends b '),
		);
		expect(m.conflicts.map((c) => [c.subject.kind, c.ours, c.theirs])).toEqual([
			['attribute', 'effort 3h', 'effort 4h'],
		]);
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toBe(one(' effort 4h depends b '));
	});

	it('pairs a statement both sides added to a one-line body by key', () => {
		const m = merge1(
			one(' effort 10h '),
			one(' priority 17 effort 10h '),
			one(' priority 23 effort 10h '),
		);
		expect(m.conflicts.map((c) => [c.subject.kind, c.base, c.ours, c.theirs])).toEqual([
			['attribute', null, 'priority 17', 'priority 23'],
		]);
	});
});

describe('one statement replaced by another', () => {
	it('is one attribute conflict, named by the sides’ keyword', () => {
		const t = (s: string): string => `${HEAD}task a "A" {\n  ${s}\n  allocate dev\n}\n`;
		const m = merge1(t('effort 2d'), t('duration 17d'), t('duration 23d'));
		expect(
			m.conflicts.map((c) => [c.subject.kind === 'attribute' && c.subject.attr, c.base]),
		).toEqual([['duration', 'effort 2d']]);
		const mixed = merge1(t('effort 2d'), t('duration 17d'), t('length 23d'));
		expect(mixed.conflicts.map((c) => c.subject.kind === 'attribute' && c.subject.attr)).toEqual([
			'effort',
		]);
	});
});

describe('blocks', () => {
	it('merges a body both sides gave a task that had none', () => {
		const t = (b: string): string => `${HEAD}task a "A"${b}\ntask b "B"\n`;
		const m = merge1(t(''), t(' {\n  priority 17\n}'), t(' {\n  priority 23\n}'));
		expect(m.conflicts.map((c) => [c.subject.kind, c.ours, c.theirs])).toEqual([
			['attribute', 'priority 17', 'priority 23'],
		]);
		expect(text(m)).toBe(t(' {\n  priority 17\n}'));
	});

	it('merges a comment above a statement and the statement changed on different sides', () => {
		const t = (c: string, e: string): string => `${HEAD}task a "A" {\n  # ${c}\n  effort ${e}\n}\n`;
		const m = merge1(t('estimate', '1d'), t('estimate, checked', '1d'), t('estimate', '2d'));
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(t('estimate, checked', '2d'));
	});
});
