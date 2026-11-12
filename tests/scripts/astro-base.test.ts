// SPDX-License-Identifier: GPL-2.0-or-later
// The site base path from MAINSPRING_BASE (ADR-0006).
import { describe, expect, it } from 'vitest';
import { resolveBase } from '../../scripts/astro-base.mjs';

describe('resolveBase', () => {
	it('is "/" when MAINSPRING_BASE is unset, empty or "/"', () => {
		expect(resolveBase({})).toBe('/');
		expect(resolveBase({ MAINSPRING_BASE: '' })).toBe('/');
		expect(resolveBase({ MAINSPRING_BASE: '  ' })).toBe('/');
		expect(resolveBase({ MAINSPRING_BASE: '/' })).toBe('/');
	});

	it('keeps a base with both slashes', () => {
		expect(resolveBase({ MAINSPRING_BASE: '/mainspring/' })).toBe('/mainspring/');
		expect(resolveBase({ MAINSPRING_BASE: '/a/b-c_d.e~f/' })).toBe('/a/b-c_d.e~f/');
	});

	it('adds a missing leading or trailing slash', () => {
		expect(resolveBase({ MAINSPRING_BASE: 'mainspring' })).toBe('/mainspring/');
		expect(resolveBase({ MAINSPRING_BASE: '/mainspring' })).toBe('/mainspring/');
		expect(resolveBase({ MAINSPRING_BASE: ' mainspring/ ' })).toBe('/mainspring/');
	});

	it('refuses anything that is not a plain path', () => {
		for (const bad of [
			'https://example.test/x/',
			'//cdn.example.test/',
			'/a//b/',
			'/../x/',
			'/./',
			'/a b/',
			'/x?y/',
			'/x#y/',
			'/%2e%2e/',
			'\\x\\',
		]) {
			expect(() => resolveBase({ MAINSPRING_BASE: bad }), bad).toThrow(/MAINSPRING_BASE/);
		}
	});
});
