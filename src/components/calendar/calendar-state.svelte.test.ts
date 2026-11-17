// SPDX-License-Identifier: GPL-2.0-or-later
// What the Calendar remembers (calendar-state.svelte.ts): the scope with the type it can paint, and
// the same-scope rule the shared selection uses.
import { describe, expect, it } from 'vitest';
import { CalendarState, sameScope } from './calendar-state.svelte';

describe('CalendarState', () => {
	it('starts on Everyone, painting a holiday, with no month chosen', () => {
		const s = new CalendarState();
		expect(s.mode).toBe('select');
		expect(s.scope).toEqual({ kind: 'global' });
		expect(s.leaveType).toBe('holiday');
		expect(s.month).toBe(-1);
		expect(s.focus).toBeNull();
	});

	it('moves to a person and takes annual leave as the type, a holiday not being theirs to paint', () => {
		const s = new CalendarState();
		s.setScope({ kind: 'resource', resource: 'dev1' });
		expect(s.scope).toEqual({ kind: 'resource', resource: 'dev1' });
		expect(s.leaveType).toBe('annual');
	});

	it('keeps a type the new scope offers', () => {
		const s = new CalendarState();
		s.setScope({ kind: 'resource', resource: 'dev1' });
		s.leaveType = 'sick';
		s.setScope({ kind: 'resource', resource: 'dev2' });
		expect(s.leaveType).toBe('sick');
		s.setScope({ kind: 'global' });
		expect(s.leaveType).toBe('holiday');
	});
});

describe('sameScope', () => {
	it('compares Everyone and a person by id', () => {
		expect(sameScope({ kind: 'global' }, { kind: 'global' })).toBe(true);
		expect(
			sameScope({ kind: 'resource', resource: 'a' }, { kind: 'resource', resource: 'a' }),
		).toBe(true);
		expect(
			sameScope({ kind: 'resource', resource: 'a' }, { kind: 'resource', resource: 'b' }),
		).toBe(false);
		expect(sameScope({ kind: 'global' }, { kind: 'resource', resource: 'a' })).toBe(false);
		expect(sameScope({ kind: 'resource', resource: 'a' }, { kind: 'global' })).toBe(false);
	});
});
