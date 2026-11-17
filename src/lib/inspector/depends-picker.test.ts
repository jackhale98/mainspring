// SPDX-License-Identifier: GPL-2.0-or-later
// The dependency picker's candidates (depends-picker.ts): who is offered, who is disabled and why,
// how a query narrows the list, and the arrow keys' stepping over the disabled ones.
import { describe, expect, it } from 'vitest';
import { buildOutline } from '../state/outline';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import { dependsBlocks } from './depends-blocks';
import {
	dependsCandidates,
	filterCandidates,
	fold,
	linkAction,
	firstEnabled,
	stepOption,
	type Candidate,
} from './depends-picker';

const PLAN = `project p "P" 2026-01-05 +30d
task app "App" {
  task ui "UI" { effort 2d }
  task api "API" {
    task auth "Auth" { effort 1d }
    task store "Storage" { effort 1d }
  }
}
task docs "Docs" { effort 1d }
task ops "Opérations" {
  task docs "Docs" { effort 2d }
}
`;

function outlineOf(text: string) {
	const snap = inline({ 'plan.tjp': text }, 'plan.tjp').snapshot();
	return buildOutline(buildIndex(snap));
}

const states = (cs: readonly Candidate[]): Array<[string, string | null]> =>
	cs.map((c) => [c.id, c.disabled]);

describe('dependsCandidates', () => {
	const outline = outlineOf(PLAN);

	it('lists the other tasks in declaration order, never the task itself', () => {
		const ids = dependsCandidates(outline, 'app.ui', new Set()).map((c) => c.id);
		expect(ids).toEqual([
			'app',
			'app.api',
			'app.api.auth',
			'app.api.store',
			'docs',
			'ops',
			'ops.docs',
		]);
	});

	it('shows the outline path, so duplicate names can be told apart', () => {
		const cs = dependsCandidates(outline, 'app.ui', new Set());
		const byId = new Map(cs.map((c) => [c.id, c]));
		expect(byId.get('docs')).toMatchObject({ name: 'Docs', path: '' });
		expect(byId.get('ops.docs')).toMatchObject({ name: 'Docs', path: 'Opérations' });
		expect(byId.get('app.api.auth')?.path).toBe('App › API');
	});

	it('disables the containers of the task, the tasks inside it, and the already linked', () => {
		const cs = dependsCandidates(outline, 'app.api', new Set(['docs']));
		expect(states(cs)).toEqual([
			['app', 'ancestor'],
			['app.ui', null],
			['app.api.auth', 'descendant'],
			['app.api.store', 'descendant'],
			['docs', 'linked'],
			['ops', null],
			['ops.docs', null],
		]);
	});

	it('lets an ancestor or descendant reason win over "linked"', () => {
		const cs = dependsCandidates(outline, 'app.ui', new Set(['app', 'docs']));
		expect(cs.find((c) => c.id === 'app')?.disabled).toBe('ancestor');
		expect(cs.find((c) => c.id === 'docs')?.disabled).toBe('linked');
	});

	it('takes the reasons only the text can give from `blocked`, after the others', () => {
		const cs = dependsCandidates(outline, 'app.ui', new Set(['docs']), (id) =>
			id === 'docs' || id === 'ops' ? 'inherited' : null,
		);
		expect(cs.find((c) => c.id === 'docs')?.disabled).toBe('linked');
		expect(cs.find((c) => c.id === 'ops')?.disabled).toBe('inherited');
		expect(cs.find((c) => c.id === 'app.api')?.disabled).toBeNull();
	});

	it('names a task without a name by its local id', () => {
		const cs = dependsCandidates(
			outlineOf('project p "P" 2026-01-05 +5d\ntask a\ntask b\n'),
			'a',
			new Set(),
		);
		expect(cs.map((c) => c.name)).toEqual(['b']);
	});
});

describe('filterCandidates', () => {
	const all = dependsCandidates(outlineOf(PLAN), 'app.ui', new Set());
	const ids = (q: string): string[] => filterCandidates(all, q).map((c) => c.id);

	it('keeps everything for an empty query', () => {
		expect(ids('')).toHaveLength(all.length);
		expect(ids('   ')).toHaveLength(all.length);
	});

	it('matches by name, id and path, ignoring case and accents', () => {
		expect(ids('STORAGE')).toEqual(['app.api.store']);
		expect(ids('app.api.auth')).toEqual(['app.api.auth']);
		expect(ids('operations')).toEqual(['ops', 'ops.docs']);
	});

	it('needs every word, in any order', () => {
		expect(ids('docs operations')).toEqual(['ops.docs']);
		expect(ids('api auth')).toEqual(['app.api.auth']);
		expect(ids('zzz')).toEqual([]);
	});

	it('puts names that start with the query ahead of the rest, keeping the plan order', () => {
		// "ap" starts the names App and API; Auth and Storage only have it in their path.
		expect(ids('ap')).toEqual(['app', 'app.api', 'app.api.auth', 'app.api.store']);
		expect(ids('doc')).toEqual(['docs', 'ops.docs']);
	});

	it('folds accents and case', () => {
		expect(fold('Opérations')).toBe('operations');
	});
});

describe('stepOption and firstEnabled', () => {
	const mk = (disabled: Array<Candidate['disabled']>): Candidate[] =>
		disabled.map((d, i) => ({
			id: `t${i}`,
			name: `T${i}`,
			path: '',
			disabled: d,
			foldedName: `t${i}`,
			foldedId: `t${i}`,
			foldedPath: '',
		}));

	it('visits every option, disabled ones included, wrapping round', () => {
		const list = mk([null, 'linked', null, null]);
		expect(stepOption(list, 0, 1)).toBe(1);
		expect(stepOption(list, 3, 1)).toBe(0);
		expect(stepOption(list, 0, -1)).toBe(3);
		expect(stepOption(list, 2, -1)).toBe(1);
	});

	it('starts at the first (Down) or the last (Up) when nothing is active; -1 for none', () => {
		const list = mk(['linked', null, null, 'ancestor']);
		expect(stepOption(list, -1, 1)).toBe(0);
		expect(stepOption(list, -1, -1)).toBe(3);
		expect(stepOption([], -1, 1)).toBe(-1);
	});

	it('finds the first option that can be chosen', () => {
		expect(firstEnabled(mk(['linked', null, null]))).toBe(1);
		expect(firstEnabled(mk(['linked', 'ancestor']))).toBe(-1);
		expect(firstEnabled([])).toBe(-1);
	});
});

describe('dependsBlocks: what only the text tells', () => {
	const TEXT = `project p "P" 2026-01-05 +30d
macro writes [ depends design.other ]
task design "Design" {
  task gate "Gate" { effort 1d }
  task other "Other" { effort 1d }
}
task build "Build" {
  depends design.gate
  task code "Code" { effort 1d }
  task tests "Tests" { effort 1d }
}
task grp "Group" {
  precedes late.x
  task leaf "Leaf" { effort 1d }
}
task late "Late" {
  task x "X" { effort 1d }
}
task mac "Mac" {
  \${writes}
  effort 1d
}
`;
	const snap = inline({ 'plan.tjp': TEXT }, 'plan.tjp').snapshot();
	const index = buildIndex(snap);
	const blocks = (task: string, role: 'predecessor' | 'successor') =>
		dependsBlocks(snap, index, task, role);

	it('marks a link that a container already makes, from either end', () => {
		// Build waits for the gate, so every task in Build does, and the gate is followed by them.
		expect(blocks('build.code', 'predecessor')('design.gate')).toBe('inherited');
		expect(blocks('build.code', 'predecessor')('design.other')).toBeNull();
		expect(blocks('design.gate', 'successor')('build.tests')).toBe('inherited');
		expect(blocks('design.gate', 'successor')('design.other')).toBeNull();
		// Group precedes Late.X, so Leaf does.
		expect(blocks('grp.leaf', 'successor')('late.x')).toBe('inherited');
		expect(blocks('late.x', 'predecessor')('grp.leaf')).toBe('inherited');
		expect(blocks('grp.leaf', 'successor')('design.other')).toBeNull();
	});

	it('marks a task whose body macro may write the list the link goes in', () => {
		// Mac's body macro writes `depends`: Mac cannot be the successor.
		expect(blocks('mac', 'predecessor')('design.other')).toBe('macro-in-body');
		expect(blocks('design.other', 'successor')('mac')).toBe('macro-in-body');
		// As the predecessor only `precedes` matters, which the macro does not write.
		expect(blocks('mac', 'successor')('design.other')).toBeNull();
		expect(blocks('design.other', 'predecessor')('mac')).toBeNull();
	});
});

describe('linkAction', () => {
	it('makes the chosen task the predecessor, or the successor', () => {
		expect(linkAction('predecessor', 'b', 'a')).toEqual({ type: 'link', pred: 'a', succ: 'b' });
		expect(linkAction('successor', 'b', 'c')).toEqual({ type: 'link', pred: 'b', succ: 'c' });
	});
});
