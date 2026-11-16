// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Generated plans for the id-follows-name properties (task-rename-id.property.test.ts and
 * task-rename-id.engine.test.ts): a few root tasks with automatic and other ids, a group with
 * children, dependencies between them (`!x` and absolute forms, from a later task to an earlier
 * one, so no loop), sometimes a supplement or a report naming a task, and a new name. The plan
 * knows by construction which tasks something refers to, so the tests can check `followingId`
 * against it rather than against the index.
 */
import fc from 'fast-check';

export const FIRST_NAME = 'New task';
export const HEAD = 'project p "P" 2026-01-05 +3m\n';

const ROOT_IDS = ['a', 'new_task', 'new_task_2', 'new_task_3', 'write_specs', 'review'] as const;
export const NAMES = [
	'Write specs',
	'Review',
	'New task',
	'Café au lait',
	'2nd pass',
	'a',
	'Write specs (v2)',
] as const;

export interface GenPlan {
	readonly text: string;
	/** Full ids in declaration order. */
	readonly ids: readonly string[];
	/** Full ids something in the plan refers to, or that have children. */
	readonly named: ReadonlySet<string>;
	/** Full ids an opaque statement (a report) names: their local ids count as taken for a slug. */
	readonly opaque: readonly string[];
	/** The task to rename and its new name. */
	readonly task: string;
	readonly name: string;
}

interface Dep {
	readonly from: number;
	readonly to: number;
	readonly absolute: boolean;
}

const parentOf = (id: string): string | null =>
	id.includes('.') ? id.slice(0, id.lastIndexOf('.')) : null;

/** `!x` between siblings, `!!x` from a child to a root task, else the absolute id. */
function refText(from: string, target: string, absolute: boolean): string {
	if (absolute) return target;
	const local = target.slice(target.lastIndexOf('.') + 1);
	if (parentOf(from) === parentOf(target)) return `!${local}`;
	if (parentOf(from) !== null && parentOf(target) === null) return `!!${target}`;
	return target;
}

export const genPlan: fc.Arbitrary<GenPlan> = fc
	.record({
		roots: fc.uniqueArray(fc.constantFrom(...ROOT_IDS), { minLength: 2, maxLength: 5 }),
		group: fc.boolean(),
		deps: fc.array(fc.record({ from: fc.nat(7), to: fc.nat(7), absolute: fc.boolean() }), {
			maxLength: 4,
		}),
		extra: fc.constantFrom('none', 'supplement', 'report'),
		extraOn: fc.nat(7),
		pick: fc.nat(7),
		name: fc.oneof(fc.constantFrom(...NAMES), fc.stringMatching(/^[A-Za-z][A-Za-z0-9 _'-]{0,11}$/)),
	})
	.map((g) => {
		const ids: string[] = [...g.roots];
		if (g.group) ids.push('g', 'g.new_task', 'g.c');
		const named = new Set<string>(g.group ? ['g'] : []);
		const leaves = ids.filter((id) => id !== 'g');
		const deps: Dep[] = g.deps
			.map((d) => ({ ...d, from: d.from % leaves.length, to: d.to % leaves.length }))
			.filter((d) => d.from > d.to);
		const depsOf = (id: string): string[] =>
			deps
				.filter((d) => leaves[d.from] === id)
				.map((d) => {
					const target = leaves[d.to] ?? '';
					named.add(target);
					return refText(id, target, d.absolute);
				});
		const block = (id: string, indent: string): string => {
			const local = id.split('.').pop() ?? id;
			const lines = [
				`duration ${(local.length % 3) + 1}d`,
				...depsOf(id).map((r) => `depends ${r}`),
			];
			const inner = lines.map((l) => `${indent}  ${l}\n`).join('');
			return `${indent}task ${local} "${local === 'g' ? 'G' : 'T'}" {\n${inner}${indent}}\n`;
		};
		let text = HEAD;
		for (const id of g.roots) text += block(id, '');
		if (g.group) text += 'task g "G" {\n' + block('g.new_task', '  ') + block('g.c', '  ') + '}\n';
		const target = leaves[g.extraOn % leaves.length] ?? 'a';
		if (g.extra === 'supplement') {
			text += `supplement task ${target} {\n  note "n"\n}\n`;
			named.add(target);
		} else if (g.extra === 'report') {
			text += `taskreport r "r" {\n  taskroot ${target}\n}\n`;
			named.add(target);
		}
		const opaque = g.extra === 'report' ? [target] : [];
		return { text, ids, named, opaque, task: leaves[g.pick % leaves.length] ?? 'a', name: g.name };
	});
