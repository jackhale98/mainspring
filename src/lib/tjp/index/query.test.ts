// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { compareParseOrder } from '../../workspace/includes';
import { buildIndex, lastSite } from './index';
import { fixture, golden, inline } from './testing';

const text = [
	'project p "P" 2026-01-05 +2m',
	'macro m [x]',
	'resource r "R"',
	'task a "A" {',
	'  task b "B" {',
	'    allocate r',
	'    effort 1d',
	'  }',
	'}',
	'supplement task a.b { depends a }',
	'',
].join('\n');

describe('symbolAt', () => {
	const idx = buildIndex(inline({ 'plan.tjp': text }).snapshot(), undefined, { cache: null });
	const at = (needle: string, delta = 0) => idx.symbolAt('plan.tjp', text.indexOf(needle) + delta);

	it('finds headers, references, supplements, macros and bodies', () => {
		expect(at('task b')).toMatchObject({ kind: 'task', id: 'a.b', role: 'header' });
		expect(at('allocate r', 9)).toMatchObject({ kind: 'reference' });
		const ref = at('allocate r', 9);
		expect(ref?.kind === 'reference' && ref.ref.target).toBe('r');
		expect(at('supplement')).toMatchObject({ kind: 'supplement', target: 'a.b', of: 'task' });
		expect(at('depends a', 8)).toMatchObject({ kind: 'reference' });
		expect(at('m [')).toMatchObject({ kind: 'macro', name: 'm' });
		expect(at('effort')).toMatchObject({ kind: 'task', id: 'a.b', role: 'body' });
		expect(at('project')).toBeNull();
	});
});

describe('lastSite', () => {
	it('picks the last site TaskJuggler reads, supplements included', () => {
		const idx = buildIndex(fixture('supplement').snapshot(), undefined, { cache: null });
		const a = idx.tasks.get('top.a');
		const p = lastSite(a?.attrs ?? [], 'priority');
		expect(p?.site).toBe('supplement');
		expect(p).toBe(a?.attrs.filter((s) => s.keyword === 'priority')[1]);
		expect(lastSite(a?.attrs ?? [], 'priority', 'delayed')).toBeNull();
		expect(lastSite(a?.attrs ?? [], 'complete')).toBeNull();
	});

	it('lists attributes in the order compareParseOrder gives, across files', () => {
		for (const ws of [
			golden('syn-18-structure-include-macro'),
			golden('upstream-tutorial'),
			fixture('supplement'),
		]) {
			const snap = ws.snapshot();
			const idx = buildIndex(snap, undefined, { cache: null });
			for (const sym of [...idx.tasks.values(), ...idx.resources.values()]) {
				for (let i = 1; i < sym.attrs.length; i++) {
					const prev = sym.attrs[i - 1]?.statement;
					const cur = sym.attrs[i]?.statement;
					if (!prev || !cur) continue;
					expect(compareParseOrder(snap.includes, prev, cur)).toBeLessThan(0);
				}
			}
		}
	});
});

describe('textOnly and blocking', () => {
	it('adds hint-dependent ranges to the file ranges', () => {
		const t = 'project p "P" 2026-01-05 +2m\nmacro id [x]\ntask ${id} "X" {\n  effort 1d\n}\n';
		const ws = inline({ 'plan.tjp': t });
		const without = buildIndex(ws.snapshot(), undefined, { cache: null });
		const effort = t.indexOf('effort');
		expect(without.blocking('plan.tjp', effort, effort + 9)?.reason).toBe('macro-id');
		const hints = { tasks: [{ id: 'x', parent: null, file: 'plan.tjp', line: 3 }], resources: [] };
		const withHints = buildIndex(ws.snapshot(), hints, { cache: null });
		expect(withHints.blocking('plan.tjp', effort, effort + 9)).toBeNull();
		expect(withHints.tasks.get('x')?.attrs[0]?.textOnly).toBeNull();
		const id = t.indexOf('${id}');
		expect(withHints.blocking('plan.tjp', id, id + 5)?.reason).toBe('macro-id');
		expect(without.tasks.size).toBe(0);
	});
});

describe('isFor', () => {
	it('matches only the snapshot the index was built from', () => {
		const ws = inline({ 'plan.tjp': text });
		const snap = ws.snapshot();
		const idx = buildIndex(snap, undefined, { cache: null });
		expect(idx.isFor(snap)).toBe(true);
		expect(idx.isFor({ ...snap, files: new Map(snap.files) })).toBe(true);
		const other = inline({ 'plan.tjp': text }).snapshot();
		expect(other.version).toBe(snap.version);
		expect(idx.isFor(other)).toBe(false);
	});
});
