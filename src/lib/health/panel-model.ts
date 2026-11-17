// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * What the health panel shows of a report (phase-3.md 9.7, 10; T18), as plain data: the findings
 * grouped by check and filtered by severity, the count per severity, which findings are new since
 * the last result (announced politely, once per result), and the person a finding is about. Pure:
 * no DOM, no state.
 */
import type { ResourceId } from '../tjp/index';
import { CHECK_IDS, type CheckId, type Finding, type HealthReport, type Severity } from './types';

export type SeverityFilter = 'all' | Severity;
export const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

export interface Group {
	readonly check: CheckId;
	readonly findings: readonly Finding[];
}

/** The findings of a report that pass the filter, grouped by check in `CHECK_IDS` order. */
export function groupsOf(report: HealthReport, filter: SeverityFilter): Group[] {
	const by = new Map<CheckId, Finding[]>();
	for (const f of report.findings) {
		if (filter !== 'all' && f.severity !== filter) continue;
		const list = by.get(f.check) ?? [];
		list.push(f);
		by.set(f.check, list);
	}
	return CHECK_IDS.flatMap((check) => {
		const findings = by.get(check);
		return findings ? [{ check, findings }] : [];
	});
}

/** Findings per severity. */
export function severityCounts(report: HealthReport): Record<Severity, number> {
	const out: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
	for (const f of report.findings) out[f.severity]++;
	return out;
}

/**
 * What identifies a finding across two results: the check and what it is about. A message
 * (H4, H9) is told by its text and task, since its index moves with every run.
 */
export function findingKey(f: Finding): string {
	const s = f.subject;
	switch (f.check) {
		case 'no-predecessor':
		case 'no-successor':
		case 'hard-constraint':
		case 'long-task':
			return `${f.check}|${s.kind === 'task' ? s.id : ''}${f.check === 'hard-constraint' ? `|${f.facts.attr}` : ''}`;
		case 'long-gap':
			return `${f.check}|${s.kind === 'link' ? `${s.pred}>${s.succ}` : ''}`;
		case 'held-by-people':
		case 'work-without-people':
			return `${f.check}|${s.kind === 'task' ? s.id : ''}|${f.facts.resource}`;
		case 'constraint-warning':
			return `${f.check}|${f.facts.limit}|${f.facts.task ?? ''}|${f.facts.text}`;
		case 'resource-warning':
			return `${f.check}|${f.facts.message}|${f.facts.task ?? ''}|${f.facts.text}`;
	}
}

/** How many findings of `next` are not in `prev`. Zero without a previous report. */
export function newFindings(prev: HealthReport | null, next: HealthReport): number {
	if (prev === null) return 0;
	const had = new Set(prev.findings.map(findingKey));
	let n = 0;
	for (const f of next.findings) if (!had.has(findingKey(f))) n++;
	return n;
}

/** The person a finding is about (H7, H8), for "Show in Gantt"; null for the others. */
export function personOf(f: Finding): ResourceId | null {
	return f.check === 'held-by-people' || f.check === 'work-without-people'
		? f.facts.resource
		: null;
}
