// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { TjpDiagnostic } from '../tjp/diagnostics';
import { locatedProblems, nextProblem } from './diagnostics-nav';

const FILES = ['plan.tjp', 'lib/a.tji'];

function diag(file: string | null, from: number, over: Partial<TjpDiagnostic> = {}): TjpDiagnostic {
	return {
		file,
		from,
		to: from + 1,
		severity: 'error',
		source: 'engine',
		messageId: 'm',
		message: `m${from}`,
		hint: null,
		scenario: null,
		precision: 'token',
		line: 1,
		column: 1,
		revision: 1,
		stale: false,
		...over,
	};
}

const LIST = [
	diag('lib/a.tji', 5),
	diag('plan.tjp', 30),
	diag('plan.tjp', 10, { severity: 'warning' }),
	diag('plan.tjp', 20, { severity: 'info' }),
	diag('plan.tjp', 0, { precision: 'none' }),
	diag(null, 0),
	diag('gone.tji', 1),
];

describe('locatedProblems', () => {
	it('keeps errors and warnings with a place, by file order and position', () => {
		expect(locatedProblems(LIST, FILES).map((d) => `${d.file}:${d.from}`)).toEqual([
			'plan.tjp:10',
			'plan.tjp:30',
			'lib/a.tji:5',
		]);
	});
});

describe('nextProblem', () => {
	it('goes to the first problem after the cursor in the same file', () => {
		expect(nextProblem(LIST, FILES, { file: 'plan.tjp', pos: 0 })?.from).toBe(10);
		expect(nextProblem(LIST, FILES, { file: 'plan.tjp', pos: 10 })?.from).toBe(30);
	});

	it('moves on to the next file, then wraps to the first problem', () => {
		expect(nextProblem(LIST, FILES, { file: 'plan.tjp', pos: 30 })).toMatchObject({
			file: 'lib/a.tji',
			from: 5,
		});
		expect(nextProblem(LIST, FILES, { file: 'lib/a.tji', pos: 5 })).toMatchObject({
			file: 'plan.tjp',
			from: 10,
		});
	});

	it('is null when no problem has a place', () => {
		expect(nextProblem([diag(null, 0)], FILES, { file: 'plan.tjp', pos: 0 })).toBeNull();
		expect(nextProblem([], FILES, { file: 'plan.tjp', pos: 0 })).toBeNull();
	});
});
