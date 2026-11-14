// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { InspectorState } from './inspector.svelte';

describe('InspectorState', () => {
	it('opens the sheet on a tap and moves the focus in on Enter', () => {
		const s = new InspectorState();
		s.show();
		expect(s.sheet).toBe(true);
		expect(s.focusNonce).toBe(0);
		s.collapsed = true;
		s.focus();
		expect(s).toMatchObject({ sheet: true, collapsed: false, focusNonce: 1, explicit: true });
	});

	describe('tap', () => {
		it('opens the sheet at once where a first tap does not only select (desktop)', () => {
			const s = new InspectorState();
			expect(s.tap(false)).toBe(true);
			expect(s.sheet).toBe(true);
		});

		it('selects only on a first tap, and opens on a tap on the selected task', () => {
			const s = new InspectorState();
			s.secondTapOpens = true;
			expect(s.tap(false)).toBe(false);
			expect(s.sheet).toBe(false);
			expect(s.tap(true)).toBe(true);
			expect(s.sheet).toBe(true);
		});

		it('keeps an open sheet open when another task is tapped', () => {
			const s = new InspectorState();
			s.secondTapOpens = true;
			s.show();
			expect(s.tap(false)).toBe(true);
			expect(s.sheet).toBe(true);
		});

		it('selects only again once the sheet is dismissed and another task is tapped', () => {
			const s = new InspectorState();
			s.secondTapOpens = true;
			s.show();
			s.hide();
			expect(s.tap(false)).toBe(false);
		});
	});

	it('forgets the height when the sheet closes', () => {
		const s = new InspectorState();
		s.show();
		s.detent = 'full';
		s.sheetHeight = 500;
		s.hide();
		expect(s).toMatchObject({ sheet: false, detent: 'half', sheetHeight: 0, explicit: false });
	});

	it('selects a link and clears it again; a new plan clears everything', () => {
		const s = new InspectorState();
		s.showLink('a', 'b');
		expect(s.link).toEqual({ pred: 'a', succ: 'b' });
		expect(s.sheet).toBe(true);
		s.clearLink();
		expect(s.link).toBeNull();
		s.showLink('a', 'b');
		s.projectOpen = true;
		s.source = 'a';
		s.reset();
		expect(s).toMatchObject({ link: null, projectOpen: false, source: null, sheet: false });
	});
});
