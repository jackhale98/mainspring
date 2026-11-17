// SPDX-License-Identifier: GPL-2.0-or-later
// The dependency picker's candidates (depends-picker.ts): who is offered, who is disabled and why,
// how a query narrows the list, and the arrow keys' stepping over the disabled ones.
import { describe, expect, it } from 'vitest';
import { buildOutline } from '../state/outline';
import { buildIndex } from '../tjp/index';
import { inline } from '../tjp/index/testing';
import {
	dependsCandidates,
	filterCandidates,
	fold,
	linkAction,
	stepEnabled,
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

describe('stepEnabled', () => {
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

	it('goes down and up over the enabled options, wrapping round', () => {
		const list = mk([null, 'linked', null, null]);
		expect(stepEnabled(list, 0, 1)).toBe(2);
		expect(stepEnabled(list, 3, 1)).toBe(0);
		expect(stepEnabled(list, 0, -1)).toBe(3);
		expect(stepEnabled(list, 2, -1)).toBe(0);
	});

	it('starts at the first (Down) or the last (Up) when nothing is active', () => {
		const list = mk(['linked', null, null, 'ancestor']);
		expect(stepEnabled(list, -1, 1)).toBe(1);
		expect(stepEnabled(list, -1, -1)).toBe(2);
	});

	it('steps off a disabled option, and says -1 when none is enabled', () => {
		expect(stepEnabled(mk([null, 'linked', null]), 1, 1)).toBe(2);
		expect(stepEnabled(mk(['linked', 'ancestor']), -1, 1)).toBe(-1);
		expect(stepEnabled([], -1, 1)).toBe(-1);
	});
});

describe('linkAction', () => {
	it('makes the chosen task the predecessor, or the successor', () => {
		expect(linkAction('predecessor', 'b', 'a')).toEqual({ type: 'link', pred: 'a', succ: 'b' });
		expect(linkAction('successor', 'b', 'c')).toEqual({ type: 'link', pred: 'b', succ: 'c' });
	});
});
