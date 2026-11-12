// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildIndex } from './index';
import { inline } from './testing';
import type { EngineHints } from './types';

const P = 'project p "P" 2026-01-05 +2m\n';
const build = (files: Record<string, string>, hints?: EngineHints) =>
	buildIndex(inline(files).snapshot(), hints, { cache: null });
const ids = (files: Record<string, string>, hints?: EngineHints) => [
	...build(files, hints).tasks.keys(),
];

describe('task ids and parents', () => {
	it('builds full ids from nesting, roots in order', () => {
		const idx = build({
			'plan.tjp': `${P}task a "A" {\n  task b "B" {\n    task c "C"\n  }\n}\ntask d "D"\n`,
		});
		expect([...idx.tasks.keys()]).toEqual(['a', 'a.b', 'a.b.c', 'd']);
		expect(idx.taskRoots).toEqual(['a', 'd']);
		expect(idx.tasks.get('a.b')?.parent).toBe('a');
		expect(idx.tasks.get('a.b')?.localId).toBe('b');
		expect(idx.tasks.get('a')?.children).toEqual(['a.b']);
	});

	it('marks duplicates unresolved and keeps the first', () => {
		const idx = build({ 'plan.tjp': `${P}task a "A"\ntask a "Again"\n` });
		expect(idx.tasks.get('a')?.name).toBe('A');
		expect(idx.unresolved.map((u) => u.reason)).toEqual(['duplicate']);
	});

	it('leaves auto ids unresolved, and takes them from hints', () => {
		const files = { 'plan.tjp': `${P}task "Auto" {\n  task x "X"\n}\n` };
		const idx = build(files);
		expect(idx.unresolved.map((u) => u.reason)).toEqual(['auto-id', 'unknown-parent']);
		const hints: EngineHints = {
			tasks: [
				{ id: '_Task_1', parent: null, file: 'plan.tjp', line: 2 },
				{ id: '_Task_1.x', parent: '_Task_1', file: 'plan.tjp', line: 3 },
			],
			resources: [],
		};
		expect(ids(files, hints)).toEqual(['_Task_1', '_Task_1.x']);
		expect(build(files, hints).tasks.get('_Task_1.x')?.idSource).toBe('text');
	});

	it('does not match a line with several candidates', () => {
		const files = { 'plan.tjp': `${P}macro m [x]\ntask \${m}1 "A" task \${m}2 "B"\n` };
		const hints: EngineHints = {
			tasks: [
				{ id: 'x1', parent: null, file: 'plan.tjp', line: 3 },
				{ id: 'x2', parent: null, file: 'plan.tjp', line: 3 },
			],
			resources: [],
		};
		const idx = build(files, hints);
		expect([...idx.tasks.keys()]).toEqual([]);
		expect(idx.unresolved.map((u) => u.candidates)).toEqual([2, 2]);
	});

	it('ignores a hint whose parent disagrees with the text (stale)', () => {
		const files = { 'plan.tjp': `${P}macro m [x]\ntask a "A" {\n  task \${m} "M"\n}\n` };
		const hints: EngineHints = {
			tasks: [{ id: 'x', parent: null, file: 'plan.tjp', line: 4 }],
			resources: [],
		};
		expect(ids(files, hints)).toEqual(['a']);
	});
});

describe('@property across include visits (TjpSyntaxRules.rb 6113-6117, 5910)', () => {
	it('parents later top-level tasks of a prefixed file to the prefix', () => {
		const files = {
			'plan.tjp': `${P}task g "G"\ninclude "t.tji" { taskprefix g }\ntask z "Z"\n`,
			't.tji': 'task a "A"\ntask b "B"\n',
		};
		expect(ids(files)).toEqual(['g', 'g.a', 'g.b', 'z']);
	});

	it('flags a resource @property reaching a task as a conflict', () => {
		const files = {
			'plan.tjp': `${P}resource r "R"\ntask g "G"\ninclude "t.tji" { resourceprefix r }\n`,
			't.tji': 'resource x "X"\ntask a "A"\n',
		};
		const idx = build(files);
		expect(idx.resources.get('x')?.parent).toBe('r');
		expect(idx.unresolved.map((u) => u.reason)).toEqual(['property-conflict']);
	});

	it('does not read includes before the project header (include_before_project)', () => {
		const files = { 'plan.tjp': `include "m.tji"\n${P}task a "A"\n`, 'm.tji': 'macro x [1]\n' };
		const idx = build(files);
		expect(idx.macros.size).toBe(0);
		expect(idx.visits).toHaveLength(2);
	});

	it('makes ids below a macro prefix unknown until hints name them', () => {
		const files = {
			'plan.tjp': `${P}macro pre [g]\ntask g "G"\ninclude "t.tji" { taskprefix \${pre} }\n`,
			't.tji': 'task a "A" {\n  task b "B"\n}\n',
		};
		const idx = build(files);
		expect([...idx.tasks.keys()]).toEqual(['g']);
		expect(idx.unresolved.map((u) => u.reason)).toEqual(['unknown-parent', 'unknown-parent']);
		const hints: EngineHints = {
			tasks: [
				{ id: 'g', parent: null, file: 'plan.tjp', line: 3 },
				{ id: 'g.a', parent: 'g', file: 't.tji', line: 1 },
				{ id: 'g.a.b', parent: 'g.a', file: 't.tji', line: 2 },
			],
			resources: [],
		};
		expect(ids(files, hints)).toEqual(['g', 'g.a', 'g.a.b']);
	});
	it('keeps task ids known under a macro resource prefix, and resources below it parentless', () => {
		const files = {
			'plan.tjp': `${P}macro pre [r]\nresource r "R"\ninclude "t.tji" { resourceprefix \${pre} }\n`,
			't.tji': 'task a "A"\nresource x "X"\n',
		};
		const idx = build(files);
		expect([...idx.tasks.keys()]).toEqual(['a']);
		expect(idx.resources.get('x')?.parent).toBeNull();
		expect(idx.visits[1]?.resourcePrefix).toEqual({ kind: 'unknown' });
		expect(idx.visits[1]?.taskPrefix).toEqual({ kind: 'none' });
	});
});

describe('supplements', () => {
	it('resolves the target under a task @property, else under the prefix', () => {
		const files = {
			'plan.tjp': `${P}task a "A" {\n  task b "B"\n  supplement task b { note "n" }\n}\nsupplement task a.b { priority 1 }\n`,
		};
		const idx = build(files);
		const b = idx.tasks.get('a.b');
		expect(b?.supplements).toHaveLength(2);
		expect(b?.attrs.map((s) => s.keyword)).toEqual(['note', 'priority']);
	});

	it('lists an unknown target as an unresolved reference and indexes nothing below it', () => {
		const idx = build({ 'plan.tjp': `${P}supplement task nope { task c "C" }\n` });
		expect(idx.references.find((r) => r.via === 'supplement')?.target).toBeNull();
		expect(idx.unresolved.map((u) => u.reason)).toEqual(['unknown-parent']);
	});
});

describe('X5 expanded-only declarations', () => {
	const files = {
		'plan.tjp': `${P}macro mk [ task \${1} "\${1}" ]\ntask a "A" {\n  \${mk "x"}\n  task y "Y"\n}\n`,
	};
	const hints: EngineHints = {
		tasks: [
			{ id: 'a', parent: null, file: 'plan.tjp', line: 3 },
			{ id: 'a.x', parent: 'a', file: 'plan.tjp', line: 4 },
			{ id: 'a.y', parent: 'a', file: 'plan.tjp', line: 5 },
		],
		resources: [],
	};

	it('indexes them at the call site, in reading order, entirely text-only', () => {
		const idx = build(files, hints);
		expect([...idx.tasks.keys()]).toEqual(['a', 'a.x', 'a.y']);
		const x = idx.tasks.get('a.x');
		expect(x?.expandedOnly).toBe(true);
		expect(x?.textOnly?.reason).toBe('expanded-only');
		const text = files['plan.tjp'];
		expect(text.slice(x?.decl.block.from, x?.decl.block.to)).toBe('${mk "x"}');
		expect(idx.blocking('plan.tjp', x?.decl.block.from ?? 0, x?.decl.block.to ?? 0)?.reason).toBe(
			'expanded-only',
		);
	});

	it('marks a call that may declare something as blocking its block (no within)', () => {
		const idx = build(files);
		const a = idx.tasks.get('a');
		expect(a?.bodyMacroCalls).toHaveLength(1);
		expect(idx.blocking('plan.tjp', a?.decl.block.from ?? 0, a?.decl.block.to ?? 0)?.reason).toBe(
			'macro-call',
		);
	});

	it('treats a call of a once-defined, non-declaring macro as safe', () => {
		const safe = build({
			'plan.tjp': `${P}macro al [ allocate r ]\nresource r "R"\ntask a "A" {\n  \${al}\n  effort 1d\n}\n`,
		});
		const a = safe.tasks.get('a');
		expect(safe.blocking('plan.tjp', a?.decl.block.from ?? 0, a?.decl.block.to ?? 0)).toBeNull();
	});
});

describe('references', () => {
	it('resolves dependencies, allocations, responsible, managers and flags', () => {
		const idx = build({
			'plan.tjp': `${P}flags hot\nresource boss "B"\nresource r "R" { managers boss }\ntask a "A" {\n  task b "B" { depends !c precedes a.c }\n  task c "C" { allocate r responsible boss flags hot, cold }\n}\n`,
		});
		expect(idx.dependencies.map((d) => [d.form, d.pred, d.succ])).toEqual([
			['depends', 'a.c', 'a.b'],
			['precedes', 'a.b', 'a.c'],
		]);
		expect(idx.allocations.map((a) => [a.task, a.resource])).toEqual([['a.c', 'r']]);
		const byVia = (v: string) => idx.references.filter((r) => r.via === v).map((r) => r.target);
		expect(byVia('managers')).toEqual(['boss']);
		expect(byVia('responsible')).toEqual(['boss']);
		expect(byVia('flags')).toEqual(['hot', null]);
		expect([...idx.flags.keys()]).toEqual(['hot']);
		expect(idx.globalFlags).toHaveLength(1);
	});

	it('gives a too-many-bangs or unknown target null', () => {
		const idx = build({ 'plan.tjp': `${P}task a "A" { depends !!!x, nope }\n` });
		expect(idx.dependencies.map((d) => d.pred)).toEqual([null, null]);
		expect(idx.dependencies.map((d) => d.succ)).toEqual(['a', 'a']);
	});

	it('records custom attribute declarations and uses', () => {
		const idx = build({
			'plan.tjp': `project p "P" 2026-01-05 +2m {\n  extend task { text Phone "Phone" { inherit } }\n}\ntask a "A" { Phone "1" Other "2" }\n`,
		});
		expect(idx.customAttributes.map((c) => [c.scope, c.type, c.id, c.name, c.inherit])).toEqual([
			['task', 'text', 'Phone', 'Phone', true],
		]);
		expect(idx.customAttributeUses.map((u) => [u.name, u.declared, u.owner])).toEqual([
			['Phone', true, 'a'],
			['Other', false, 'a'],
		]);
	});
});
