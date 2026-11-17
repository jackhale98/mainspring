// SPDX-License-Identifier: GPL-2.0-or-later
// The health fixes on the real engine (phase-3.md section 12, 16.2): each fail fixture is
// scheduled, its finding's fix is applied through the edit API, and the edited plan is scheduled
// again. The check then passes, no error or fatal message is added, and nothing else is found.
// - H1 and H2 open the dependency picker. Their fail fixtures have no task left to pick (every
//   other task lies downstream, upstream), so the test adds the start (finish) milestone first,
//   then makes the `addDepends` the picker makes.
// - H4 and H6 have no edit fix ("Show in text", "Why here?").
// - H7 and H9's "Replace person…" is `replaceAllocation` to Ann, who is free then. H8's needs a
//   person free during Side's five days, and Ann works on Test in them, so a third person is added
//   first.
// - Property (fast-check): on generated chains with gaps of random kind and size and a random
//   threshold, every H5 finding's "Convert gap to task" applies, schedules without new errors,
//   leaves every original task where it was, and takes the finding away; "Edit gap" to the
//   threshold does too.
// Needs the built engine (npm run build:engine); skipped without it unless HEALTH_ENGINE=1.
import fs from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { check, edit, ENGINE, errorIds, fixtureFiles, type Checked } from './health-engine-testing';
import { only } from './testing';
import type { CheckId, Finding, Fix } from './types';

const REQUIRED = process.env['HEALTH_ENGINE'] === '1';
const TIMEOUT = 180_000;
const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };
const RUNS = Number(process.env['HEALTH_ENGINE_RUNS'] ?? 12);

type IntentFix = Extract<Fix, { kind: 'intent' }>;
const intents = (f: Finding | undefined): IntentFix[] =>
	(f?.fixes ?? []).filter((x): x is IntentFix => x.kind === 'intent');

/** The edited plan passes `check`, adds no error, and has no finding at all. */
function expectClean(before: Checked, after: Checked, check: CheckId): void {
	expect(after.report.counts[check]).toBe(0);
	expect(errorIds(after.result)).toEqual(errorIds(before.result));
	expect(after.report.findings).toEqual([]);
}

describe.skipIf(!REQUIRED && !fs.existsSync(ENGINE))('health fixes on the engine', () => {
	it(
		'H1: the start milestone, then "Add predecessor…" on build',
		async () => {
			const before = await check(fixtureFiles('h1-no-predecessor', 'fail'));
			const [f] = before.report.findings;
			expect(f?.fixes).toEqual([
				{ kind: 'pick', role: 'predecessor', task: 'build', disabled: null },
			]);
			const step = await check(
				edit(before, {
					type: 'addTask',
					parent: null,
					index: 0,
					name: 'Kickoff',
					attrs: [['milestone', true]],
				}),
			);
			const kick = [...step.index.tasks.values()].find((t) => t.name === 'Kickoff')?.id ?? '';
			const after = await check(edit(step, { type: 'addDepends', task: 'build', target: kick }));
			expectClean(before, after, 'no-predecessor');
		},
		TIMEOUT,
	);

	it(
		'H2: the finish milestone, then "Add successor…" on test',
		async () => {
			const before = await check(fixtureFiles('h2-no-successor', 'fail'));
			expect(before.report.findings[0]?.fixes).toEqual([
				{ kind: 'pick', role: 'successor', task: 'test', disabled: null },
			]);
			const step = await check(
				edit(before, {
					type: 'addTask',
					parent: null,
					index: 3,
					name: 'Done',
					attrs: [['milestone', true]],
				}),
			);
			const done = [...step.index.tasks.values()].find((t) => t.name === 'Done')?.id ?? '';
			// The picker's edit: `addDepends` on the picked task, naming the finding's task.
			const after = await check(edit(step, { type: 'addDepends', task: done, target: 'test' }));
			expectClean(before, after, 'no-successor');
		},
		TIMEOUT,
	);

	it(
		'H3: "Remove start"',
		async () => {
			const before = await check(fixtureFiles('h3-hard-constraint', 'fail'));
			const [fix] = intents(before.report.findings[0]);
			expect(fix?.intent).toEqual({ type: 'removeAttr', task: 'build', attr: 'start' });
			const after = await check(edit(before, fix?.intent ?? { type: 'format', file: '' }));
			expectClean(before, after, 'hard-constraint');
			// The date it held was the one the dependency gives: build stays where it was.
			const at = (c: Checked) => c.result.tasks.find((t) => t.id === 'build')?.scenarios['plan'];
			expect(at(after)?.start).toBe(at(before)?.start);
		},
		TIMEOUT,
	);

	it(
		'H4 and H6 have no edit fix',
		async () => {
			for (const dir of ['h4-constraint-warning', 'h6-long-task']) {
				const c = await check(fixtureFiles(dir, 'fail'));
				expect(intents(c.report.findings[0])).toEqual([]);
				expect(c.report.findings[0]?.fixes.some((x) => x.kind === 'show')).toBe(true);
			}
		},
		TIMEOUT,
	);

	it(
		'H5: "Convert gap to task" and "Edit gap"',
		async () => {
			const before = await check(fixtureFiles('h5-long-gap', 'fail'));
			const [toTask, editGap] = intents(before.report.findings[0]);
			expect(toTask?.intent.type).toBe('gapToTask');
			const converted = await check(edit(before, toTask?.intent ?? { type: 'format', file: '' }));
			expectClean(before, converted, 'long-gap');
			const at = (c: Checked) => c.result.tasks.find((t) => t.id === 'test')?.scenarios['plan'];
			expect(at(converted)?.start).toBe(at(before)?.start);
			// "Edit gap": the panel dispatches the intent with the value the user gives.
			expect(editGap?.intent.type).toBe('setDependsGap');
			if (editGap?.intent.type !== 'setDependsGap') return;
			const shorter = { ...editGap.intent, gap: { kind: 'gaplength' as const, value: '5d' } };
			expectClean(before, await check(edit(before, shorter)), 'long-gap');
		},
		TIMEOUT,
	);

	it.each([
		['h7-held-by-people', 'held-by-people', 'dev'],
		['h9-resource-warnings', 'resource-warning', 'leaver'],
	] as const)(
		'%s: "Replace person…" with Ann, who is free then',
		async (dir, id, from) => {
			const before = await check(fixtureFiles(dir, 'fail'));
			const fix = before.report.findings[0]?.fixes.find((x) => x.kind === 'replace-person');
			expect(fix).toEqual({ kind: 'replace-person', task: 'side', from, disabled: null });
			const after = await check(
				edit(before, { type: 'replaceAllocation', task: 'side', from, to: 'ann' }),
			);
			expectClean(before, after, id);
		},
		TIMEOUT,
	);

	it(
		'H8: "Replace person…" with a new person, Cy',
		async () => {
			const before = await check(fixtureFiles('h8-work-without-people', 'fail'));
			const fix = before.report.findings[0]?.fixes.find((x) => x.kind === 'replace-person');
			expect(fix).toEqual({ kind: 'replace-person', task: 'side', from: 'dev', disabled: null });
			// Ann works on Test from 01-08, inside Side's five days, so with her Side would still run
			// without its person (or hold Test): the replacement must be free, and the fixture has no
			// third person. The picker's list holds the plan's people; one is added first.
			const step = await check(
				edit(before, { type: 'addResource', parent: null, index: 2, id: 'cy', name: 'Cy' }),
			);
			const swapped = edit(step, {
				type: 'replaceAllocation',
				task: 'side',
				from: 'dev',
				to: 'cy',
			});
			expectClean(before, await check(swapped), 'work-without-people');
			// With Ann, H8 stays: the check is not fooled by a swap that changes nothing.
			const ann = await check(
				edit(before, { type: 'replaceAllocation', task: 'side', from: 'dev', to: 'ann' }),
			);
			expect(ann.report.counts['work-without-people']).toBe(1);
		},
		TIMEOUT,
	);

	it(
		'property: H5 fixes on generated chains',
		async () => {
			const gap = fc.record({
				kind: fc.constantFrom('gaplength', 'gapduration'),
				days: fc.integer({ min: 1, max: 12 }),
			});
			await fc.assert(
				fc.asyncProperty(
					fc.array(gap, { minLength: 1, maxLength: 4 }),
					fc.integer({ min: 2, max: 8 }),
					async (gaps, limit) => {
						const before = await check(chain(gaps), { ...only('long-gap'), longGapDays: limit });
						const long = gaps.filter((g) => g.days > limit).length;
						expect(before.report.counts['long-gap']).toBe(long);
						const [f] = before.report.findings;
						if (!f || f.subject.kind !== 'link') return;
						const [toTask, editGap] = intents(f);
						const settings = { ...only('long-gap'), longGapDays: limit };
						for (const intent of [
							toTask?.intent,
							editGap?.intent.type === 'setDependsGap'
								? {
										...editGap.intent,
										gap: { kind: editGap.intent.gap?.kind ?? 'gaplength', value: `${limit}d` },
									}
								: undefined,
						]) {
							if (!intent) continue;
							const after = await check(edit(before, intent), settings);
							expect(errorIds(after.result)).toEqual(errorIds(before.result));
							expect(after.report.counts['long-gap']).toBe(long - 1);
							if (intent.type !== 'gapToTask') continue;
							for (const t of before.result.tasks) {
								const a = after.result.tasks.find((x) => x.id === t.id)?.scenarios['plan'];
								const b = t.scenarios['plan'];
								expect([a?.start, a?.end]).toEqual([b?.start, b?.end]);
							}
						}
					},
				),
				{ numRuns: RUNS, ...SEED },
			);
		},
		TIMEOUT * 2,
	);
});

/** A chain t0 -> t1 -> ... with the given gaps, no resources (the dates are the gaps' alone). */
function chain(gaps: ReadonlyArray<{ kind: string; days: number }>): Record<string, string> {
	const lines = [
		'project p "P" 2026-01-05 - 2026-12-31 {',
		'}',
		'',
		'task t0 "T0" {',
		'  length 2d',
		'}',
	];
	gaps.forEach((g, i) => {
		lines.push(
			'',
			`task t${i + 1} "T${i + 1}" {`,
			`  depends t${i} { ${g.kind} ${g.days}d }`,
			'  length 2d',
			'}',
		);
	});
	return { 'plan.tjp': `${lines.join('\n')}\n` };
}
