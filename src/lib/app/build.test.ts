// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { BUILD, buildLabel } from './build';

describe('build', () => {
	it('is "dev" outside a production build', () => {
		expect(BUILD.id).toBe('dev');
		expect(buildLabel(BUILD)).toBe('dev');
	});

	it('labels a build with its commit and time', () => {
		const label = buildLabel(
			{ id: '3f2a91bc-202611131402', builtAt: '2026-11-13T14:02:00Z' },
			'en',
		);
		expect(label.startsWith('3f2a91bc · ')).toBe(true);
		expect(label).toContain('2026');
	});
});
