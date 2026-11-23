// SPDX-License-Identifier: GPL-2.0-or-later
// The oracle of the small-plan specs (small-plan.ts) says what the specs pin: the counts of the
// small plan's report, the milestone setting, and the explainer's sentences for the tasks the specs
// open. Needs the built engine (npm run build:engine); skipped without it unless
// UI_FIXTURES_ENGINE=1, like the small plans' own engine test.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { withLinkMilestones } from '../../../src/lib/health/settings';
import { DEFAULT_HEALTH_SETTINGS } from '../../../src/lib/health/types';
import { explainTask } from '../../../src/lib/schedule/explain-task';
import { whyText } from '../../../src/lib/health/why-text';
import { REPO } from '../../golden/corpus';
import { reportOfText, smallContext, smallReport } from './small-plan';

const ENGINE = path.join(REPO, 'public/engine/manifest.json');
const REQUIRED = process.env['UI_FIXTURES_ENGINE'] === '1';

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('the small-plan oracle', () => {
	it('ui-basic has nine findings in four checks, three of them notes', async () => {
		const r = await smallReport('ui-basic');
		expect(r.findings).toHaveLength(9);
		expect(r.findings.filter((f) => f.severity === 'info')).toHaveLength(3);
		expect(Object.fromEntries(Object.entries(r.counts).filter(([, n]) => n > 0))).toEqual({
			'no-predecessor': 2,
			'no-successor': 2,
			'hard-constraint': 3,
			'held-by-people': 2,
		});
	}, 120_000);

	it('a milestone in the middle is reported in H1 and H2 only with the setting on', async () => {
		const plan = `project p "P" 2026-01-05 - 2026-03-27 {
}
resource dev "Dev"
task a "A" {
  effort 3d
  allocate dev
}
task mid "Midpoint" {
  milestone
  start 2026-01-08-09:00
}
task z "Z" {
  depends a
  effort 10d
  allocate dev
}
`;
		const off = await reportOfText(plan);
		const on = await reportOfText(plan, withLinkMilestones(DEFAULT_HEALTH_SETTINGS, true));
		expect(on.counts['no-predecessor']).toBe(off.counts['no-predecessor'] + 1);
		expect(on.counts['no-successor']).toBe(off.counts['no-successor'] + 1);
	}, 120_000);

	it('the explainer gives the sentences the specs read for the small plans', async () => {
		const text = async (plan: 'ui-basic' | 'ui-people', id: string) => {
			const ctx = await smallContext(plan);
			const w = whyText(explainTask(id, ctx), ctx, 'en-US');
			return [...w.causes, ...w.inside].map((l) => l.text);
		};
		expect(await text('ui-basic', 'design.sketch')).toEqual([
			'Waits for Research (ends Thu, Mar 5), then a gap.',
		]);
		expect(await text('ui-basic', 'launch')).toEqual([
			'“start May 4, 2026” is written on this task (a constraint).',
		]);
		const core = await text('ui-people', 'build.core');
		expect(core.at(-1)).toBe('The schedule does not show why.');
	}, 120_000);
});
