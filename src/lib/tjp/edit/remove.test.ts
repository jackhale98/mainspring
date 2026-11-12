// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { finishPlan } from './apply';
import {
	removeListItem,
	removeListItems,
	removeStatement,
	removeStatements,
	type Removal,
} from './remove';
import type { EditOp, Span } from './types';
import { setup, span, stmt, textsAfter } from './testing';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';
const FAKE = { type: 'deleteTask', task: 'x' } as const;

function run(text: string, make: (s: ReturnType<typeof setup>) => EditOp[] | EditOp): string {
	const s = setup(text);
	const o = make(s);
	return textsAfter(s.snap, finishPlan(s.ctx, FAKE, Array.isArray(o) ? o : [o]))['plan.tjp'] ?? '';
}

describe('removeStatement', () => {
	const remove = (text: string, needle: string, leading?: string): string =>
		run(text, (s) =>
			removeStatement(s.file(), stmt(s.file(), needle), {
				leading: leading ? span(s.file(), leading) : null,
			}),
		);

	it('removes the line when nothing else is on it', () => {
		const p = HEAD + 'task a "A" {\n  effort 5d\n  start 2026-01-05\n}\n';
		expect(remove(p, 'effort')).toBe(HEAD + 'task a "A" {\n  start 2026-01-05\n}\n');
	});

	it('keeps a trailing comment', () => {
		const p = HEAD + 'task a "A" {\n  effort 5d # why\n}\n';
		expect(remove(p, 'effort')).toBe(HEAD + 'task a "A" {\n  # why\n}\n');
	});

	it('removes only the statement on a shared line', () => {
		const p = HEAD + 'task a "A" { effort 5d start 2026-01-05 }\n';
		expect(remove(p, 'effort')).toBe(HEAD + 'task a "A" { start 2026-01-05 }\n');
		expect(remove(p, 'start 2026-01-05')).toBe(HEAD + 'task a "A" { effort 5d }\n');
		expect(remove(HEAD + 'task a "A" {\n  effort 5d }\n', 'effort')).toBe(
			HEAD + 'task a "A" {\n  }\n',
		);
		expect(remove(HEAD + 'task a "A" { effort 5d # c\n}\n', 'effort')).toBe(
			HEAD + 'task a "A" { # c\n}\n',
		);
	});

	it('removes a block with its attached comments', () => {
		const p = HEAD + 'task k "K"\n\n# about b\n# more\ntask b "B" {\n  effort 1d\n}\n';
		expect(remove(p, 'task b', '# about b\n# more')).toBe(HEAD + 'task k "K"\n\n');
	});

	it('handles the last line without a break, CRLF and a lone CR', () => {
		expect(remove(HEAD + 'task k "K"\ntask b "B"', 'task b')).toBe(HEAD + 'task k "K"\n');
		const crlf = (HEAD + 'task a "A" {\n  effort 5d\n}\n').replace(/\n/g, '\r\n');
		expect(remove(crlf, 'effort')).toBe((HEAD + 'task a "A" {\n}\n').replace(/\n/g, '\r\n'));
		const cr = (HEAD + 'task a "A" {\n  effort 5d\n}\n').replace(/\n/g, '\r');
		expect(remove(cr, 'effort')).toBe((HEAD + 'task a "A" {\n}\n').replace(/\n/g, '\r'));
	});
});

describe('removeStatements', () => {
	const p = HEAD + 'task a "A" { effort 5d start 2026-01-05 priority 3 }\n';
	const many = (text: string, needles: string[]): string =>
		run(text, (s) =>
			removeStatements(
				s.file(),
				needles.map((n): Removal => ({ stmt: stmt(s.file(), n) })),
			),
		);

	it('removes several statements on one line without overlapping ops', () => {
		expect(many(p, ['effort', 'start 2026'])).toBe(HEAD + 'task a "A" { priority 3 }\n');
		expect(many(p, ['start 2026', 'priority'])).toBe(HEAD + 'task a "A" { effort 5d }\n');
		expect(many(p, ['priority', 'effort'])).toBe(HEAD + 'task a "A" { start 2026-01-05 }\n');
		expect(many(p, ['effort', 'start 2026', 'priority'])).toBe(HEAD + 'task a "A" { }\n');
	});

	it('removes statements on their own lines', () => {
		const lines = HEAD + 'task a "A" {\n  effort 5d\n  priority 3\n  start 2026-01-05\n}\n';
		expect(many(lines, ['priority', 'effort'])).toBe(
			HEAD + 'task a "A" {\n  start 2026-01-05\n}\n',
		);
	});
});

describe('removeListItems', () => {
	const p =
		HEAD +
		'task q "Q"\ntask a "A" { task x "X" task y "Y" }\ntask s "S" {\n  depends q, a.x, a.y\n}\n';
	const items = (s: ReturnType<typeof setup>): Span[] => {
		const base = span(s.file(), 'depends q, a.x, a.y').from;
		return [
			{ from: base + 8, to: base + 9 },
			{ from: base + 11, to: base + 14 },
			{ from: base + 16, to: base + 19 },
		];
	};
	const rm = (idx: number[]): string =>
		run(
			p,
			(s) =>
				removeListItems(s.file(), items(s), idx) ??
				removeStatement(s.file(), stmt(s.file(), 'depends')),
		);

	it('removes runs of items with one separator each (deleteTask-like)', () => {
		expect(rm([1, 2])).toBe(p.replace('q, a.x, a.y', 'q'));
		expect(rm([0, 1])).toBe(p.replace('q, a.x, a.y', 'a.y'));
		expect(rm([0, 2])).toBe(p.replace('q, a.x, a.y', 'a.x'));
		expect(rm([1])).toBe(p.replace('q, a.x, a.y', 'q, a.y'));
		expect(rm([0, 1, 2])).toBe(p.replace('  depends q, a.x, a.y\n', ''));
	});

	it('gives null when nothing would be left', () => {
		const s = setup(p);
		expect(removeListItems(s.file(), items(s), [0, 1, 2])).toBeNull();
		expect(removeListItem(s.file(), items(s).slice(0, 1), 0)).toBeNull();
		expect(removeListItem(s.file(), items(s), 2)?.from).toBe(items(s)[1]?.to);
	});
});
