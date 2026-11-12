// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { finishPlan } from './apply';
import {
	appendListItem,
	insertStatement,
	rankOf,
	removeListItem,
	removeStatement,
	replaceValue,
	type Placement,
} from './layout';
import { parseValue } from '../values';
import {
	isNoop,
	isRefused,
	type EditOp,
	type EditResult,
	type Refused,
	type Noop,
	type Span,
} from './types';
import { setup, span, stmt, textsAfter } from './testing';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\n';

/** The entry file's text after one op (through the refusal pipeline). */
function run(text: string, op: (s: ReturnType<typeof setup>) => EditOp | Refused | Noop): string {
	const s = setup(text);
	const o = op(s);
	const r: EditResult = isRefused(o) || isNoop(o) ? o : finishPlan(s.ctx, FAKE, [o]);
	return textsAfter(s.snap, r)['plan.tjp'] ?? '';
}
const FAKE = { type: 'declareFlag', flag: 'x' } as const;

function insert(text: string, owner: string | null, line: string, place: Placement): string {
	return run(text, (s) =>
		insertStatement(s.file(), owner === null ? null : stmt(s.file(), owner), line, place),
	);
}
const byRank = (keyword: string): Placement => ({ scope: 'task', keyword });

describe('insertStatement by attribute order', () => {
	const plan = HEAD + 'task a "A" {\n  start 2026-01-05\n  # about allocation\n  allocate r\n}\n';

	it('goes after the last statement of equal or lower rank, above attached comments', () => {
		expect(insert(plan, 'task a', 'effort 5d', byRank('effort'))).toBe(
			HEAD +
				'task a "A" {\n  start 2026-01-05\n  effort 5d\n  # about allocation\n  allocate r\n}\n',
		);
		expect(insert(plan, 'task a', 'complete 50', byRank('complete'))).toBe(
			HEAD +
				'task a "A" {\n  start 2026-01-05\n  # about allocation\n  allocate r\n  complete 50\n}\n',
		);
	});

	it('goes before the first higher-ranked statement, above its comments', () => {
		const p = HEAD + 'task a "A" {\n  # sizing\n  effort 5d\n}\n';
		expect(insert(p, 'task a', 'note "n"', byRank('note'))).toBe(
			HEAD + 'task a "A" {\n  note "n"\n  # sizing\n  effort 5d\n}\n',
		);
	});

	it('skips opaque statements and keeps a trailing comment on its line', () => {
		const p = HEAD + 'task a "A" {\n  start 2026-01-05 # s\n  chargeset x\n}\n';
		expect(insert(p, 'task a', 'effort 5d', byRank('effort'))).toBe(
			HEAD + 'task a "A" {\n  start 2026-01-05 # s\n  effort 5d\n  chargeset x\n}\n',
		);
	});

	it('creates a body for a header without one, at the header indentation plus the unit', () => {
		const p = HEAD + 'task a "A" {\n    task b "B"\n}\n';
		expect(insert(p, 'task b', 'effort 5d', byRank('effort'))).toBe(
			HEAD + 'task a "A" {\n    task b "B" {\n        effort 5d\n    }\n}\n',
		);
	});

	it('creates an inline body when the header shares its line', () => {
		const p = HEAD + 'task a "A" { task b "B" }\n';
		expect(insert(p, 'task b', 'effort 5d', byRank('effort'))).toBe(
			HEAD + 'task a "A" { task b "B" { effort 5d } }\n',
		);
	});

	it('adds inline in a one-line body', () => {
		const p = HEAD + 'task a "A" { start 2026-01-05 }\n';
		expect(insert(p, 'task a', 'effort 5d', byRank('effort'))).toBe(
			HEAD + 'task a "A" { start 2026-01-05 effort 5d }\n',
		);
		expect(insert(p, 'task a', 'note "n"', byRank('note'))).toBe(
			HEAD + 'task a "A" { note "n" start 2026-01-05 }\n',
		);
		expect(insert(HEAD + 'task a "A" {}\n', 'task a', 'effort 5d', 'end')).toBe(
			HEAD + 'task a "A" { effort 5d }\n',
		);
		expect(insert(HEAD + 'task a "A" { }\n', 'task a', 'effort 5d', 'end')).toBe(
			HEAD + 'task a "A" { effort 5d }\n',
		);
	});

	it('fills an empty multi-line body', () => {
		expect(insert(HEAD + 'task a "A" {\n}\n', 'task a', 'effort 5d', 'end')).toBe(
			HEAD + 'task a "A" {\n  effort 5d\n}\n',
		);
	});

	it('follows tab indentation and renders nested statements', () => {
		const p = HEAD + 'task a "A" {\n\teffort 5d\n}\n';
		expect(insert(p, 'task a', 'task c "C" {\n\tlength 1d\n}', byRank('task'))).toBe(
			HEAD + 'task a "A" {\n\teffort 5d\n\ttask c "C" {\n\t\tlength 1d\n\t}\n}\n',
		);
	});

	it('keeps CRLF files CRLF', () => {
		const p = (HEAD + 'task a "A" {\n  start 2026-01-05\n}\n').replace(/\n/g, '\r\n');
		const out = insert(p, 'task a', 'effort 5d', byRank('effort'));
		expect(out).toBe(p.replace('2026-01-05\r\n', '2026-01-05\r\n  effort 5d\r\n'));
		expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
		const nb = (HEAD + 'task b "B"\n').replace(/\n/g, '\r\n');
		expect(insert(nb, 'task b', 'effort 5d', byRank('effort'))).toBe(
			nb.replace('"B"', '"B" {\r\n  effort 5d\r\n}'),
		);
	});

	it('inserts at the top level', () => {
		expect(insert(HEAD + 'task a "A"', null, 'flags f', 'end')).toBe(HEAD + 'task a "A"\nflags f');
		const s = setup(HEAD + 'task a "A"\n');
		const op = insertStatement(s.file(), null, 'flags f', { before: stmt(s.file(), 'task a') });
		expect(textsAfter(s.snap, finishPlan(s.ctx, FAKE, [op as EditOp]))['plan.tjp']).toBe(
			HEAD + 'flags f\ntask a "A"\n',
		);
	});

	it('places next to a sibling and selects the new statement', () => {
		const p = HEAD + 'task a "A" {\n  task b "B"\n  task c "C"\n}\n';
		const s = setup(p);
		const op = insertStatement(s.file(), stmt(s.file(), 'task a'), 'task x "X"', {
			after: stmt(s.file(), 'task b'),
		});
		const r = finishPlan(s.ctx, FAKE, [op as EditOp]);
		const out = textsAfter(s.snap, r)['plan.tjp'] ?? '';
		expect(out).toBe(HEAD + 'task a "A" {\n  task b "B"\n  task x "X"\n  task c "C"\n}\n');
		const sel = r.status === 'edit' ? r.edit.select : null;
		expect(sel && out.slice(sel.from, sel.to)).toBe('task x "X"');
	});

	it('ranks scenario-prefixed statements by their keyword', () => {
		const p =
			HEAD +
			'scenario plan "Plan" { scenario delayed "D" }\ntask a "A" {\n  delayed:start 2026-01-06\n}\n';
		expect(insert(p, 'task a', 'effort 5d', byRank('effort'))).toBe(
			p.replace('2026-01-06\n', '2026-01-06\n  effort 5d\n'),
		);
	});

	it('knows the ranks of 7.2', () => {
		expect(rankOf('task', 'note')).toBe(0);
		expect(rankOf('task', 'length')).toBe(rankOf('task', 'effort'));
		expect(rankOf('task', 'chargeset')).toBeNull();
		expect(rankOf('resource', 'resource')).toBe(7);
		expect(rankOf('project', 'workinghours')).toBe(6);
	});
});

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

	it('handles the last line without a break and CRLF', () => {
		expect(remove(HEAD + 'task k "K"\ntask b "B"', 'task b')).toBe(HEAD + 'task k "K"\n');
		const crlf = (HEAD + 'task a "A" {\r\n  effort 5d\r\n}\r\n').replace(/\n(?!\r)/g, '\n');
		expect(remove(crlf, 'effort')).toBe(HEAD + 'task a "A" {\r\n}\r\n');
	});
});

describe('replaceValue', () => {
	const p = HEAD + 'task a "A" {\n  effort 5 d\n}\n';
	const value = (text: string) => {
		const v = parseValue('duration', text);
		if (!v.ok) throw new Error(text);
		return v.value;
	};

	it('keeps the spelling when the value is the same (already-set)', () => {
		const s = setup(p);
		expect(replaceValue(s.file(), span(s.file(), '5 d'), value('5d'))).toEqual({
			status: 'noop',
			reason: 'already-set',
		});
	});

	it('prints a new value over the value range only', () => {
		expect(run(p, (s) => replaceValue(s.file(), span(s.file(), '5 d'), value('3w')))).toBe(
			p.replace('5 d', '3w'),
		);
	});
});

describe('lists', () => {
	const p = HEAD + 'resource s "S"\nresource t "T"\ntask a "A" {\n  allocate r, s, t\n}\n';
	const items = (s: ReturnType<typeof setup>): Span[] => {
		const base = span(s.file(), 'allocate r, s, t').from;
		return [9, 12, 15].map((o) => ({ from: base + o, to: base + o + 1 }));
	};

	it('appends after the last item', () => {
		expect(run(p, (s) => appendListItem(s.file(), stmt(s.file(), 'allocate'), items(s), 'u'))).toBe(
			p.replace('r, s, t', 'r, s, t, u'),
		);
	});

	it('removes an item with one separator', () => {
		const rm = (i: number): string =>
			run(
				p,
				(s) =>
					removeListItem(s.file(), items(s), i) ??
					removeStatement(s.file(), stmt(s.file(), 'allocate')),
			);
		expect(rm(0)).toBe(p.replace('r, s, t', 's, t'));
		expect(rm(1)).toBe(p.replace('r, s, t', 'r, t'));
		expect(rm(2)).toBe(p.replace('r, s, t', 'r, s'));
		const s = setup(p);
		expect(removeListItem(s.file(), [items(s)[0] as Span], 0)).toBeNull();
	});
});
