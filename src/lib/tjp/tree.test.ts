// SPDX-License-Identifier: GPL-2.0-or-later
import { Tree } from '@lezer/common';
import { describe, expect, it } from 'vitest';
import { parseTjp, textOf } from './document';
import {
	CoverageError,
	bodyOf,
	nodeText,
	printTree,
	someOwnLeaf,
	statementAt,
	statementHead,
	statementKeyword,
	statementsIn,
	syntaxIssues,
} from './tree';

const PLAN = `project p "P" 2026-01-05 +1m {
  timezone "UTC"
}
task a "A" {
  delayed:effort 2d
  depends !b { gaplength 1d }
}
`;

describe('printTree', () => {
	it('prints leaves and whitespace back to the input', () => {
		for (const text of [
			PLAN,
			'',
			'\r\n',
			'# only a comment\n',
			'task "x" {\r\n}\r\n',
			'task @@ {',
		]) {
			expect(printTree(parseTjp(text), text)).toBe(text);
		}
	});

	it('throws CoverageError when a gap holds non-whitespace', () => {
		const tree = parseTjp('task a "A"');
		expect(() => printTree(tree, 'task a "A" x')).toThrow(CoverageError);
		expect(() => printTree(Tree.empty, 'x')).toThrow(/non-whitespace gap at 0-1/);
	});
});

describe('syntaxIssues', () => {
	it('is empty for valid text and gives lines of error nodes', () => {
		expect(syntaxIssues(parseTjp(PLAN), textOf(PLAN))).toEqual([]);
		const bad = 'task a "A" {\n  effort 2d\n  @@\n}\n';
		const issues = syntaxIssues(parseTjp(bad), textOf(bad));
		expect(issues.length).toBeGreaterThan(0);
		expect(issues[0]?.line).toBe(3);
	});
});

describe('statement navigation', () => {
	const tree = parseTjp(PLAN);
	const top = statementsIn(tree.topNode);

	it('lists statements of the file and of bodies', () => {
		expect(top.map((s) => s.name)).toEqual(['ProjectStatement', 'TaskStatement']);
		const task = top[1];
		if (!task) throw new Error('no task');
		const body = bodyOf(task);
		expect(body).not.toBeNull();
		const inner = body ? statementsIn(body) : [];
		expect(inner.map((s) => s.name)).toEqual(['EffortStatement', 'DependsStatement']);
		const effort = inner[0];
		if (!effort) throw new Error('no effort');
		expect(statementHead(effort)?.name).toBe('Keyword');
		expect(statementKeyword(effort, PLAN)).toBe('effort');
		expect(nodeText(effort, PLAN)).toBe('delayed:effort 2d');
	});

	it('finds the innermost statement at a position', () => {
		const pos = PLAN.indexOf('gaplength') + 2;
		expect(statementAt(tree, pos)?.name).toBe('GaplengthStatement');
		expect(statementAt(tree, PLAN.indexOf('!b'))?.name).toBe('DependsStatement');
		expect(statementAt(tree, PLAN.length)).toBeNull();
	});

	it('visits own leaves only, skipping nested statements', () => {
		const deps = statementAt(tree, PLAN.indexOf('!b'));
		if (!deps) throw new Error('no depends');
		const seen: string[] = [];
		someOwnLeaf(deps, (l) => {
			seen.push(nodeText(l, PLAN));
			return false;
		});
		expect(seen).toEqual(['depends', '!', 'b', '{', '}']);
		expect(someOwnLeaf(deps, (l) => l.name === 'Bang')).toBe(true);
	});

	it('returns null keywords for macro heads', () => {
		const text = 'task a "A" {\n  ${m}\n}\n';
		const s = statementAt(parseTjp(text), text.indexOf('${m}'), 1);
		expect(s?.name).toBe('MacroCallStatement');
		if (s) expect(statementKeyword(s, text)).toBeNull();
	});
});
