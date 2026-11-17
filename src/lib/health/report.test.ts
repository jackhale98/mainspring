// SPDX-License-Identifier: GPL-2.0-or-later
// checkPlan (report.ts): findings in check order and task order, counts for every check, the
// switches, a result without a project, and the availability fallback.
import { describe, expect, it } from 'vitest';
import { analyse } from '../schedule/critical';
import { at, dep, plan } from '../schedule/testing';
import { workingTimeFromPairs } from '../schedule/working-time';
import { checkPlan } from './report';
import { goldenInput, inlineInput, only } from './testing';
import { CHECK_IDS, DEFAULT_HEALTH_SETTINGS } from './types';

const TEXT =
	'project p "P" 2026-01-05 - 2026-03-02 {\n}\ntask a "A" {\n  start 2026-01-05\n}\ntask b "B" {\n  depends a { gaplength 9d }\n}\ntask c "C" {\n}\n';
const RESULT = plan([
	['a', { start: at(0, 9), end: at(0, 17) }],
	['b', { start: at(14, 9), end: at(14, 17), depends: [dep('a', { gapLengthMin: 9 * 480 })] }],
	['c', { start: at(0, 9), end: at(0, 17) }],
]);

describe('checkPlan', () => {
	it('orders findings by check, then by task, and counts every check', () => {
		const r = checkPlan(inlineInput(RESULT, TEXT));
		expect(
			r.findings.map((f) => [f.check, f.subject.kind === 'task' ? f.subject.id : f.subject.kind]),
		).toEqual([
			['no-predecessor', 'a'],
			['no-predecessor', 'c'],
			['no-successor', 'b'],
			['no-successor', 'c'],
			['hard-constraint', 'a'],
			['long-gap', 'link'],
		]);
		expect(Object.keys(r.counts)).toEqual([...CHECK_IDS]);
		expect(r.counts).toMatchObject({
			'no-predecessor': 2,
			'no-successor': 2,
			'hard-constraint': 1,
			'long-gap': 1,
			'held-by-people': 0,
		});
		expect(r.revision).toBe(RESULT.revision);
	});

	it('runs only the checks that are on', () => {
		const r = checkPlan(inlineInput(RESULT, TEXT, only('long-gap', 'hard-constraint')));
		expect(r.findings.map((f) => f.check)).toEqual(['hard-constraint', 'long-gap']);
		expect(r.counts['no-predecessor']).toBe(0);
		const none = { ...DEFAULT_HEALTH_SETTINGS, enabled: only().enabled };
		expect(checkPlan(inlineInput(RESULT, TEXT, none)).findings).toEqual([]);
	});

	it('gives an empty report for a result without a project', () => {
		const input = inlineInput(RESULT, TEXT);
		const r = checkPlan({ ...input, result: { ...RESULT, project: null, revision: 7 } });
		expect(r).toEqual({
			revision: 7,
			findings: [],
			counts: Object.fromEntries(CHECK_IDS.map((c) => [c, 0])),
		});
	});

	it('builds the availability itself when it is not given, to the same report', () => {
		const i = goldenInput('health-h8-fail');
		const { availability: _, ...rest } = i;
		expect(checkPlan(rest)).toEqual(checkPlan(i));
	});

	it('reads the analysis’s scenario', () => {
		const scenarios = [
			{ id: 'plan', name: 'Plan', parent: null, active: true },
			{ id: 'alt', name: 'Alt', parent: 'plan', active: true },
		];
		const r = plan(
			[
				['a', { start: at(0, 9), end: at(0, 17), scenarios: { alt: { depends: [dep('c')] } } }],
				['c', { start: at(0, 9), end: at(0, 17), scenarios: { alt: {} } }],
			],
			{ scenarios },
		);
		const text = 'project p "P" 2026-01-05 - 2026-03-02 {\n}\ntask a "A" {\n}\ntask c "C" {\n}\n';
		const input = inlineInput(r, text, only('no-predecessor'));
		const wt = workingTimeFromPairs(r.project?.workingTime ?? [], {
			resolution: 60,
			frameEnd: 56 * 1440,
		});
		const alt = { ...input, analysis: analyse(r, 'alt', wt) };
		expect(checkPlan(input).findings.map((f) => f.subject)).toEqual([
			{ kind: 'task', id: 'a' },
			{ kind: 'task', id: 'c' },
		]);
		expect(checkPlan(alt).findings.map((f) => f.subject)).toEqual([{ kind: 'task', id: 'c' }]);
	});
});
