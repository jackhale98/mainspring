// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseTjp, type TopContext } from '../tjp/document';
import {
	buildIncludeGraph,
	compareParseOrder,
	contextConflicts,
	parseOrderKey,
	visitsOf,
	type IncludeGraph,
} from './includes';
import { pathLookup } from './paths';

/** Builds the graph over in-memory files, recording which top each file was parsed with. */
function graphOf(
	files: Record<string, string>,
	entry = 'plan.tjp',
): IncludeGraph & { parsed: Array<[string, TopContext]> } {
	const parsed: Array<[string, TopContext]> = [];
	const g = buildIncludeGraph(entry, {
		lookup: pathLookup(Object.keys(files)),
		parse(path, top) {
			parsed.push([path, top]);
			const text = files[path] ?? '';
			return { tree: parseTjp(text, { top }), read: (from, to) => text.slice(from, to) };
		},
	});
	return { ...g, parsed };
}

const HEADER = 'project p "P" 2026-01-05 +1m';

describe('include contexts (TjpSyntaxRules rule_prologInclude, rule_projectBodyInclude, rule_propertiesInclude)', () => {
	const g = graphOf({
		'plan.tjp': `include "macros.tji"\n${HEADER} {\n  include "head.tji"\n}\ninclude "body.tji"\n`,
		'macros.tji': 'macro m [x]\ninclude "more-macros.tji"\n',
		'more-macros.tji': 'macro n [y]\n',
		'head.tji': 'timezone "UTC"\ninclude "head2.tji"\n',
		'head2.tji': 'now 2026-01-05\n',
		'body.tji': 'task t "T"\ninclude "sub/deep.tji"\n',
		'sub/deep.tji': 'task u "U"\n',
		'orphan.tji': 'task o "O"\n',
	});

	it('reads files before the header as prolog, in the header as project, after it as global', () => {
		expect([...g.tops]).toEqual([
			['plan.tjp', 'global'],
			['macros.tji', 'prolog'],
			['more-macros.tji', 'prolog'],
			['head.tji', 'project'],
			['head2.tji', 'project'],
			['body.tji', 'global'],
			['sub/deep.tji', 'global'],
		]);
		expect(g.order).toEqual([...g.tops.keys()]);
		expect(g.edges.map((e) => [e.from, e.literal, e.target, e.top, e.problem])).toEqual([
			['plan.tjp', 'macros.tji', 'macros.tji', 'prolog', 'before-project'],
			['macros.tji', 'more-macros.tji', 'more-macros.tji', 'prolog', 'before-project'],
			['plan.tjp', 'head.tji', 'head.tji', 'project', null],
			['head.tji', 'head2.tji', 'head2.tji', 'project', null],
			['plan.tjp', 'body.tji', 'body.tji', 'global', null],
			['body.tji', 'sub/deep.tji', 'sub/deep.tji', 'global', null],
		]);
		expect(g.parsed).toEqual([...g.tops]);
		expect(g.tops.has('orphan.tji')).toBe(false);
	});

	it('gives each edge its statement as the site', () => {
		const e = g.edges[2];
		expect(e?.site.file).toBe('plan.tjp');
		const text = `include "macros.tji"\n${HEADER} {\n  include "head.tji"\n}\ninclude "body.tji"\n`;
		expect(e && text.slice(e.site.from, e.site.to)).toBe('include "head.tji"');
	});
});

describe('include problems', () => {
	it('reports suffix, outside, missing, recursion and macro paths', () => {
		const g = graphOf({
			'plan.tjp': [
				HEADER,
				'include "a.tjp"',
				'include "/etc/a.tji"',
				'include "../a.tji"',
				'include "missing.tji"',
				'include "${dir}/a.tji"',
				'include ${path}',
				'include',
				"include 'lib/a.tji'",
				'',
			].join('\n'),
			'lib/a.tji': 'include "b.tji"\n',
			'lib/b.tji': 'include "../lib/a.tji"\ninclude "c.tji"\n',
			'lib/c.tji': 'task c "C"\n',
		});
		expect(g.edges.map((e) => [e.literal, e.target, e.problem])).toEqual([
			['a.tjp', null, 'bad-suffix'],
			['/etc/a.tji', null, 'outside-workspace'],
			['../a.tji', null, 'outside-workspace'],
			['missing.tji', null, 'not-found'],
			['"${dir}/a.tji"', null, 'macro-path'],
			['${path}', null, 'macro-path'],
			['', null, 'no-name'],
			['lib/a.tji', 'lib/a.tji', null],
			['b.tji', 'lib/b.tji', null],
			['../lib/a.tji', 'lib/a.tji', 'recursive'],
			['c.tji', 'lib/c.tji', null],
		]);
		expect(g.order).toEqual(['plan.tjp', 'lib/a.tji', 'lib/b.tji', 'lib/c.tji']);
	});

	it('detects a file including itself and decodes escapes in names', () => {
		const g = graphOf({
			'plan.tjp': `${HEADER}\ninclude "plan.tji"\n`,
			'plan.tji': 'include "plan.tji"\n',
		});
		expect(g.edges.map((e) => e.problem)).toEqual([null, 'recursive']);
		const q = graphOf({ 'plan.tjp': `${HEADER}\ninclude 'it\\'s.tji'\n`, "it's.tji": '' });
		expect(q.edges[0]?.target).toBe("it's.tji");
	});

	it('parses a file included twice once, in its first context, and lists the conflict', () => {
		const g = graphOf({
			'plan.tjp': `${HEADER} {\n  include "x.tji"\n}\ninclude "x.tji"\n`,
			'x.tji': 'timezone "UTC"\n',
		});
		expect(g.edges.map((e) => [e.target, e.top, e.visit])).toEqual([
			['x.tji', 'project', 1],
			['x.tji', 'global', 2],
		]);
		expect(g.tops.get('x.tji')).toBe('project');
		expect(g.parsed).toEqual([
			['plan.tjp', 'global'],
			['x.tji', 'project'],
		]);
		expect(contextConflicts(g).map((v) => [v.file, v.top])).toEqual([['x.tji', 'global']]);
	});

	it('ignores include text in macro bodies and task bodies', () => {
		const g = graphOf({
			'plan.tjp': `macro m [ include "a.tji" ]\n${HEADER}\ntask t "T" {\n  include "a.tji"\n}\n`,
			'a.tji': '',
		});
		expect(g.edges).toEqual([]);
	});
});

describe('prefixes (rule_includeAttributesBody, rule_taskId)', () => {
	it('records written prefixes and composes them along the chain', () => {
		const plan = `${HEADER}\ninclude "a.tji" { taskprefix top resourceprefix team }\ninclude "c.tji"\n`;
		const g = graphOf({
			'plan.tjp': plan,
			'a.tji': 'include "b.tji" { taskprefix sub }\n',
			'b.tji': 'include "c.tji"\n',
			'c.tji': '',
		});
		expect(g.edges.map((e) => [e.from, e.target, e.taskPrefix, e.resourcePrefix])).toEqual([
			['plan.tjp', 'a.tji', 'top', 'team'],
			['a.tji', 'b.tji', 'top.sub', 'team'],
			['b.tji', 'c.tji', 'top.sub', 'team'],
			['plan.tjp', 'c.tji', null, null],
		]);
		const w = g.edges[0]?.written;
		expect(w?.taskPrefix && plan.slice(w.taskPrefix.from, w.taskPrefix.to)).toBe('top');
		expect(w?.resourcePrefix && plan.slice(w.resourcePrefix.from, w.resourcePrefix.to)).toBe(
			'team',
		);
		expect(g.edges[2]?.written).toEqual({ taskPrefix: null, resourcePrefix: null });
	});
});

describe('visits (TaskJuggler reads a file once per include site)', () => {
	// Native: a template included under g1 and g2 declares g1.t and g2.t, and its nested include
	// is read on both visits (tests/fixtures/tjp/include-prefix-property).
	const plan = `${HEADER}\ntask g1 "G1"\ntask g2 "G2"\ninclude "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n`;
	const g = graphOf({
		'plan.tjp': plan,
		't.tji': 'include "n.tji"\ntask t "T"\n',
		'n.tji': 'task n "N"\n',
	});

	it('walks every site and each nested include again', () => {
		expect(g.visits.map((v) => [v.index, v.file, v.parent, v.taskPrefix])).toEqual([
			[0, 'plan.tjp', null, null],
			[1, 't.tji', 0, 'g1'],
			[2, 'n.tji', 1, 'g1'],
			[3, 't.tji', 0, 'g2'],
			[4, 'n.tji', 3, 'g2'],
		]);
		expect(g.edges.map((e) => [e.from, e.target, e.parentVisit, e.visit, e.taskPrefix])).toEqual([
			['plan.tjp', 't.tji', 0, 1, 'g1'],
			['t.tji', 'n.tji', 1, 2, 'g1'],
			['plan.tjp', 't.tji', 0, 3, 'g2'],
			['t.tji', 'n.tji', 3, 4, 'g2'],
		]);
		expect(g.order).toEqual(['plan.tjp', 't.tji', 'n.tji']);
		expect(g.parsed.map(([p]) => p)).toEqual(['plan.tjp', 't.tji', 'n.tji']);
		expect(visitsOf(g, 'n.tji').map((v) => v.index)).toEqual([2, 4]);
		expect(contextConflicts(g)).toEqual([]);
	});

	it('orders positions through the first, the last or a given visit', () => {
		const second = plan.lastIndexOf('include');
		const first = plan.indexOf('include');
		const nested = 0;
		expect(parseOrderKey(g, { file: 'n.tji', from: 3 })).toEqual([second, nested, 3]);
		expect(parseOrderKey(g, { file: 'n.tji', from: 3 }, 'first')).toEqual([first, nested, 3]);
		expect(parseOrderKey(g, { file: 'n.tji', from: 3 }, 2)).toEqual([first, nested, 3]);
		expect(parseOrderKey(g, { file: 'n.tji', from: 3 }, 1)).toBeNull();
		// Last visit: n.tji is read after t.tji's own task on the first visit.
		const tTask = { file: 't.tji', from: 'include "n.tji"\n'.length };
		expect(compareParseOrder(g, { file: 'n.tji', from: 0 }, tTask)).toBeLessThan(0);
		expect(
			compareParseOrder(g, { file: 'n.tji', from: 0 }, { file: 'plan.tjp', from: first }),
		).toBeGreaterThan(0);
	});

	it('places each position through its own visit when comparing two files', () => {
		const tTask = 'include "n.tji"\n'.length;
		// n.tji on visit 2 (under g1) is read before t.tji's task on visit 3 (under g2) ...
		expect(
			compareParseOrder(
				g,
				{ file: 'n.tji', from: 0, visit: 2 },
				{ file: 't.tji', from: tTask, visit: 3 },
			),
		).toBeLessThan(0);
		// ... and n.tji on visit 4 after t.tji's task on visit 1.
		expect(
			compareParseOrder(
				g,
				{ file: 'n.tji', from: 0, visit: 4 },
				{ file: 't.tji', from: tTask, visit: 1 },
			),
		).toBeGreaterThan(0);
		// A position without its own visit uses `which`; the other keeps its own.
		expect(
			compareParseOrder(
				g,
				{ file: 'n.tji', from: 0 },
				{ file: 't.tji', from: tTask, visit: 1 },
				'first',
			),
		).toBeLessThan(0);
		expect(
			compareParseOrder(g, { file: 'n.tji', from: 0 }, { file: 't.tji', from: tTask, visit: 1 }),
		).toBeGreaterThan(0);
	});

	it('stops at the visit limit', async () => {
		const { VISIT_LIMIT } = await import('./includes');
		// A chain of doubling includes: 2^14 visits would be made.
		const files: Record<string, string> = { 'plan.tjp': `${HEADER}\ninclude "f0.tji"\n` };
		for (let i = 0; i < 14; i++)
			files[`f${i}.tji`] = `include "f${i + 1}.tji"\ninclude "f${i + 1}.tji"\n`;
		files['f14.tji'] = '';
		const big = graphOf(files);
		expect(big.visits.length).toBe(VISIT_LIMIT);
		expect(big.edges.some((e) => e.problem === 'visit-limit')).toBe(true);
	});
});

describe('prefix details', () => {
	it('marks a macro prefix unknown for every visit below it', () => {
		const g = graphOf({
			'plan.tjp': `macro pre [g1]\n${HEADER}\ntask g1 "G1"\ninclude "x.tji" { taskprefix ${'${pre}'} }\n`,
			'x.tji': 'include "y.tji" { taskprefix t }\ntask t "T"\n',
			'y.tji': '',
		});
		expect(g.edges.map((e) => [e.target, e.taskPrefix, e.problem, e.visit])).toEqual([
			['x.tji', null, 'macro-prefix', 1],
			['y.tji', null, null, 2],
		]);
		expect(g.visits.map((v) => [v.taskPrefixUnknown, v.resourcePrefixUnknown])).toEqual([
			[false, false],
			[true, false],
			[true, false],
		]);
	});

	it('keeps task and resource prefixes apart, and labels only macro tokens', () => {
		const g = graphOf({
			'plan.tjp': `${HEADER}\nresource r "R"\ninclude "x.tji" { taskprefix ${'${pre}'} resourceprefix r }\ninclude "y.tji" { taskprefix "g1" }\n`,
			'x.tji': '',
			'y.tji': '',
		});
		expect(g.edges.map((e) => [e.target, e.taskPrefix, e.resourcePrefix, e.problem])).toEqual([
			['x.tji', null, 'r', 'macro-prefix'],
			['y.tji', null, null, null],
		]);
		expect(g.visits.map((v) => [v.taskPrefixUnknown, v.resourcePrefixUnknown])).toEqual([
			[false, false],
			[true, false],
			[true, false],
		]);
	});

	it('records the @property a nested include inherits (rule_taskHeader)', () => {
		// Native (fixture include-prefix-property): outer.leaf, outer.mid.leaf2.
		const g = graphOf({
			'plan.tjp': `${HEADER}\ntask outer "O"\ninclude "a.tji" { taskprefix outer }\ninclude "x.tji" { taskprefix outer }\n`,
			'a.tji':
				'task mid "M"\ninclude "b.tji" { taskprefix mid }\ninclude "b2.tji" { taskprefix mid }\n',
			'x.tji': 'include "c.tji" { taskprefix mid }\n',
			'b.tji': 'task leaf "L"\n',
			'b2.tji': '',
			'c.tji': 'task leaf2 "L2"\n',
		});
		expect(g.visits.map((v) => [v.file, v.taskPrefix, v.property])).toEqual([
			['plan.tjp', null, null],
			['a.tji', 'outer', null],
			['b.tji', 'outer.mid', { kind: 'task', id: 'outer' }],
			// popFileStack clears @property when b.tji returns.
			['b2.tji', 'outer.mid', null],
			['x.tji', 'outer', null],
			['c.tji', 'outer.mid', null],
		]);
	});

	it('keeps a resource @property for resources and none at the top without a prefix', () => {
		const g = graphOf({
			'plan.tjp': `${HEADER}\nresource r "R"\ninclude "a.tji" { resourceprefix r }\n`,
			'a.tji': 'resource s "S"\ninclude "b.tji"\n',
			'b.tji': '',
		});
		expect(g.visits.map((v) => [v.file, v.resourcePrefix, v.property])).toEqual([
			['plan.tjp', null, null],
			['a.tji', 'r', null],
			['b.tji', 'r', { kind: 'resource', id: 'r' }],
		]);
	});
});

describe('parse order', () => {
	const plan = `${HEADER}\ntask a "A"\ninclude "x.tji"\ntask z "Z"\n`;
	const g = graphOf({ 'plan.tjp': plan, 'x.tji': 'task m "M"\n', 'orphan.tji': 'task o "O"\n' });
	const at = (file: string, from: number) => ({ file, from });

	it('places included text at its include site', () => {
		const inc = plan.indexOf('include');
		expect(parseOrderKey(g, at('x.tji', 5))).toEqual([inc, 5]);
		expect(parseOrderKey(g, at('plan.tjp', 7))).toEqual([7]);
		expect(parseOrderKey(g, at('orphan.tji', 0))).toBeNull();
		const a = at('plan.tjp', plan.indexOf('task a'));
		const m = at('x.tji', 0);
		const z = at('plan.tjp', plan.indexOf('task z'));
		const sorted = [z, m, at('orphan.tji', 0), a].sort((p, q) => compareParseOrder(g, p, q));
		expect(sorted).toEqual([a, m, z, at('orphan.tji', 0)]);
		expect(compareParseOrder(g, at('orphan.tji', 1), at('orphan.tji', 0))).toBeGreaterThan(0);
	});
});
