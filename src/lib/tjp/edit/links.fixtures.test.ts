// SPDX-License-Identifier: GPL-2.0-or-later
// The dependency and allocation intents on the T16 fixtures and golden plans: exact text changes
// with CRLF, tabs, one-line blocks, supplements, relative references, task prefixes and
// scenario prefixes (phase-1.md 7.1, 7.2, 9.4).
import { describe, expect, it } from 'vitest';
import { readTjp } from '../../../../tests/grammar/corpus';
import { applyIntent } from './apply';
import { setup, textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';

function fixture(dir: string, files: readonly string[] = ['plan.tjp']) {
	const all: Record<string, string> = {};
	for (const f of files) all[f] = readTjp(`${dir}/${f}`);
	return { all, s: setup(all) };
}

const T = 'tests/fixtures/tjp';

function edit(dir: string, intent: EditIntent, files?: readonly string[]) {
	const { all, s } = fixture(`${T}/${dir}`, files);
	const r: EditResult = applyIntent(s.snap, s.index, intent);
	return { all, r, after: r.status === 'edit' ? textsAfter(s.snap, r) : all };
}

describe('link intents on the fixtures', () => {
	it('crlf-plan: keeps CRLF in appended and inserted text', () => {
		const a = edit('crlf-plan', {
			type: 'setDependsGap',
			task: 'b',
			target: 'a',
			gap: { kind: 'gaplength', value: '1d' },
		});
		expect(a.after['plan.tjp']).toBe(
			a.all['plan.tjp']?.replace('depends !a\r\n', 'depends !a { gaplength 1d }\r\n'),
		);
		const b = edit('crlf-plan', { type: 'removeDepends', task: 'b', target: 'a' });
		expect(b.after['plan.tjp']).toBe(b.all['plan.tjp']?.replace('  depends !a\r\n', ''));
		const c = edit('crlf-plan', { type: 'addDepends', task: 'a', target: 'b' });
		expect(c.r).toMatchObject({ reason: 'cycle' });
	});

	it('tabs: inserts at the tab indentation', () => {
		const a = edit('tabs', { type: 'removeDepends', task: 'b', target: 'a' });
		const plain = a.after['plan.tjp'] ?? '';
		expect(plain).not.toContain('depends');
		const s = setup({ 'plan.tjp': plain });
		const r = applyIntent(s.snap, s.index, { type: 'addDepends', task: 'b', target: 'a' });
		expect(textsAfter(s.snap, r)['plan.tjp']).toBe(
			a.all['plan.tjp']?.replace('depends\t!a', 'depends !a'),
		);
	});

	it('one-line-blocks: adds inline', () => {
		const a = edit('one-line-blocks', { type: 'addDepends', task: 'b', target: 'c.c1' });
		expect(a.after['plan.tjp']).toContain(
			'task b "B" { effort 1d depends !a, c.c1 allocate ana, bo }',
		);
		const b = edit('one-line-blocks', { type: 'removeAllocation', task: 'b', resource: 'bo' });
		expect(b.after['plan.tjp']).toContain('task b "B" { effort 1d depends !a allocate ana }');
		const c = edit('one-line-blocks', { type: 'addDepends', task: 'c.c1', target: 'a' });
		expect(c.after['plan.tjp']).toContain('task c1 "C1" { effort 1d depends a allocate ana }');
		// c2 already follows c1; m is a milestone after c2, which may not be allocated alone.
		expect(
			edit('one-line-blocks', { type: 'addDepends', task: 'c.c2', target: 'c.c1' }).r,
		).toMatchObject({
			reason: 'already-linked',
		});
	});

	it('relative-ids: resolves !, !! and !!! and writes !id only for siblings', () => {
		const a = edit('relative-ids', { type: 'removeDepends', task: 'top.grp.g1', target: 'top.s2' });
		expect(a.after['plan.tjp']).toContain('depends top.s1 { gapduration 1d }\n');
		const b = edit('relative-ids', {
			type: 'setDependsGap',
			task: 'top.grp.g1',
			target: 'top.s1',
			gap: null,
		});
		expect(b.after['plan.tjp']).toContain('depends !!s2, top.s1\n');
		const c = edit('relative-ids', { type: 'addDepends', task: 'top.grp.g2', target: 'top.s1' });
		expect(c.after['plan.tjp']).toContain('depends !g1 { onstart }, !!!other, top.s1\n');
		expect(
			edit('relative-ids', { type: 'addDepends', task: 'top.grp.g2', target: 'other' }).r,
		).toMatchObject({
			reason: 'already-linked',
		});
	});

	it('scenario-prefix: conflicting prefixed links and prefixed lists', () => {
		const a = edit('scenario-prefix', { type: 'removeDepends', task: 'b', target: 'a' });
		expect(a.after['plan.tjp']).not.toContain('depends');
		const b = edit('scenario-prefix', { type: 'addDepends', task: 'b', target: 'a' });
		expect(b.r).toMatchObject({ reason: 'already-linked' });
	});

	it('supplement: appends allocations to the last own list', () => {
		const a = edit('supplement', { type: 'addAllocation', task: 'top.b', resource: 'ana' });
		expect(a.after['plan.tjp']).toContain('task b "B" { effort 1d allocate bo, ana }');
		const b = edit('supplement', {
			type: 'replaceAllocation',
			task: 'top.a',
			from: 'ana',
			to: 'bo',
		});
		expect(b.after['plan.tjp']).toContain('    allocate bo\n');
	});

	it('include-taskprefix: edits the included file and respects inherited allocations', () => {
		const files = ['plan.tjp', 'sub.tji'];
		const a = edit(
			'include-taskprefix',
			{ type: 'addDepends', task: 'parent.sub1', target: 'after' },
			files,
		);
		expect(a.r).toMatchObject({ reason: 'cycle' });
		const b = edit(
			'include-taskprefix',
			{ type: 'removeAllocation', task: 'parent.sub2', resource: 'ana' },
			files,
		);
		expect(b.r).toMatchObject({ reason: 'inherited' });
		const c = edit(
			'include-taskprefix',
			{ type: 'removeDepends', task: 'parent.sub2', target: 'parent.sub1' },
			files,
		);
		expect(c.after['sub.tji']).toBe(c.all['sub.tji']?.replace('  depends !sub1\n', ''));
	});

	it('macro-ids: refuses ids from expansion and lists ending in a macro call', () => {
		const text = readTjp(`${T}/macro-ids/plan.tjp`) + 'task other "Other"\n';
		const s = setup(text);
		const run = (intent: EditIntent): EditResult => applyIntent(s.snap, s.index, intent);
		// Without engine hints, `${tid}` declares no id the edit API can name.
		expect(run({ type: 'addDepends', task: 'dev', target: 'other' })).toMatchObject({
			reason: 'unknown-target',
		});
		expect(run({ type: 'addAllocation', task: 'dev.dev_sub', resource: 'ana' })).toMatchObject({
			reason: 'unknown-target',
		});
		// `depends ${tid}`: an item appended after the call would join its expansion.
		expect(run({ type: 'addDepends', task: 'lit', target: 'other' })).toMatchObject({
			status: 'refused',
		});
		const ok = run({ type: 'addDepends', task: 'other', target: 'lit' });
		expect(textsAfter(s.snap, ok)['plan.tjp']).toBe(
			text.replace('task other "Other"\n', 'task other "Other" {\n  depends !lit\n}\n'),
		);
	});

	it('macro-statements: macro-in-body when a body macro may write the list', () => {
		const { all, s } = fixture(`${T}/macro-statements`);
		const run = (intent: EditIntent): EditResult => applyIntent(s.snap, s.index, intent);
		// `${alloc}` expands to `allocate ana`: the edit cannot see that allocation.
		expect(run({ type: 'addAllocation', task: 'a', resource: 'bo' })).toMatchObject({
			status: 'refused',
			reason: 'macro-in-body',
		});
		// `${twoLines}` writes priority and note only; `${?absent}` expands to nothing.
		const b = run({ type: 'replaceAllocation', task: 'b', from: 'bo', to: 'ana' });
		expect(textsAfter(s.snap, b)['plan.tjp']).toBe(
			all['plan.tjp']?.replace('  depends !a\n  allocate bo\n', '  depends !a\n  allocate ana\n'),
		);
		expect(run({ type: 'removeDepends', task: 'b', target: 'a' })).toMatchObject({
			status: 'edit',
		});
		// Appending to the list right before `${?absent}` is refused by the core's macro rules.
		expect(run({ type: 'addAllocation', task: 'c', resource: 'ana' })).toMatchObject({
			status: 'refused',
			reason: 'text-only',
			textOnly: 'macro-call',
		});
	});
});

describe('link intents on golden plans', () => {
	const G = 'engine/golden/plans/synthetic';
	it('07: onstart/onend items keep their bodies', () => {
		const { all, s } = fixture(`${G}/07-deps-onstart-onend`);
		const r = applyIntent(s.snap, s.index, {
			type: 'setDependsGap',
			task: 'chain.e',
			target: 'chain.d',
			gap: { kind: 'gapduration', value: '1d' },
		});
		expect(textsAfter(s.snap, r)['plan.tjp']).toBe(
			all['plan.tjp']?.replace(
				'depends !c, !d { onend }',
				'depends !c, !d { onend gapduration 1d }',
			),
		);
	});

	it('08: rewrites a multi-line gap body and clears it', () => {
		const { all, s } = fixture(`${G}/08-deps-gaps-alap`);
		const set = applyIntent(s.snap, s.index, {
			type: 'setDependsGap',
			task: 'line.build',
			target: 'line.design',
			gap: { kind: 'gaplength', value: '3d' },
		});
		expect(textsAfter(s.snap, set)['plan.tjp']).toBe(
			all['plan.tjp']?.replace('      gapduration 7d\n', '      gaplength 3d\n'),
		);
		const clear = applyIntent(s.snap, s.index, {
			type: 'setDependsGap',
			task: 'line.build',
			target: 'line.design',
			gap: null,
		});
		expect(textsAfter(s.snap, clear)['plan.tjp']).toBe(
			all['plan.tjp']?.replace(
				'depends !design {\n      gapduration 7d\n    }\n',
				'depends !design\n',
			),
		);
		// A precedes link in an ALAP chain.
		const p = applyIntent(s.snap, s.index, {
			type: 'removeDepends',
			task: 'alap.gamma',
			target: 'alap.beta',
		});
		expect(textsAfter(s.snap, p)['plan.tjp']).not.toContain('precedes !gamma');
	});

	it('15: refuses allocation items with alternatives', () => {
		const { s } = fixture(`${G}/15-allocate-select`);
		const bodied = s.index.allocations.find((a) => a.body !== null);
		expect(bodied?.task).toBeTruthy();
		const r = applyIntent(s.snap, s.index, {
			type: 'addAllocation',
			task: bodied?.task ?? '',
			resource: [...s.index.resources.keys()][0] ?? '',
		});
		expect(r).toMatchObject({ status: 'refused', reason: 'unsupported-form' });
	});
});
