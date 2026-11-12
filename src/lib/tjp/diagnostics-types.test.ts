// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { severityOf } from './diagnostics-types';

describe('severityOf', () => {
	it('maps fatal and error to error and drops debug', () => {
		const levels = ['fatal', 'error', 'warning', 'info', 'debug'] as const;
		expect(levels.map((l) => severityOf(l))).toEqual(['error', 'error', 'warning', 'info', null]);
	});
});
