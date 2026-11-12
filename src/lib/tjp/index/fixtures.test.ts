// SPDX-License-Identifier: GPL-2.0-or-later
// The index on the T16/T7 edge fixtures, whose native results are recorded in
// tests/fixtures/tjp/README.md: include prefixes and the inherited @property, templates read once
// per include site, supplements, macro ids, relative ids and scenario prefixes.
import { describe, expect, it } from 'vitest';
import { buildIndex } from './index';
import { fixture } from './testing';

const index = (name: string) => buildIndex(fixture(name).snapshot(), undefined, { cache: null });

describe('include-prefix-property', () => {
	const idx = index('include-prefix-property');

	it('declares once per visit, with the parents TaskJuggler gives (native)', () => {
		// Tree pre-order, as engine/bridge/serialize.rb lists tasks.
		expect([...idx.tasks.keys()]).toEqual([
			'outer',
			'outer.mid',
			'outer.mid.leaf2',
			'outer.leaf',
			'g1',
			'g1.t',
			'g1.n',
			'g2',
			'g2.t',
			'g2.n',
			'after',
		]);
		expect(idx.unresolved).toEqual([]);
	});

	it('marks a declaration text read in several visits', () => {
		expect(idx.tasks.get('g1.t')?.sharedWith).toEqual(['g2.t']);
		expect(idx.tasks.get('g2.n')?.sharedWith).toEqual(['g1.n']);
		expect(idx.tasks.get('outer.leaf')?.sharedWith).toEqual([]);
		const t1 = idx.tasks.get('g1.t');
		const t2 = idx.tasks.get('g2.t');
		expect(t1?.decl).toEqual(t2?.decl);
		expect(t1?.visit).not.toBe(t2?.visit);
	});

	it('resolves every dependency of the final task', () => {
		const deps = idx.dependencies.filter((d) => d.succ === 'after');
		expect(deps.map((d) => d.pred)).toEqual([
			'outer.leaf',
			'outer.mid.leaf2',
			'g1.t',
			'g2.t',
			'g1.n',
			'g2.n',
		]);
	});

	it('lists prefixes as references', () => {
		const pre = idx.references.filter((r) => r.via === 'taskprefix');
		expect(pre.map((r) => [r.written, r.target])).toEqual([
			['outer', 'outer'],
			['mid', 'outer.mid'],
			['outer', 'outer'],
			['mid', 'outer.mid'],
			['g1', 'g1'],
			['t', 'g1.t'],
			['g2', 'g2'],
			['t', 'g2.t'],
		]);
	});
});

describe('include-taskprefix and include-resourceprefix', () => {
	it('prefixes top-level task ids', () => {
		const idx = index('include-taskprefix');
		expect([...idx.tasks.keys()].some((id) => id.startsWith('parent.'))).toBe(true);
		for (const d of idx.dependencies) expect(d.pred && d.succ).toBeTruthy();
	});

	it('keeps resource ids flat and parents them to the prefix resource', () => {
		const idx = index('include-resourceprefix');
		expect(idx.resources.get('dev')?.parent).toBe('team');
		expect(idx.resources.get('team')?.children).toEqual(['lead', 'dev']);
		expect(idx.allocations.map((a) => a.resource)).toEqual(['lead', 'dev']);
	});

	it('include-nested: nested includes, macros from includes, both prefixes', () => {
		const idx = index('include-nested');
		expect([...idx.tasks.keys()]).toEqual(['root', 'root.child', 'last']);
		expect(idx.resources.get('deputy')?.parent).toBe('who');
		expect(idx.macros.get('leafnote')?.length).toBe(1);
		expect(idx.dependencies[0]?.pred).toBe('root.child');
	});
});

describe('supplement', () => {
	const idx = index('supplement');

	it('adds supplement blocks as extra sites, in parse order', () => {
		const a = idx.tasks.get('top.a');
		expect(a?.supplements).toHaveLength(1);
		expect(a?.attrs.map((s) => `${s.keyword}:${s.site}`)).toEqual([
			'effort:decl',
			'allocate:decl',
			'priority:supplement',
			'priority:supplement',
			'note:supplement',
		]);
		expect(idx.tasks.get('top')?.children).toEqual(['top.a', 'top.b']);
		expect(idx.resources.get('ana')?.attrs.map((s) => s.keyword)).toEqual([
			'efficiency',
			'vacation',
		]);
		expect(idx.leaves).toHaveLength(1);
		expect(idx.leaves[0]?.scope).toEqual({ kind: 'resource', resource: 'ana' });
		expect(idx.workingHours.map((w) => w.scope)).toEqual([
			{ kind: 'resource', resource: 'bo' },
			{ kind: 'resource', resource: 'bo' },
		]);
		const refs = idx.references.filter((r) => r.via === 'supplement');
		expect(refs.map((r) => r.target)).toEqual(['top.a', 'top', 'ana', 'bo']);
	});
});

describe('macro-ids', () => {
	it('leaves macro ids unresolved without hints, with X4 over the whole block', () => {
		const ws = fixture('macro-ids');
		const idx = buildIndex(ws.snapshot(), undefined, { cache: null });
		expect([...idx.tasks.keys()]).toEqual(['lit']);
		expect(idx.unresolved.map((u) => [u.kind, u.reason])).toEqual([
			['resource', 'macro-id'],
			['task', 'macro-id'],
			['task', 'macro-id'],
		]);
		const x4 = idx
			.textOnly('plan.tjp')
			.filter((t) => t.reason === 'macro-id' && t.within === null)
			.map((t) => t.at);
		expect(x4).toEqual(idx.unresolved.map((u) => u.decl.block));
		// Text inside `task ${tid}` is text-only.
		expect(idx.blocking('plan.tjp', x4[1]?.from ?? 0, (x4[1]?.from ?? 0) + 1)?.reason).toBe(
			'macro-id',
		);
	});

	it('takes ids from engine hints by header line, narrowing X4 to id and name', () => {
		const ws = fixture('macro-ids');
		const hints = {
			tasks: [
				{ id: 'dev', parent: null, file: 'plan.tjp', line: 12 },
				{ id: 'dev.dev_sub', parent: 'dev', file: 'plan.tjp', line: 13 },
				{ id: 'lit', parent: null, file: 'plan.tjp', line: 18 },
			],
			resources: [
				{ id: 'ana', parent: null, file: 'plan.tjp', line: 9 },
				{ id: 'ana2', parent: null, file: 'plan.tjp', line: 10 },
			],
		};
		const idx = buildIndex(ws.snapshot(), hints, { cache: null });
		expect([...idx.tasks.keys()]).toEqual(['dev', 'dev.dev_sub', 'lit']);
		expect(idx.tasks.get('dev')?.idSource).toBe('engine');
		expect(idx.resources.get('ana2')?.idSource).toBe('engine');
		expect(idx.unresolved).toEqual([]);
		expect(idx.textOnly('plan.tjp').some((t) => t.reason === 'macro-id' && t.within === null)).toBe(
			false,
		);
		// `depends ${tid}` and `allocate ${who}` stay text-only.
		expect(idx.dependencies[0]?.textOnly?.reason).toBe('macro-call');
		expect(idx.allocations.find((a) => a.written === '${who}')?.textOnly?.reason).toBe(
			'macro-call',
		);
	});
});

describe('relative-ids and scenario-prefix', () => {
	it('resolves `!`, `!!` and absolute references as rule_taskDepId does', () => {
		const idx = index('relative-ids');
		const bad = idx.dependencies.filter((d) => d.pred === null || d.succ === null);
		expect(bad).toEqual([]);
		expect(idx.dependencies.length).toBeGreaterThan(3);
	});

	it('records scenario prefixes and declared scenarios', () => {
		const idx = index('scenario-prefix');
		expect(idx.scenarios.length).toBeGreaterThan(1);
		const prefixed = [...idx.tasks.values()].flatMap((t) => t.attrs).filter((a) => a.scenario);
		expect(prefixed.map((a) => a.scenario)).toContain('delayed');
		const dep = idx.dependencies.find((d) => d.scenario === 'delayed');
		expect(dep?.pred).not.toBeNull();
	});
});
