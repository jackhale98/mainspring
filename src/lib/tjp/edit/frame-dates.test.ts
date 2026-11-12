// SPDX-License-Identifier: GPL-2.0-or-later
// Untyped dates against a narrowed frame (frame-dates.ts), through `setProjectHeader`. Found by
// the settings engine check (seed 42): narrowing the Tutorial's frame past a `journalentry` date
// gave date_in_range in TaskJuggler.
import { describe, expect, it } from 'vitest';
import { applyIntent } from './apply';
import { setup } from './testing';
import type { EditIntent, EditResult } from './types';

const PLAN =
	'project p "P" 2026-01-05 - 2026-03-27\nresource a "A"\n' +
	'task t "T" {\n  effort 2d\n  allocate a\n  journalentry 2026-03-02 "Late" { author a }\n}\n';

function run(text: string, intent: EditIntent): { r: EditResult; text: string } {
	const s = setup(text);
	return { r: applyIntent(s.snap, s.index, intent), text };
}

const status = (r: EditResult): string =>
	r.status === 'edit' ? 'edit' : `${r.status}:${r.reason}`;

describe('setProjectHeader and untyped dates', () => {
	it('refuses an end that leaves a journal entry date out of the frame', () => {
		const { r, text } = run(PLAN, { type: 'setProjectHeader', end: '2026-02-20' });
		expect(status(r)).toBe('refused:invalid-value');
		expect(r.status === 'refused' && r.at.map((a) => text.slice(a.from, a.to))).toEqual([
			'2026-03-02',
		]);
		expect(status(run(PLAN, { type: 'setProjectHeader', end: '2026-03-20' }).r)).toBe('edit');
	});

	it('checks only the side of the frame that shrinks', () => {
		const early = PLAN.replace('2026-03-02', '2026-01-06');
		expect(status(run(early, { type: 'setProjectHeader', end: '2026-02-20' }).r)).toBe('edit');
		expect(status(run(early, { type: 'setProjectHeader', start: '2026-01-12' }).r)).toBe(
			'refused:invalid-value',
		);
		// Growing the frame never refuses.
		expect(
			status(run(PLAN, { type: 'setProjectHeader', start: '2026-01-01', end: '2026-04-30' }).r),
		).toBe('edit');
	});

	it('counts dates in macro bodies, not in comments', () => {
		const macro = PLAN.replace('2026-03-02', '2026-01-20') + 'macro m [ 2026-03-10 ]\n';
		expect(status(run(macro, { type: 'setProjectHeader', end: '2026-02-20' }).r)).toBe(
			'refused:invalid-value',
		);
		const comment = PLAN.replace('2026-03-02', '2026-01-20') + '# 2026-03-10\n';
		expect(status(run(comment, { type: 'setProjectHeader', end: '2026-02-20' }).r)).toBe('edit');
	});
});
