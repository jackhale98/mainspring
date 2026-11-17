// SPDX-License-Identifier: GPL-2.0-or-later
// What the panel shows of a report (panel-model.ts): grouping by check in check order, the severity
// filter, counts per severity, a finding's key across two results (so "2 new problems" counts only
// what is new), and the person of a finding.
import { describe, expect, it } from 'vitest';
import { checkPlan } from './report';
import { goldenInput } from './testing';
import { findingKey, groupsOf, newFindings, personOf, severityCounts } from './panel-model';
import { CHECK_IDS, type HealthReport } from './types';

const report = checkPlan(goldenInput('fedora-res'));

describe('groupsOf', () => {
	it('groups by check in check order and drops empty checks', () => {
		const g = groupsOf(report, 'all');
		expect(g.map((x) => x.check)).toEqual(CHECK_IDS.filter((c) => report.counts[c] > 0));
		expect(g.map((x) => x.findings.length)).toEqual(
			CHECK_IDS.filter((c) => report.counts[c] > 0).map((c) => report.counts[c]),
		);
	});

	it('filters by severity', () => {
		const info = groupsOf(report, 'info');
		expect(info.every((g) => g.findings.every((f) => f.severity === 'info'))).toBe(true);
		expect(info.flatMap((g) => g.findings)).toHaveLength(severityCounts(report).info);
		// Hard constraints and long tasks are notes; the rest are warnings.
		expect(info.map((g) => g.check)).toEqual(['hard-constraint', 'long-task']);
		expect(groupsOf(report, 'error')).toEqual([]);
	});

	it('counts per severity add up to the findings', () => {
		const c = severityCounts(report);
		expect(c.error + c.warning + c.info).toBe(report.findings.length);
		expect(c.warning).toBe(224);
		expect(c.info).toBe(17);
	});
});

describe('findingKey and newFindings', () => {
	const sub = (r: HealthReport, keep: (i: number) => boolean): HealthReport => ({
		...r,
		revision: r.revision + 1,
		findings: r.findings.filter((_, i) => keep(i)),
	});

	it('is unique per finding on fedora-res', () => {
		const keys = new Set(report.findings.map(findingKey));
		expect(keys.size).toBe(report.findings.length);
	});

	it('counts only the findings the previous result did not have', () => {
		const fewer = sub(report, (i) => i >= 3);
		expect(newFindings(fewer, report)).toBe(3);
		expect(newFindings(report, fewer)).toBe(0);
		expect(
			newFindings(
				report,
				sub(report, () => true),
			),
		).toBe(0);
	});

	it('is zero for the first report of a plan', () => {
		expect(newFindings(null, report)).toBe(0);
	});
});

describe('personOf', () => {
	it('names the person of a finding that runs without them, and nobody for the others', () => {
		const h8 = report.findings.find((f) => f.check === 'work-without-people');
		expect(h8 && personOf(h8)).toBe(h8?.check === 'work-without-people' ? h8.facts.resource : '');
		expect(personOf(report.findings[0] as (typeof report.findings)[number])).toBeNull();
	});
});
