// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultMode, effectiveMode, modeFromParam, phoneTabFor } from './view-mode';

describe('view mode', () => {
	it('defaults to Split on desktop and the Gantt on tablets and phones', () => {
		expect(defaultMode('desktop')).toBe('split');
		expect(defaultMode('tablet')).toBe('visual');
		expect(defaultMode('phone')).toBe('visual');
	});

	it('reads a mode from a link, and nothing else', () => {
		expect(modeFromParam('text')).toBe('text');
		expect(modeFromParam('split')).toBe('split');
		expect(modeFromParam('visual')).toBe('visual');
		// The old name still works.
		expect(modeFromParam('gantt')).toBe('visual');
		expect(modeFromParam('other')).toBeNull();
		expect(modeFromParam(null)).toBeNull();
	});

	it('uses the choice over the default, and has no Split on a phone', () => {
		expect(effectiveMode(null, 'desktop')).toBe('split');
		expect(effectiveMode('text', 'desktop')).toBe('text');
		expect(effectiveMode('split', 'tablet')).toBe('split');
		expect(effectiveMode('split', 'phone')).toBe('visual');
		expect(effectiveMode('text', 'phone')).toBe('text');
	});

	it('starts a phone on the tab of its mode', () => {
		expect(phoneTabFor('text')).toBe('text');
		expect(phoneTabFor('visual')).toBe('gantt');
		expect(phoneTabFor(null)).toBe('gantt');
	});
});
