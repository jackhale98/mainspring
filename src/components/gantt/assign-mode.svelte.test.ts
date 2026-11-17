// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { AssignMode, RECENT_MAX } from './assign-mode.svelte';

describe('AssignMode', () => {
	it('begins with a person and ends on request, saying whether it was on', () => {
		const a = new AssignMode();
		expect(a.active).toBe(false);
		expect(a.end()).toBe(false);
		a.begin('dev2');
		expect(a.active).toBe(true);
		expect(a.person).toBe('dev2');
		expect(a.end()).toBe(true);
		expect(a.active).toBe(false);
	});
	it('switches person without ending', () => {
		const a = new AssignMode();
		a.begin('dev1');
		a.begin('dev2');
		expect(a.person).toBe('dev2');
	});
	it('keeps the newest people first, once each, and only the last few', () => {
		const a = new AssignMode();
		for (const id of ['a', 'b', 'c', 'd']) a.use(id);
		expect(a.recent).toEqual(['d', 'c', 'b']);
		expect(a.recent).toHaveLength(RECENT_MAX);
		a.use('c');
		expect(a.recent).toEqual(['c', 'd', 'b']);
	});
	it('counts the person it begins with as used', () => {
		const a = new AssignMode();
		a.begin('x');
		expect(a.recent).toEqual(['x']);
	});
});
