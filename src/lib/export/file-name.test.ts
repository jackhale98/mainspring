// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { exportFileName } from './file-name';

describe('exportFileName', () => {
	it('joins the plan name and what the file is', () => {
		expect(exportFileName('Mainspring', 'tasks.csv')).toBe('Mainspring-tasks.csv');
		expect(exportFileName('UI basic', 'gantt.png')).toBe('UI-basic-gantt.png');
	});

	it('turns each run of characters a file system dislikes into one hyphen', () => {
		expect(exportFileName('Q3: plan / "draft"?', 'tasks.csv')).toBe('Q3-plan-draft-tasks.csv');
		expect(exportFileName('a\tb\nc', 'tasks.csv')).toBe('a-b-c-tasks.csv');
	});

	it('keeps letters and digits of any script, dots and underscores', () => {
		expect(exportFileName('Überprüfung 日本語_v1.2', 'tasks.csv')).toBe(
			'Überprüfung-日本語_v1.2-tasks.csv',
		);
	});

	it('does not start or end with a hyphen or a dot', () => {
		expect(exportFileName('  .Plan.  ', 'tasks.csv')).toBe('Plan-tasks.csv');
	});

	it('is called plan when nothing of the name is left', () => {
		expect(exportFileName('', 'tasks.csv')).toBe('plan-tasks.csv');
		expect(exportFileName('***', 'gantt.png')).toBe('plan-gantt.png');
	});
});
