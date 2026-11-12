// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createFile } from './document';
import { checkedStatements, statementValueError } from './diagnostics-values';
import { DEFAULT_CONTEXT, projectContext } from './values';

const TEXT = [
	'project p "P" 2026-01-05 +1m {',
	'  timingresolution 7min',
	'  dailyworkinghours 8',
	'}',
	'leaves holiday "H" 2026-01-06',
	'task a "A" {',
	'  start 2026-01-05-09:30',
	'  depends b { gapduration 2d }',
	'  priority ${p}',
	'}',
	'taskreport r "r" {',
	'  start 2001-01-01',
	'}',
	'',
].join('\n');
const file = createFile('plan.tjp', TEXT);
const slice = (s: { from: number; to: number }) => TEXT.slice(s.from, s.to);

describe('checkedStatements', () => {
	it('takes typed statements in property bodies, at file level and the project resolution', () => {
		expect(checkedStatements(file).map(slice)).toEqual([
			'timingresolution 7min',
			'dailyworkinghours 8',
			'leaves holiday "H" 2026-01-06',
			'start 2026-01-05-09:30',
			'gapduration 2d',
			'priority ${p}',
		]);
	});
});

describe('statementValueError', () => {
	const errors = (ctx = DEFAULT_CONTEXT) =>
		checkedStatements(file).map((s) => {
			const e = statementValueError(file, s, ctx);
			return e && [e.code, slice(e)];
		});

	it('reports parse and check errors at the value and skips macro values', () => {
		expect(errors()).toEqual([
			['number-range', '7min'],
			null,
			null,
			['misaligned-date', '2026-01-05-09:30'],
			null,
			null,
		]);
	});

	it('follows the context it is given', () => {
		const fine = projectContext({ granularity: 1800 });
		expect(errors(fine)[3]).toBeNull();
	});
});
