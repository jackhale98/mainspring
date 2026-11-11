// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { engineLine, engineStatusLabels, strings } from './strings';

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
});
