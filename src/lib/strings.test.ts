// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
	engineFailureStrings,
	engineLine,
	engineStatusLabels,
	refusalStrings,
	strings,
	textOnlyStrings,
} from './strings';

describe('strings', () => {
	it('names the app', () => {
		expect(strings.appName).toBe('Mainspring');
	});

	it('has a label for every engine status', () => {
		expect(Object.keys(engineStatusLabels).sort()).toEqual(['booting', 'busy', 'failed', 'idle']);
		for (const label of Object.values(engineStatusLabels)) {
			expect(label.length).toBeGreaterThan(0);
		}
	});

	it('builds the engine line, with and without a status', () => {
		expect(engineLine()).toBe('Engine: not connected yet');
		expect(engineLine('booting')).toBe('Engine: Starting the scheduler');
		expect(engineLine('idle')).toBe('Engine: Ready');
		expect(engineLine('busy')).toBe('Engine: Scheduling');
		expect(engineLine('failed')).toBe('Engine: Failed');
	});

	it('has a capitalised sentence for each refusal reason, failure kind and text-only reason', () => {
		expect(Object.keys(refusalStrings)).toHaveLength(16);
		for (const text of [
			...Object.values(refusalStrings),
			...Object.values(engineFailureStrings),
			...Object.values(textOnlyStrings),
		]) {
			expect(text).toMatch(/^[A-Z].*\.$/);
		}
	});

	it('counts problems in plain words', () => {
		expect(strings.status.counts(0, 0)).toBe('No problems');
		expect(strings.status.counts(1, 0)).toBe('1 error');
		expect(strings.status.counts(2, 1)).toBe('2 errors, 1 warning');
		expect(strings.outline.errors(3)).toBe('3 errors');
	});
});
