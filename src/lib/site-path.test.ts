// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { sitePath } from './site-path';

describe('sitePath', () => {
	it('defaults to the build base, "/" in tests', () => {
		expect(sitePath('app')).toBe('/app');
	});

	it('prefixes a project base path', () => {
		expect(sitePath('app', '/mainspring/')).toBe('/mainspring/app');
		expect(sitePath('fonts/NOTICES.txt', '/mainspring/')).toBe('/mainspring/fonts/NOTICES.txt');
	});

	it('joins with exactly one slash', () => {
		expect(sitePath('/app', '/mainspring/')).toBe('/mainspring/app');
		expect(sitePath('app', '/mainspring')).toBe('/mainspring/app');
		expect(sitePath('//app', '/')).toBe('/app');
	});

	it('gives the base itself for an empty path', () => {
		expect(sitePath('', '/mainspring/')).toBe('/mainspring/');
		expect(sitePath('', '/')).toBe('/');
	});
});
