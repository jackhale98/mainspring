// SPDX-License-Identifier: GPL-2.0-or-later
// Phase 3 selection and view types (phase-3.md 6.7): compile checks (`npm run typecheck` enforces
// them). T13 widened `Selection` to the Phase 2 kinds plus `PeopleSelection`.
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PaintScope } from '../calendar/paint';
import type { BucketKind } from '../workload/types';
import type { PeopleSegment, PeopleSelection, Selection, View } from './selection.svelte';

describe('Phase 3 selection types (6.7)', () => {
	it('has the Phase 2 kinds and the People kinds in `Selection`', () => {
		expectTypeOf<NonNullable<Selection>['kind']>().toEqualTypeOf<
			'task' | 'link' | 'resource' | 'cell' | 'days'
		>();
		expectTypeOf<PeopleSelection>().toExtend<NonNullable<Selection>>();
	});

	it('has the People kinds of 6.7', () => {
		expectTypeOf<PeopleSelection['kind']>().toEqualTypeOf<'resource' | 'cell' | 'days'>();
		expectTypeOf<Extract<PeopleSelection, { kind: 'cell' }>['axis']>().toEqualTypeOf<BucketKind>();
		expectTypeOf<Extract<PeopleSelection, { kind: 'days' }>['scope']>().toEqualTypeOf<PaintScope>();
	});

	it('names the views and the phone People segments (18.10)', () => {
		expectTypeOf<View>().toEqualTypeOf<'gantt' | 'workload' | 'resources' | 'calendar'>();
		expectTypeOf<PeopleSegment>().toEqualTypeOf<'load' | 'lanes' | 'calendar' | 'team'>();
		const picks: PeopleSelection[] = [
			{ kind: 'resource', id: 'dev1', origin: 'visual' },
			{ kind: 'cell', resource: 'dev1', bucket: 3, axis: 'week' },
			{ kind: 'days', scope: { kind: 'global' }, from: 0, to: 1440 },
		];
		expect(picks.map((p) => p.kind)).toEqual(['resource', 'cell', 'days']);
	});
});
