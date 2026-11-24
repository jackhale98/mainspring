// SPDX-License-Identifier: GPL-2.0-or-later
// Cases from the third T6 review (N1-N4 and the keyword verdict): a block both sides changed
// statements of is clean only when check.ts proves the changes independent, whatever the layout.
import { describe, expect, it } from 'vitest';
import { applyIntent } from '../edit/apply';
import { textsAfter } from '../edit/testing';
import type { EditIntent } from '../edit/types';
import { buildIndex } from '../index';
import { createWorkspace } from '../../workspace/workspace';
import { mergeWorkspace } from '../../sync/merge';
import { filesOf, merge1, resolveAll } from './testing';

const H = 'project p "P" 2027-01-04 +3m\n';
const text = (m: ReturnType<typeof merge1>): string => m.files.get('plan.tjp') ?? '';
const kinds = (m: ReturnType<typeof merge1>): string[] => m.conflicts.map((c) => c.subject.kind);

function edited(base: string, intent: EditIntent): string {
	const snap = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': base } }).snapshot();
	const r = applyIntent(snap, buildIndex(snap, undefined, { cache: null }), intent);
	return textsAfter(snap, r)['plan.tjp'] ?? '';
}

describe('workinghours replace the hours of their days (N1)', () => {
	const base = `${H}resource dev "Dev" {\n  email "d@x"\n}\ntask t "T" {\n  effort 1d\n  allocate dev\n}\n`;
	const hours = (days: string[], h: [string, string][]): EditIntent => ({
		type: 'setWorkingHours',
		scope: { kind: 'resource', resource: 'dev' },
		days: days as never,
		hours: h,
	});

	it('makes the same weekday set both ways (through the edit API) a conflict', () => {
		const ours = edited(base, hours(['mon'], [['9:00', '12:00']]));
		const theirs = edited(base, hours(['mon'], [['13:00', '17:00']]));
		expect(ours).toContain('workinghours mon 9:00 - 12:00');
		expect(theirs).toContain('workinghours mon 13:00 - 17:00');
		const m = merge1(base, ours, theirs);
		expect(kinds(m)).toEqual(['attribute']);
		expect(text(m).match(/workinghours/g)).toHaveLength(1);
	});

	it('conflicts on overlapping day ranges and keeps disjoint days both', () => {
		const at = (line: string, where: 'top' | 'bottom'): string =>
			where === 'top'
				? base.replace('resource dev "Dev" {\n', `resource dev "Dev" {\n  ${line}\n`)
				: base.replace('  email "d@x"\n', `  email "d@x"\n  ${line}\n`);
		const m = merge1(
			base,
			at('workinghours mon - fri 9:00 - 17:00', 'top'),
			at('workinghours mon off', 'bottom'),
		);
		expect(m.conflicts).toHaveLength(1);
		const ok = merge1(
			base,
			at('workinghours mon 9:00 - 12:00', 'top'),
			at('workinghours tue 9:00 - 12:00', 'bottom'),
		);
		expect(ok.conflicts).toEqual([]);
		expect(text(ok).match(/workinghours/g)).toHaveLength(2);
	});

	it('also at the project level', () => {
		const p = `project p "P" 2027-01-04 +3m {\n  timezone "UTC"\n}\ntask t "T" {\n  length 1d\n}\n`;
		const m = merge1(
			p,
			p.replace('  timezone "UTC"\n', '  workinghours mon 9:00 - 12:00\n  timezone "UTC"\n'),
			p.replace('  timezone "UTC"\n', '  timezone "UTC"\n  workinghours mon 13:00 - 17:00\n'),
		);
		expect(m.conflicts).toHaveLength(1);
	});
});

describe('purge is order-sensitive (N2)', () => {
	it('makes purge X on one side and a change to X on the other one conflict', () => {
		const base = `${H}resource dev "Dev"\nresource qa "QA"\nresource boss "Boss"\ntask b "B" {\n  effort 2d\n  allocate dev\n}\n`;
		const ours = base.replace(
			'  allocate dev\n',
			'  allocate dev\n  purge allocate\n  allocate qa\n',
		);
		const theirs = base.replace('task b "B" {\n', 'task b "B" {\n  allocate boss\n');
		const m = merge1(base, ours, theirs);
		expect(m.conflicts).toHaveLength(1);
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toBe(theirs);
		expect(resolveAll(m, 'ours').get('plan.tjp')).toBe(ours);
	});
});

describe('layouts cannot hide a block (N3)', () => {
	it('one-line bodies', () => {
		const base = `${H}resource dev "Dev"\ntask a "A" { effort 1d allocate dev note "x" }\n`;
		const m = merge1(
			base,
			base.replace('{ effort', '{ priority 100 effort'),
			base.replace('note "x" }', 'note "x" priority 900 }'),
		);
		expect(m.conflicts).toHaveLength(1);
		expect(text(m).match(/priority/g)).toHaveLength(1);
	});

	it('a brace on its own line', () => {
		const base = `${H}resource dev "Dev"\ntask a "A"\n{\n  effort 1d\n  allocate dev\n  note "x"\n}\n`;
		const m = merge1(
			base,
			base.replace('{\n  effort', '{\n  priority 100\n  effort'),
			base.replace('  note "x"\n', '  note "x"\n  priority 900\n'),
		);
		expect(kinds(m)).toEqual(['attribute']);
		expect(text(m).match(/priority/g)).toHaveLength(1);
	});

	it('one-line bodies typed into at both ends with different spacing merge cleanly', () => {
		// Found by typed.property.test.ts: only the spacing between the same tokens differed.
		const base = `${H}project q "Q" 2027-01-04 +1m { now 2027-01-05 }\n`.replace(`${H}`, '');
		const m = merge1(
			base,
			base.replace('2027-01-05 }', '2027-01-05  workinghours tue 13:00 - 17:00  }'),
			base.replace('{ now', '{ workinghours mon 13:00 - 17:00  now'),
		);
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toContain('workinghours mon 13:00 - 17:00');
		expect(text(m)).toContain('workinghours tue 13:00 - 17:00');
	});
});

describe('the keyword verdict', () => {
	const base = `${H}task x "X"\ntask y "Y"\ntask a "A" {\n  effort 1d\n  note "n"\n}\n`;
	const top = (s: string): string => base.replace('task a "A" {\n', `task a "A" {\n  ${s}\n`);
	const bottom = (s: string): string => base.replace('  note "n"\n', `  note "n"\n  ${s}\n`);

	it('keys depends by target: one target with different gaps, or a and !a, is one conflict', () => {
		expect(
			merge1(base, top('depends x { gaplength 1d }'), bottom('depends x { gaplength 2d }'))
				.conflicts,
		).toHaveLength(1);
		expect(merge1(base, top('depends x'), bottom('depends !x')).conflicts).toHaveLength(1);
		expect(merge1(base, top('depends x'), bottom('depends y')).conflicts).toEqual([]);
	});

	it('treats extend and projectids as single-valued', () => {
		const p = `project p "P" 2027-01-04 +3m {\n  timezone "UTC"\n}\ntask t "T" {\n  length 1d\n}\n`;
		const m = merge1(
			p,
			p.replace('{\n  timezone', '{\n  extend task { text A "A" }\n  timezone'),
			p.replace('"UTC"\n', '"UTC"\n  extend task { text B "B" }\n'),
		);
		expect(m.conflicts).toHaveLength(1);
	});

	it('sees an existing value edited while the other side adds a second one', () => {
		const b = base.replace('  note "n"\n', '  note "n"\n  priority 500\n');
		const m = merge1(
			b,
			b.replace('priority 500', 'priority 600'),
			b.replace('task a "A" {\n', 'task a "A" {\n  priority 900\n'),
		);
		expect(m.conflicts).toHaveLength(1);
	});

	it('sees an unprefixed value added against a prefixed one', () => {
		const m = merge1(base, top('delayed:priority 100'), bottom('priority 900'));
		expect(m.conflicts).toHaveLength(1);
	});

	it('keeps one copy of identical additions with the trailing comment only one side has', () => {
		const m = merge1(base, top('flags hot'), bottom('flags hot # why'));
		expect(m.conflicts).toEqual([]);
		expect(text(m)).toBe(bottom('flags hot # why'));
		const both = merge1(base, top('flags hot # mine'), bottom('flags hot # yours'));
		expect(text(both)).toBe(top('flags hot # mine'));
	});
});

describe('tasks without ids (N4)', () => {
	const base = `${H}task "One" {\n  effort 1d\n}\ntask "Two" {\n  effort 2d\n}\ntask "One" {\n  effort 3d\n}\n`;

	it('align by name and position: one attribute set both ways is one attribute conflict', () => {
		const set = (v: string): string => base.replace('effort 2d\n', `effort 2d\n  priority ${v}\n`);
		const m = merge1(base, set('100').replace('effort 1d', 'effort 4d'), set('900'));
		expect(kinds(m)).toEqual(['attribute']);
	});

	it('are blocks Keep both would declare twice', () => {
		const ours = `${H}task "Two" {\n  effort 2d\n}\ntask "One" {\n  effort 1d\n}\ntask "One" {\n  effort 3d\n}\n`;
		const theirs = `${H}task "One" {\n  effort 1d\n}\ntask "One" {\n  effort 3d\n}\ntask "Two" {\n  effort 2d\n}\n`;
		const m = merge1(base, ours, theirs);
		expect(m.conflicts.every((c) => !c.both)).toBe(true);
	});
});

describe('a task moved on one side and edited on the other, edges (L4)', () => {
	it('is a text conflict without Keep both when its id also occurs elsewhere in the file', () => {
		const T = (e: string): string => `  task t "T" {\n    effort ${e}\n  }\n`;
		const base = `${H}task p1 "P1" {\n${T('1d')}}\ntask p2 "P2" {\n${T('9d')}}\ntask p3 "P3" {\n  length 1d\n}\n`;
		const ours = `${H}task p1 "P1" {\n}\ntask p2 "P2" {\n${T('9d')}}\ntask p3 "P3" {\n  length 1d\n${T('1d')}}\n`;
		const theirs = base.replace('effort 1d', 'effort 5d');
		const m = merge1(base, ours, theirs);
		expect(m.conflicts.length).toBeGreaterThan(0);
		expect(
			m.conflicts.some((c) => c.subject.kind === 'block' && c.subject.change === 'deleted-ours'),
		).toBe(false);
		expect(m.conflicts.every((c) => !c.both)).toBe(true);
		// A text conflict holds ours (types.ts `at`): Take mine gives ours.
		expect(resolveAll(m, 'ours').get('plan.tjp')).toBe(ours);
	});

	it('is still a deletion when another task has the same id and ours made no copy', () => {
		// Found by merge.property.test.ts (FC_SEED=31): a deletion taken for a move.
		const T = (e: string): string => `  task t "T" {\n    effort ${e}\n  }\n`;
		const base = `${H}task p1 "P1" {\n${T('1d')}}\ntask p2 "P2" {\n${T('9d')}}\n`;
		const ours = `${H}task p1 "P1" {\n}\ntask p2 "P2" {\n${T('9d')}}\n`;
		const theirs = base.replace('effort 1d', 'effort 5d');
		const m = merge1(base, ours, theirs);
		expect(m.conflicts.map((c) => c.subject)).toMatchObject([
			{ kind: 'block', change: 'deleted-ours' },
		]);
		expect(resolveAll(m, 'ours').get('plan.tjp')).toBe(ours);
		expect(resolveAll(m, 'theirs').get('plan.tjp')).toBe(theirs);
	});

	it('is a text conflict without Keep both when ours moved it to another file', () => {
		const plan = `${H}include "more.tji"\ntask a "A" {\n  task t "T" {\n    effort 1d\n  }\n}\n`;
		const more = 'task b "B" {\n  length 1d\n}\n';
		const base = { 'plan.tjp': plan, 'more.tji': more };
		const ours = {
			'plan.tjp': plan.replace('  task t "T" {\n    effort 1d\n  }\n', ''),
			'more.tji': `${more}task t "T" {\n  effort 1d\n}\n`,
		};
		const theirs = { ...base, 'plan.tjp': plan.replace('effort 1d', 'effort 5d') };
		const snap = createWorkspace({ entry: 'plan.tjp', files: ours }).snapshot();
		const m = mergeWorkspace(filesOf(base), filesOf(ours), filesOf(theirs), {
			includes: snap.includes,
			files: snap.files,
		});
		expect(m.conflicts.map((c) => [c.file, c.subject.kind, c.both])).toEqual([
			['plan.tjp', 'text', false],
		]);
	});
});
