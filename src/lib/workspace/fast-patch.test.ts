// SPDX-License-Identifier: GPL-2.0-or-later
// The main thread's half of the fast path (fast-patch.ts, ADR-0010): which statements are sites,
// and the fast edits of a change. The engine's half and the equivalence with full runs are in
// tests/engine/fast-path.*.
import { describe, expect, it } from 'vitest';
import { applyIntent } from '../tjp/edit/apply';
import { buildIndex } from '../tjp/index';
import { changeSetOf } from '../tjp/document';
import { fastEditsOf, fastSites, statementValue } from './fast-patch';
import { createWorkspace, type Workspace } from './workspace';

const PLAN = [
	'project p "P" 2026-01-05 +3m {', // 1
	'  scenario plan "Plan" { scenario late "Late" }', // 2
	'}', // 3
	'resource r "R"', // 4
	'macro std [', // 5
	'  effort 5d', // 6
	']', // 7
	'task top "Top" {', // 8
	'  priority 300', // 9
	'  start 2026-01-06', // 10
	'  task a "A" {', // 11
	'    effort 3d # the estimate', // 12
	'    allocate r', // 13
	'    complete 20', // 14
	'    priority 600', // 15
	'  }', // 16
	'  task b "B" {', // 17
	'    length 2d', // 18
	'    late:length 4d', // 19
	'  }', // 20
	'  task c "C" { effort 1d allocate r }', // 21
	'  task d "D" {', // 22
	'    ${std}', // 23
	'    allocate r', // 24
	'  }', // 25
	'  task e "E" {', // 26
	'    start 2026-01-07', // 27
	'    start 2026-01-08', // 28
	'    duration 2d', // 29
	'  }', // 30
	'  task x "X" {', // 31
	'  }', // 32
	'  task y "Y" {', // 33
	'  }', // 34
	'}', // 35
	'include "common.tji" { taskprefix top.x }', // 36
	'include "common.tji" { taskprefix top.y }', // 37
	'',
].join('\n');
const COMMON = ['task w "W" {', '  effort 2d', '}', ''].join('\n');

function setup(): { ws: Workspace } {
	return {
		ws: createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': PLAN, 'common.tji': COMMON } }),
	};
}

const sitesOf = (ws: Workspace) => {
	const snap = ws.snapshot();
	return fastSites(snap, buildIndex(snap, undefined, { cache: null })).map(
		(s) => `${s.task.id} ${s.attribute} ${s.value} @${s.file}:${s.line}`,
	);
};

describe('fastSites', () => {
	it('lists the lone statements a fast patch may rewrite, and nothing else', () => {
		const { ws } = setup();
		expect(sitesOf(ws)).toEqual([
			'top start 2026-01-06 @plan.tjp:10',
			'top.a effort 3d @plan.tjp:12',
			'top.a complete 20 @plan.tjp:14',
			'top.a priority 600 @plan.tjp:15',
			'top.e duration 2d @plan.tjp:29',
		]);
		// Left out: priority on a container (9); length with a late: site (18, 19); a one-line
		// task (21); a macro body and its call (6, 23); a start written twice (27, 28); the file
		// included twice, one line for top.x.w and top.y.w (common.tji:2).
	});

	it('leaves out a start or end that a period also sets (the T19 re-review, N1)', () => {
		const plan = [
			'project p "P" 2026-01-05 +3m', // 1
			'task t "T" {', // 2
			'  start 2026-01-06', // 3
			'  period 2026-01-12 - 2026-01-30', // 4
			'}', // 5
			'task u "U" {', // 6
			'  end 2026-02-20', // 7
			'  period 2026-01-12 - 2026-01-30', // 8
			'}', // 9
			'task v "V" {', // 10
			'  start 2026-01-06', // 11
			'  effort 3d', // 12
			'}', // 13
			'',
		].join('\n');
		const ws = createWorkspace({ entry: 'plan.tjp', files: { 'plan.tjp': plan } });
		expect(sitesOf(ws)).toEqual(['v start 2026-01-06 @plan.tjp:11', 'v effort 3d @plan.tjp:12']);
	});
});

describe('statementValue', () => {
	it.each([
		['  effort 3d', 'effort', '3d'],
		['\teffort 2.5d # note', 'effort', '2.5d'],
		['  start 2026-03-27-09:00-+0900', 'start', '2026-03-27-09:00-+0900'],
		['  end 2026-04-02-12:00-America/New_York', 'end', '2026-04-02-12:00-America/New_York'],
		['  priority 700', 'priority', '700'],
		['  complete 37.5', 'complete', '37.5'],
	] as const)('reads %j', (line, keyword, value) => {
		expect(statementValue(line, keyword)).toBe(value);
	});

	it.each([
		['  effort 2d } task x "X" { effort 1d', 'effort'],
		['  effort ${e}', 'effort'],
		['  effort "2d"', 'effort'],
		['  start 2026-01-06 end 2026-01-09', 'start'],
		['  length 2d', 'effort'],
		['  priority -1', 'priority'],
	] as const)('refuses %j', (line, keyword) => {
		expect(statementValue(line, keyword)).toBeNull();
	});
});

describe('fastEditsOf', () => {
	it("gives the edit of a setAttr intent's in-place rewrite", () => {
		const { ws } = setup();
		const snap = ws.snapshot();
		const index = buildIndex(snap, undefined, { cache: null });
		const r = applyIntent(snap, index, {
			type: 'setAttr',
			task: 'top.a',
			attr: 'effort',
			value: '5d',
		});
		if (r.status !== 'edit') throw new Error(r.status);
		expect(fastEditsOf(snap, index, r.edit.changes)).toEqual([
			{
				task: 'top.a',
				attribute: 'effort',
				scenario: null,
				value: '5d',
				file: 'plan.tjp',
				line: 12,
			},
		]);
	});

	it('gives nothing for a change outside a site, a new line, or a value it cannot vouch for', () => {
		const { ws } = setup();
		const snap = ws.snapshot();
		const index = buildIndex(snap, undefined, { cache: null });
		const text = snap.files.get('plan.tjp')?.text;
		if (!text) throw new Error('no plan');
		const replace = (find: string, insert: string) => {
			const from = PLAN.indexOf(find);
			return { 'plan.tjp': changeSetOf({ from, to: from + find.length, insert }, text.length) };
		};
		// Not a site: a line in the macro body, the late scenario's length.
		expect(fastEditsOf(snap, index, replace('  effort 5d', '  effort 6d'))).toBeNull();
		expect(fastEditsOf(snap, index, replace('late:length 4d', 'late:length 5d'))).toBeNull();
		// A line added.
		expect(fastEditsOf(snap, index, replace('effort 3d', 'effort 3d\n'))).toBeNull();
		// A value with more than a value in it.
		expect(
			fastEditsOf(snap, index, replace('effort 3d', 'effort 2d } task x "X" { effort 1d')),
		).toBeNull();
		// Two sites at once: two edits.
		const both = changeSetOf(
			[
				{ from: PLAN.indexOf('effort 3d') + 7, to: PLAN.indexOf('effort 3d') + 9, insert: '8d' },
				{
					from: PLAN.indexOf('complete 20') + 9,
					to: PLAN.indexOf('complete 20') + 11,
					insert: '40',
				},
			],
			text.length,
		);
		expect(
			fastEditsOf(snap, index, { 'plan.tjp': both })?.map((e) => [e.attribute, e.value]),
		).toEqual([
			['effort', '8d'],
			['complete', '40'],
		]);
	});
});
