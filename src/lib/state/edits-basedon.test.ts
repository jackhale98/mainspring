// SPDX-License-Identifier: GPL-2.0-or-later
// The dispatcher's `basedOn` interface (ADR-0018, T27a): a call is stamped with the published index
// version unless it names its own, and the two outcomes that ask before a call is made again carry
// it back. `dispatchPlan` is declared but not implemented until T27b. The checks themselves are
// T27b's (edits-rebase.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditIntent } from '../tjp/edit/types';
import { harness, manipulationHarness, type Harness } from './edits-testing';

const SHARED = {
	entry: 'plan.tjp',
	files: {
		'plan.tjp':
			'project p "P" 2026-01-05 +1m\ntask g1 "G1"\ntask g2 "G2"\n' +
			'include "t.tji" { taskprefix g1 }\ninclude "t.tji" { taskprefix g2 }\n',
		't.tji': 'task t "T" {\n  effort 1d\n}\n',
	},
};
const effort: EditIntent = {
	type: 'setAttr',
	task: 'g1.t',
	attr: 'effort',
	value: '2d',
};
const label = { label: { text: 'E', approx: false } };

let h: Harness;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
	h.dispose();
	vi.useRealTimers();
});

describe('basedOn', () => {
	it('stamps a call with the published index version, which may lag the text', async () => {
		h = harness(SHARED);
		await h.finish();
		const shown = h.runner.state.indexVersion;
		expect(shown).toBe(h.ws.snapshot().version);
		expect(await h.edits.dispatch(effort, label)).toMatchObject({
			status: 'confirm-shared',
			basedOn: shown,
		});
		// Typing moves the text; the index catches up only in the runner's idle tasks.
		h.type('# note\n');
		expect(h.runner.state.indexVersion).toBe(shown);
		expect(h.ws.snapshot().version).toBeGreaterThan(shown);
		expect(await h.edits.dispatch(effort, label)).toMatchObject({
			status: 'confirm-shared',
			basedOn: shown,
		});
	});

	it("keeps the call's own basedOn, for a call made again after an answer", async () => {
		h = harness(SHARED);
		await h.finish();
		const o = await h.edits.dispatch(effort, { ...label, basedOn: 0 });
		expect(o).toMatchObject({ status: 'confirm-shared', basedOn: 0 });
	});

	it('carries it on the move question', async () => {
		const m = await manipulationHarness();
		h = m.h;
		const move = { type: 'move', task: 'spike', days: 1 } as const;
		const shown = h.runner.state.indexVersion;
		expect(await h.edits.dispatchAction(move, m.source)).toEqual({
			status: 'ask-move-preference',
			suggested: 'start',
			basedOn: shown,
		});
		expect(await h.edits.dispatchAction(move, m.source, { basedOn: 0 })).toMatchObject({
			basedOn: 0,
		});
	});

	it('declares dispatchPlan, which T27b implements', () => {
		h = harness(SHARED);
		expect(() => h.edits.dispatchPlan(() => ({ status: 'unchanged' }))).toThrow(/T27b/);
	});
});
