// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseTjp, type TopContext } from '../tjp/document';
import {
	buildIncludeGraph,
	compareParseOrder,
	contextConflicts,
	parseOrderKey,
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
			['plan.tjp', 'macros.tji', 'macros.tji', 'prolog', null],
			['macros.tji', 'more-macros.tji', 'more-macros.tji', 'prolog', null],
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

	it('walks a file included twice once, in its first context, and lists the conflict', () => {
		const g = graphOf({
			'plan.tjp': `${HEADER} {\n  include "x.tji"\n}\ninclude "x.tji"\n`,
			'x.tji': 'timezone "UTC"\n',
		});
		expect(g.edges.map((e) => [e.target, e.top])).toEqual([
			['x.tji', 'project'],
			['x.tji', 'global'],
		]);
		expect(g.tops.get('x.tji')).toBe('project');
		expect(g.parsed).toEqual([
			['plan.tjp', 'global'],
			['x.tji', 'project'],
		]);
		expect(contextConflicts(g).map((e) => e.top)).toEqual(['global']);
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
