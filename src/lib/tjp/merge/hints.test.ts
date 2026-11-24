// SPDX-License-Identifier: GPL-2.0-or-later
// Statement keys, blocks and owners (hints.ts).
import type { SyntaxNode } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import { parseTjp } from '../document';
import { statementsIn } from '../tree';
import { attrName, blockKind, Naming, statementKey } from './hints';
import { contextOf } from './testing';

/** Every statement of `text`, depth first, with its key. */
function keys(text: string): Array<[string, string | null]> {
	const out: Array<[string, string | null]> = [];
	const walk = (n: SyntaxNode): void => {
		for (const s of statementsIn(n)) {
			out.push([s.name, statementKey(s, text)]);
			const body = s.getChild('Body');
			if (body) walk(body);
		}
	};
	walk(parseTjp(text).topNode);
	return out;
}

describe('statementKey', () => {
	it('keys statements by keyword with its scenario prefix, and declarations by id', () => {
		const text =
			'project p "P" 2027-01-01 +1m {\n  scenario plan "Plan"\n}\n' +
			'macro m [ x ]\ninclude "a.tji"\naccount cost "Cost"\n' +
			'supplement task a.b { delayed:effort 2d }\n' +
			'task a "A" {\n  effort 3d\n  delayed:effort 4d\n  ${m}\n}\ntask "Anonymous"\n';
		expect(keys(text)).toEqual([
			['ProjectStatement', 'project'],
			['OpaqueStatement', 'scenario:plan'],
			['MacroStatement', 'macro:m'],
			['IncludeStatement', 'include:"a.tji"'],
			['OpaqueStatement', 'account:cost'],
			['SupplementStatement', 'supplement:task:a.b'],
			['EffortStatement', 'delayed:effort'],
			['TaskStatement', 'task:a'],
			['EffortStatement', 'effort'],
			['EffortStatement', 'delayed:effort'],
			['MacroCallStatement', null],
			['TaskStatement', 'task#"Anonymous"#0'],
		]);
	});

	it('names blocks and attributes', () => {
		const tree = parseTjp('task a "A" { delayed:effort 1d }\nresource r "R"\nflags x\n');
		const [t, r, f] = statementsIn(tree.topNode) as [SyntaxNode, SyntaxNode, SyntaxNode];
		expect([blockKind(t), blockKind(r), blockKind(f)]).toEqual(['task', 'resource', null]);
		const effort = t.getChild('Body')?.getChild('EffortStatement') as SyntaxNode;
		expect(attrName(effort, 'task a "A" { delayed:effort 1d }\n')).toBe('delayed:effort');
	});
});

describe('Naming', () => {
	/** The statement at `path` (indices of statements, through bodies). */
	const nth = (tree: ReturnType<typeof parseTjp>, path: number[]): SyntaxNode => {
		let n: SyntaxNode = tree.topNode;
		for (const i of path) {
			const parent: SyntaxNode = n.name.endsWith('Statement')
				? (n.getChild('Body') as SyntaxNode)
				: n;
			n = statementsIn(parent)[i] as SyntaxNode;
		}
		return n;
	};

	it('gives full ids, names as written and other for non-blocks', () => {
		const t =
			'task a "A" {\n  task b \'B b\' {\n    task ${x} "X"\n  }\n}\nsupplement task a.b {\n  task c "C"\n}\n';
		const tree = parseTjp(t);
		const n = new Naming('plan.tjp', contextOf('plan.tjp', { 'plan.tjp': t }).includes);
		expect(n.owner(nth(tree, [0, 0]), t)).toEqual({ kind: 'task', id: 'a.b', name: 'B b' });
		expect(n.owner(nth(tree, [0, 0, 0]), t)).toEqual({ kind: 'task', id: null, name: 'X' });
		expect(n.owner(nth(tree, [1]), t)).toEqual({ kind: 'task', id: 'a.b', name: null });
		expect(n.owner(nth(tree, [1, 0]), t)).toEqual({ kind: 'task', id: 'a.b.c', name: 'C' });
		expect(n.owner(null, t)).toEqual({ kind: 'other', id: null, name: null });
	});

	it('prefixes task ids with the include site’s prefix, null when it is a macro; resource ids are global', () => {
		const files = {
			'plan.tjp':
				'project p "P" 2027-01-01 +1m\ntask top "Top"\nresource team "Team"\n' +
				'include "a.tji" { taskprefix top resourceprefix team }\n' +
				'include "m.tji" { taskprefix ${pre} }\n',
			'a.tji': 'task t "T"\nresource r "R"\n',
			'm.tji': 'task u "U"\n',
		};
		const inc = contextOf('plan.tjp', files).includes;
		const a = parseTjp(files['a.tji']);
		const [t, r] = statementsIn(a.topNode) as [SyntaxNode, SyntaxNode];
		const na = new Naming('a.tji', inc);
		expect(na.owner(t, files['a.tji']).id).toBe('top.t');
		expect(na.owner(r, files['a.tji']).id).toBe('r');
		const m = parseTjp(files['m.tji']);
		expect(
			new Naming('m.tji', inc).owner(statementsIn(m.topNode)[0] ?? null, files['m.tji']).id,
		).toBeNull();
	});
});
