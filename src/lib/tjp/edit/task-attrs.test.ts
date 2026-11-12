// SPDX-License-Identifier: GPL-2.0-or-later
// setAttr and removeAttr (phase-1.md 7.1, T11a) on small plans and the T16 fixtures: exact text
// changes, no-ops and refusals, CRLF and tab layouts, supplements, scenario prefixes, macros and
// shared files. renameTask and declareFlag: task-attrs-names.test.ts.
import { describe, expect, it } from 'vitest';
import { readTjp } from '../../../../tests/grammar/corpus';
import { applyIntent } from './apply';
import { removeAttr, setAttr } from './task-attrs-api';
import { setup, textsAfter, type Setup } from './testing';
import type { EditIntent, EditOptions, EditResult, TaskAttr } from './types';

const HEAD = 'project p "P" 2026-01-05 +2m\nresource r "R"\nresource q "Q"\nflags hot, cold\n';

function run(s: Setup, intent: EditIntent, opts: EditOptions = {}): EditResult {
	return applyIntent(s.snap, s.index, intent, opts);
}

/** The entry file's text after an intent (throws unless it is an edit). */
function after(
	src: string | Record<string, string>,
	intent: EditIntent,
	file = 'plan.tjp',
): string {
	const s = setup(src);
	return textsAfter(s.snap, run(s, intent))[file] ?? '';
}

/** A setAttr intent; `value` is unchecked so tests can pass wrong types. */
const set = (task: string, attr: TaskAttr, value: unknown): EditIntent =>
	({ type: 'setAttr', task, attr, value }) as EditIntent;

describe('setAttr values', () => {
	const plan = HEAD + 'task a "A" {\n  start 2026-01-06\n  effort 5d\n  allocate r\n}\n';

	it('rewrites the value in place and selects it', () => {
		const s = setup(plan);
		const r = setAttr(s.snap, s.index, 'a', 'effort', '3d');
		const text = textsAfter(s.snap, r)['plan.tjp'] ?? '';
		expect(text).toBe(plan.replace('effort 5d', 'effort 3d'));
		const sel = r.status === 'edit' ? r.edit.select : null;
		expect(sel && text.slice(sel.from, sel.to)).toBe('3d');
	});

	it('keeps the spelling when the value is the same (already-set)', () => {
		const s = setup(plan.replace('effort 5d', 'effort 5 d'));
		expect(setAttr(s.snap, s.index, 'a', 'effort', '5d')).toEqual({
			status: 'noop',
			reason: 'already-set',
		});
	});

	it('inserts by the 7.2 order at the body indentation', () => {
		expect(after(plan, set('a', 'priority', '700'))).toBe(
			plan.replace('  start', '  priority 700\n  start'),
		);
		expect(after(plan, set('a', 'complete', '40'))).toBe(
			plan.replace('  allocate r\n', '  allocate r\n  complete 40\n'),
		);
		expect(after(plan, set('a', 'note', '"Say \\"hi\\""'))).toBe(
			plan.replace('  start', '  note "Say \\"hi\\""\n  start'),
		);
		expect(after(plan, set('a', 'scheduling', 'alap'))).toBe(
			plan.replace('  effort', '  scheduling alap\n  effort'),
		);
	});

	it('creates a body for a task without one', () => {
		expect(after(HEAD + 'task a "A"\n', set('a', 'start', '2026-01-07'))).toBe(
			HEAD + 'task a "A" {\n  start 2026-01-07\n}\n',
		);
	});

	it('refuses invalid values at the value', () => {
		const s = setup(plan);
		for (const [attr, value] of [
			['complete', '101'],
			['priority', '1001'],
			['effort', '0d'],
			['effort', 'five'],
			['start', '2027-01-01'],
			['scheduling', 'soon'],
			['effort', '${len}'],
			['note', 'unquoted'],
			['start', true],
		] as const) {
			const r = run(s, set('a', attr, value));
			expect(r, `${attr} ${String(value)}`).toMatchObject({
				status: 'refused',
				reason: 'invalid-value',
			});
		}
		const r = run(s, set('a', 'complete', '101'));
		expect(r.status === 'refused' && r.at[0]).toMatchObject({ file: 'plan.tjp' });
	});

	it('skips checks that read a setting written with a macro', () => {
		const src =
			'macro tz [Europe/Berlin]\nproject p "P" 2026-01-05 +2m {\n  timezone "${tz}"\n}\n' +
			'task a "A" {\n  start 2026-01-06\n}\n';
		const s = setup(src);
		expect(run(s, set('a', 'start', '2026-01-07-10:00')).status).toBe('edit');
	});

	it('rewrites the last site: supplements and the top-scenario prefix', () => {
		const sup = readTjp('tests/fixtures/tjp/supplement/plan.tjp');
		const text = after(sup, set('top.a', 'priority', '900'));
		expect(text).toBe(sup.replace('priority 700', 'priority 900'));
		const src =
			HEAD.replace('+2m', '+2m {\n  scenario plan "Plan" {\n    scenario late "Late"\n  }\n}') +
			'task a "A" {\n  plan:priority 600\n  late:priority 800\n}\n';
		expect(after(src, set('a', 'priority', '650'))).toBe(src.replace('600', '650'));
	});

	it('refuses a body with statement-level macro calls that may set the attribute', () => {
		const src = 'macro m [ priority 300 ]\n' + HEAD + 'task a "A" {\n  ${m}\n}\n';
		const s = setup(src);
		expect(run(s, set('a', 'priority', '400'))).toMatchObject({ reason: 'macro-in-body' });
		expect(run(s, set('a', 'note', '"n"')).status).toBe('edit');
		const rm = setup(src.replace('  ${m}', '  priority 200\n  ${m}'));
		expect(run(rm, { type: 'removeAttr', task: 'a', attr: 'priority' })).toMatchObject({
			reason: 'macro-in-body',
		});
	});

	it("allows edits next to Tutorial's ${allocate_developers}", () => {
		const s = setup(readTjp('engine/tj/examples/Tutorial/tutorial.tjp'), {}, 'tutorial.tjp');
		expect(s.index.tasks.get('AcSo.spec')?.bodyMacroCalls).toHaveLength(1);
		for (const intent of [
			set('AcSo.spec', 'priority', '600'),
			set('AcSo.spec', 'effort', '25d'),
			{ type: 'removeAttr', task: 'AcSo.spec', attr: 'effort' },
		] as const) {
			expect(run(s, intent).status, JSON.stringify(intent)).toBe('edit');
		}
	});

	it('refuses values written with macros and unknown tasks', () => {
		const src = 'macro len [3d]\n' + HEAD + 'task a "A" {\n  effort ${len}\n}\n';
		const s = setup(src);
		expect(run(s, set('a', 'effort', '4d'))).toMatchObject({ reason: 'text-only' });
		expect(run(s, set('nope', 'effort', '4d'))).toMatchObject({ reason: 'unknown-target' });
	});

	it('keeps CRLF and tab layouts', () => {
		const crlf = (HEAD + 'task a "A" {\n  effort 5d\n}\n').replace(/\n/g, '\r\n');
		expect(after(crlf, set('a', 'priority', '600'))).toBe(
			crlf.replace('  effort', '  priority 600\r\n  effort'),
		);
		const tabs = readTjp('tests/fixtures/tjp/tabs/plan.tjp');
		const s = setup(tabs);
		const id = [...s.index.tasks.keys()].find((t) => s.index.tasks.get(t)?.children.length === 0);
		const out = textsAfter(s.snap, run(s, set(id ?? '', 'note', '"tabbed"')))['plan.tjp'] ?? '';
		expect(out).toMatch(/\n\t+note "tabbed"\n/);
	});
});

describe('setAttr sizing', () => {
	const plan = HEAD + 'task a "A" {\n  effort 5d # work\n}\n';

	it('rewrites keyword and value together when the criterion changes', () => {
		expect(after(plan, set('a', 'length', '2d'))).toBe(plan.replace('effort 5d', 'length 2d'));
	});

	it('replaces, never adds a second criterion, also across supplements', () => {
		const src = plan + 'supplement task a {\n  effort 3d\n}\n';
		expect(after(src, set('a', 'duration', '1w'))).toBe(
			HEAD + 'task a "A" {\n  # work\n}\nsupplement task a {\n  duration 1w\n}\n',
		);
	});

	it('rewrites only the top-scenario statement', () => {
		const src = readTjp('tests/fixtures/tjp/scenario-prefix/plan.tjp');
		expect(after(src, set('a', 'length', '3d'))).toBe(src.replace('effort 2d', 'length 3d'));
	});

	it('refuses milestones and containers', () => {
		const s = setup(
			HEAD +
				'task m "M" {\n  milestone\n}\ntask c "C" {\n  task k "K"\n}\ntask d "D" {\n  task "Auto"\n}\n',
		);
		expect(run(s, set('m', 'effort', '1d'))).toMatchObject({ reason: 'conflicting-attribute' });
		expect(run(s, set('c', 'effort', '1d'))).toMatchObject({ reason: 'conflicting-attribute' });
		expect(run(s, set('d', 'length', '1d'))).toMatchObject({ reason: 'conflicting-attribute' });
		expect(run(s, set('d', 'milestone', true))).toMatchObject({ reason: 'conflicting-attribute' });
	});
});

describe('setAttr milestone', () => {
	it('inserts and removes the flag', () => {
		const src = HEAD + 'task a "A" {\n  start 2026-01-06\n}\n';
		const on = after(src, set('a', 'milestone', true));
		expect(on).toBe(src.replace('06\n', '06\n  milestone\n'));
		expect(after(on, set('a', 'milestone', false))).toBe(src);
		const s = setup(src);
		expect(run(s, set('a', 'milestone', false))).toMatchObject({ reason: 'not-present' });
		expect(run(s, set('a', 'milestone', 'yes'))).toMatchObject({ reason: 'invalid-value' });
	});

	it('refuses a task with a sizing criterion', () => {
		const s = setup(HEAD + 'task a "A" {\n  effort 1d\n}\n');
		expect(run(s, set('a', 'milestone', true))).toMatchObject({
			reason: 'conflicting-attribute',
		});
	});
});

describe('other scenarios', () => {
	// Each insertion lands before the other scenario's statement; inserted after it, the
	// top-scenario value is copied over it (checked natively: late keeps 800, 2026-01-12,
	// length 2d, the milestone).
	const head =
		'project p "P" 2026-01-05 +2m {\n  scenario plan "Plan" {\n    scenario late "Late"\n  }\n}\n' +
		'resource r "R"\n';
	const task = (body: string): string => `${head}task a "A" {\n${body}  allocate r\n}\n`;

	it('inserts a value before the other scenario sets it', () => {
		const src = task('  late:priority 800\n  start 2026-01-06\n  effort 1d\n');
		expect(after(src, set('a', 'priority', '650'))).toBe(
			src.replace('  late:priority', '  priority 650\n  late:priority'),
		);
		const start = task('  late:start 2026-01-12\n  effort 1d\n');
		expect(after(start, set('a', 'start', '2026-01-06'))).toBe(
			start.replace('  late:start', '  start 2026-01-06\n  late:start'),
		);
	});

	it('inserts a criterion before any criterion or milestone of another scenario', () => {
		const len = task('  start 2026-01-06\n  late:length 2d\n');
		expect(after(len, set('a', 'effort', '1d'))).toBe(
			len.replace('  late:length', '  effort 1d\n  late:length'),
		);
		const ms = task('  start 2026-01-06\n  late:milestone\n');
		expect(after(ms, set('a', 'effort', '2d'))).toBe(
			ms.replace('  late:milestone', '  effort 2d\n  late:milestone'),
		);
		const eff = task('  start 2026-01-06\n  late:effort 2d\n');
		expect(after(eff, set('a', 'milestone', true))).toBe(
			eff.replace('  late:effort', '  milestone\n  late:effort'),
		);
	});
});

describe('removeAttr', () => {
	it('removes every own top-scenario site, keeping trailing comments', () => {
		const sup = readTjp('tests/fixtures/tjp/supplement/plan.tjp');
		expect(after(sup, { type: 'removeAttr', task: 'top.a', attr: 'priority' })).toBe(
			sup.replace('  priority 600\n  priority 700\n', ''),
		);
		const src = HEAD + 'task a "A" {\n  effort 1d # one day\n  start 2026-01-06\n}\n';
		expect(after(src, { type: 'removeAttr', task: 'a', attr: 'effort' })).toBe(
			src.replace('effort 1d ', ''),
		);
	});

	it('refuses inherited values and gives not-present', () => {
		const src = HEAD + 'task p "P" {\n  priority 300\n  task c "C"\n}\n';
		const s = setup(src);
		const r = removeAttr(s.snap, s.index, 'p.c', 'priority');
		expect(r).toMatchObject({ status: 'refused', reason: 'inherited' });
		expect(removeAttr(s.snap, s.index, 'p.c', 'note')).toMatchObject({ reason: 'not-present' });
		expect(removeAttr(s.snap, s.index, 'p.c', 'start')).toMatchObject({ reason: 'not-present' });
	});

	it('refuses statements written with macros', () => {
		const src = 'macro len [3d]\n' + HEAD + 'task a "A" {\n  effort ${len}\n}\n';
		const s = setup(src);
		expect(removeAttr(s.snap, s.index, 'a', 'effort')).toMatchObject({ reason: 'text-only' });
	});

	it('inherits only what the parent wrote before the child (checked natively)', () => {
		const src =
			HEAD +
			'task p "P" {\n  task c "C" { start 2026-01-06 }\n  priority 300\n  flags hot\n}\n' +
			'supplement task p {\n  scheduling alap\n}\n';
		const s = setup(src);
		for (const attr of ['priority', 'flags', 'scheduling'] as const) {
			expect(removeAttr(s.snap, s.index, 'p.c', attr), attr).toMatchObject({
				reason: 'not-present',
			});
		}
	});

	it('leaves other scenarios alone', () => {
		const s = setup(readTjp('tests/fixtures/tjp/scenario-prefix/plan.tjp'));
		const r = removeAttr(s.snap, s.index, 'b', 'priority');
		expect(r).toEqual({ status: 'noop', reason: 'not-present' });
	});
});

describe('shared files', () => {
	const files = {
		'plan.tjp':
			HEAD +
			'task g1 "G1"\ntask g2 "G2"\n' +
			'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
		't.tji': 'task t "T" {\n  effort 1d\n}\n',
	};

	it('lets value rewrites and names through only when confirmed', () => {
		const s = setup(files);
		const value = set('g1.t', 'effort', '2d');
		expect(run(s, value)).toMatchObject({ reason: 'shared-declaration' });
		expect(textsAfter(s.snap, run(s, value, { confirmShared: true }))['t.tji']).toBe(
			'task t "T" {\n  effort 2d\n}\n',
		);
		const name: EditIntent = { type: 'renameTask', task: 'g2.t', name: 'Tee' };
		expect(run(s, name, { confirmShared: true }).status).toBe('edit');
	});

	it('always refuses id-valued attributes there', () => {
		const s = setup(files);
		const r = run(s, set('g1.t', 'responsible', ['r']), { confirmShared: true });
		expect(r).toMatchObject({ reason: 'shared-declaration' });
	});
});

describe('setAttr scheduling and milestone bounds', () => {
	it('refuses alap for a task with bookings', () => {
		const s = setup(
			HEAD +
				'task a "A" {\n  start 2026-01-05\n  effort 1d\n  allocate r\n' +
				'  booking r 2026-01-05-09:00 +2h\n}\n',
		);
		expect(run(s, set('a', 'scheduling', 'alap'))).toMatchObject({
			reason: 'conflicting-attribute',
		});
		expect(run(s, set('a', 'scheduling', 'asap')).status).toBe('edit');
	});

	it('refuses a milestone whose start and end differ', () => {
		const src = HEAD + 'task a "A" {\n  start 2026-01-06\n  end 2026-01-08\n}\n';
		const s = setup(src);
		expect(run(s, set('a', 'milestone', true))).toMatchObject({
			reason: 'conflicting-attribute',
		});
		const m = setup(HEAD + 'task m "M" {\n  start 2026-01-06\n  milestone\n}\n');
		expect(run(m, set('m', 'end', '2026-01-09'))).toMatchObject({
			reason: 'conflicting-attribute',
		});
		expect(run(m, set('m', 'start', '2026-01-07')).status).toBe('edit');
	});
});

describe('overspecified tasks', () => {
	it('refuses a criterion, start or end that would give start, end and duration', () => {
		const src =
			HEAD +
			'task a "A" {\n  start 2026-01-06\n  end 2026-01-09\n}\n' +
			'task b "B" {\n  start 2026-01-06\n  effort 2d\n  allocate r\n}\n' +
			'task c "C" {\n  depends !b\n  effort 1d\n  allocate r\n}\n';
		const s = setup(src);
		for (const [task, attr, value] of [
			['a', 'length', '1d'],
			['b', 'end', '2026-01-20'],
			['c', 'end', '2026-01-20'],
			['b', 'scheduling', 'alap'],
		] as const) {
			expect(run(s, set(task, attr, value)), `${task} ${attr}`).toMatchObject({
				reason: 'conflicting-attribute',
			});
		}
		expect(run(s, set('c', 'start', '2026-01-12')).status).toBe('edit');
		expect(run(s, set('a', 'end', '2026-01-12')).status).toBe('edit');
	});
});
