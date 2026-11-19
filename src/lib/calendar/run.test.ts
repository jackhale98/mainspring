// SPDX-License-Identifier: GPL-2.0-or-later
// The Calendar's way into the dispatcher (run.ts): a stroke planned and sent, a refusal of the
// planner shown with its place, a text-only leave in the day's own words, and the confirmation for
// a declaration read in several places.
import { describe, expect, it, vi } from 'vitest';
import type { DispatchOptions, DispatchOutcome } from '../state/edits.svelte';
import type { EditIntent } from '../tjp/edit/types';
import type { SourceRange } from '../tjp/index';
import { plan as resultOf } from '../schedule/testing';
import { planFrom, workloadPlan } from '../workload/rebalance-testing';
import { resourceResult, withPeople } from '../workload/testing';
import { ctxOf, day, onePerson, paint, person } from './paint-testing';
import { runIntent, runStroke, type LeaveEdits } from './run';

const applied = { status: 'applied' } as unknown as DispatchOutcome;

function edits(outcomes: DispatchOutcome[] = [applied]): LeaveEdits & {
	sent: Array<{ intent: EditIntent; o: DispatchOptions }>;
	refused: Array<{ message: string; at: readonly SourceRange[]; version: number }>;
} {
	const sent: Array<{ intent: EditIntent; o: DispatchOptions }> = [];
	const refused: Array<{ message: string; at: readonly SourceRange[]; version: number }> = [];
	let n = 0;
	return {
		sent,
		refused,
		dispatch: async (intent, o) => {
			sent.push({ intent, o });
			return outcomes[Math.min(n++, outcomes.length - 1)] as DispatchOutcome;
		},
		refuse: (message, at, version) => void refused.push({ message, at, version }),
	};
}

describe('runStroke', () => {
	const p = workloadPlan('leave-types');

	it('plans a paint and sends its intent with its label', async () => {
		const e = edits();
		const r = await runStroke(
			e,
			paint(person('p1'), day(14), day(16), 'sick'),
			ctxOf(p),
			() => true,
		);
		expect(r.status).toBe('sent');
		expect(e.sent).toHaveLength(1);
		expect(e.sent[0]?.intent).toMatchObject({ type: 'addLeave', leave: { type: 'sick' } });
		expect(e.sent[0]?.o.label.text).toMatch(/^Sick leave for P1: /);
		expect(e.refused).toEqual([]);
	});

	it('shows the planner’s refusal as a toast with its place, and sends nothing', async () => {
		const e = edits();
		// P2 already has annual leave on the 8th and 9th: a paint of annual there is covered.
		const r = await runStroke(
			e,
			paint(person('p2'), day(3), day(5), 'annual'),
			ctxOf(p),
			() => true,
		);
		expect(r.status).toBe('refused');
		expect(r.status === 'refused' && r.message).toMatch(/already covers those days/);
		expect(e.sent).toEqual([]);
		expect(e.refused).toHaveLength(1);
		expect(e.refused[0]?.version).toBe(ctxOf(p).index.version);
		expect(e.refused[0]?.at).toHaveLength(1);
	});

	it('says an erase of a macro or shift leave in the day’s own words', async () => {
		// `annual ${when}` is written with a macro: the engine has the leave, no text item names it.
		const base = onePerson('leaves annual ${when}', 'macro when [2026-01-08 - 2026-01-10]\n');
		const result = withPeople(
			resultOf([['t', { start: 540, end: 2460 }]]),
			[
				resourceResult('dev', {
					leaves: [{ type: 'annual', intervals: [[3 * 1440 + 540, 3 * 1440 + 1020]] }],
				}),
			],
			[],
		);
		const q = planFrom({ 'plan.tjp': base.text('plan.tjp') }, 'plan.tjp', result);
		const e = edits();
		const r = await runStroke(
			e,
			{ type: 'erase', scope: person('dev'), from: day(3), to: day(4) },
			ctxOf(q),
			() => true,
		);
		expect(r).toEqual({ status: 'refused', message: 'From a shift or macro. Edit as text.' });
		expect(e.sent).toEqual([]);
		expect(e.refused[0]?.message).toBe('From a shift or macro. Edit as text.');
	});

	it('sends an erase of a person’s own text leave', async () => {
		const e = edits();
		const r = await runStroke(
			e,
			{ type: 'erase', scope: person('p2'), from: day(3), to: day(4) },
			ctxOf(p),
			() => true,
		);
		expect(r.status).toBe('sent');
		expect(e.sent[0]?.intent).toMatchObject({
			type: 'clearLeave',
			scope: { kind: 'resource', resource: 'p2' },
		});
	});

	it('is unavailable without a dispatcher or a context', async () => {
		expect(
			await runStroke(null, paint(person('p1'), 0, 1440, 'sick'), ctxOf(p), () => true),
		).toEqual({
			status: 'unavailable',
			message: '',
		});
		expect(
			await runStroke(edits(), paint(person('p1'), 0, 1440, 'sick'), null, () => true),
		).toEqual({
			status: 'unavailable',
			message: '',
		});
	});
});

describe('runIntent', () => {
	const intent: EditIntent = {
		type: 'removeLeave',
		leave: { item: { file: 'a.tji', from: 1, to: 2 }, basedOn: 1 },
	};
	const label = { text: 'x', approx: false };
	const shared = {
		status: 'confirm-shared',
		affects: ['a.tjp', 'b.tjp'],
		basedOn: 1,
	} as DispatchOutcome;

	it('asks once for a shared declaration, then sends it again confirmed', async () => {
		const e = edits([shared, applied]);
		const confirm = vi.fn((_m: string) => true);
		const o = await runIntent(e, intent, label, confirm);
		expect(o.status).toBe('applied');
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(confirm.mock.calls[0]?.[0]).toContain('a.tjp, b.tjp');
		expect(e.sent.map((s) => s.o.confirmShared)).toEqual([false, true]);
	});

	it('is cancelled when the user declines', async () => {
		const e = edits([shared, applied]);
		const o = await runIntent(e, intent, label, () => false);
		expect(o).toEqual({ status: 'cancelled' });
		expect(e.sent).toHaveLength(1);
	});

	it('gives the dispatcher’s own refusal back as it is', async () => {
		const refused = {
			status: 'refused',
			reason: 'text-only',
			at: [],
			message: 'm',
		} as DispatchOutcome;
		const o = await runIntent(edits([refused]), intent, label, () => true);
		expect(o).toBe(refused);
	});
});
