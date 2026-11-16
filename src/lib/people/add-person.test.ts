// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import type { DispatchOutcome } from '../state/edits.svelte';
import type { TjpEdit } from '../tjp/edit/types';
import { strings } from '../strings';
import {
	addPersonFlow,
	addPersonSpot,
	headerOfEdit,
	newResourceIdFromHeader,
	type AddPersonEnv,
} from './add-person';

describe('addPersonSpot', () => {
	it('is the end of the top level, counting resolved top-level resources only', () => {
		expect(addPersonSpot([])).toEqual({ parent: null, index: 0 });
		expect(
			addPersonSpot([
				{ id: 'team', level: 1 },
				{ id: 'team.dev', level: 2 },
				{ id: null, level: 1 },
				{ id: 'ops', level: 1 },
			]),
		).toEqual({ parent: null, index: 2 });
	});
});

describe('newResourceIdFromHeader', () => {
	it('reads the id the edit API gave the person', () => {
		expect(newResourceIdFromHeader('resource new_person "New person"')).toBe('new_person');
		expect(newResourceIdFromHeader('resource r2 "R"')).toBe('r2');
		expect(newResourceIdFromHeader('task a "A"')).toBeNull();
		expect(newResourceIdFromHeader('resource')).toBeNull();
	});
});

describe('headerOfEdit', () => {
	const doc = { sliceString: (from: number, to: number) => 'resource r "R"\ntask'.slice(from, to) };
	const app = {
		workspace: {
			snapshot: () => ({ files: new Map([['plan.tjp', { text: doc }]]) }),
		},
	} as never;

	it('reads the text the edit selected, now', () => {
		const edit = { select: { file: 'plan.tjp', from: 0, to: 14 } } as unknown as TjpEdit;
		expect(headerOfEdit(app, edit)).toBe('resource r "R"');
	});

	it('is null without a selection, a workspace or the file', () => {
		expect(headerOfEdit(app, {} as TjpEdit)).toBeNull();
		const at = { select: { file: 'other.tjp', from: 0, to: 3 } } as unknown as TjpEdit;
		expect(headerOfEdit(app, at)).toBeNull();
		expect(headerOfEdit({ workspace: null }, at)).toBeNull();
	});
});

describe('addPersonFlow', () => {
	const edit = {} as TjpEdit;
	const applied = { status: 'applied', edit } as unknown as DispatchOutcome;
	const outcome = (status: string): Promise<DispatchOutcome> =>
		Promise.resolve({ status } as unknown as DispatchOutcome);

	function env(over: Partial<AddPersonEnv> = {}) {
		const plan = {};
		const select = vi.fn();
		const dispatch = vi.fn(() => Promise.resolve(applied));
		const e: AddPersonEnv = {
			plan: () => plan,
			resources: () => [],
			dispatch,
			headerOf: () => 'resource new_person "New person"',
			select,
			...over,
		};
		return { e, select, dispatch };
	}

	it('dispatches addResource at the end of the top level, then selects the new person', async () => {
		const { e, select, dispatch } = env({ resources: () => [{ id: 'dev', level: 1 }] });
		expect(await addPersonFlow(e)).toBe('new_person');
		const name = strings.people.none.newPerson;
		expect(dispatch).toHaveBeenCalledWith(
			{ type: 'addResource', parent: null, index: 1, name },
			{ label: { text: strings.people.none.label(name), approx: false } },
		);
		expect(select).toHaveBeenCalledWith('new_person');
	});

	it('selects nobody when the edit is refused, a no-op or not a header', async () => {
		for (const status of ['refused', 'noop', 'cancelled']) {
			const { e, select } = env({ dispatch: () => outcome(status) });
			expect(await addPersonFlow(e)).toBeNull();
			expect(select).not.toHaveBeenCalled();
		}
		const odd = env({ headerOf: () => null });
		expect(await addPersonFlow(odd.e)).toBeNull();
		expect(odd.select).not.toHaveBeenCalled();
	});

	it('gives up when no plan is open, or the plan changed while the edit was on its way', async () => {
		const none = env({ plan: () => null });
		expect(await addPersonFlow(none.e)).toBeNull();
		expect(none.dispatch).not.toHaveBeenCalled();
		let now: unknown = {};
		const moved = env({
			plan: () => now,
			dispatch: () => {
				now = {};
				return Promise.resolve(applied);
			},
		});
		expect(await addPersonFlow(moved.e)).toBeNull();
		expect(moved.select).not.toHaveBeenCalled();
	});
});
