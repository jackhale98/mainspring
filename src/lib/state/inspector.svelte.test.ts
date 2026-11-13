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
