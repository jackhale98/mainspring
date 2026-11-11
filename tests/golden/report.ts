// SPDX-License-Identifier: GPL-2.0-or-later
/** The golden report table (test-results/golden-report.md) used as gate evidence. */

export interface PlanRow {
	id: string;
	/** "shuffled" for the long-lived worker run, "fresh" for the second page. */
	run: string;
	tasks: number;
	/** Worker `timings.totalMs`; null when no result came back. */
	workerMs: number | null;
	/** Native `totalMs` from native-timings.json. */
	nativeMs: number | null;
	pass: boolean;
	diffs: string[];
}

export interface ReportMeta {
	seed: number;
	expectedPlans: number;
	engine: { tj: string; tjCommit: string; bundleHash: string } | null;
}

function fmt(ms: number | null): string {
	if (ms === null) return '-';
	return ms >= 100 ? String(Math.round(ms)) : ms.toFixed(1);
}

export function ratio(workerMs: number | null, nativeMs: number | null): string {
	return workerMs !== null && nativeMs ? (workerMs / nativeMs).toFixed(1) : '-';
}

export function renderReport(rows: readonly PlanRow[], meta: ReportMeta): string {
	const shuffled = rows.filter((r) => r.run === 'shuffled');
	const passed = shuffled.filter((r) => r.pass).length;
	const out: string[] = ['# Golden parity report', ''];
	if (meta.engine) {
		out.push(
			`Engine: TaskJuggler ${meta.engine.tj} (${meta.engine.tjCommit.slice(0, 7)}), engine build ${meta.engine.bundleHash.slice(0, 12)}.`,
			'',
		);
	}
	out.push(
		`Plans: ${shuffled.length} of ${meta.expectedPlans} expected run; ${passed} match their golden. Shuffle seed ${meta.seed}.`,
		'',
		'| Plan | Run | Tasks | Worker ms | Native ms | Ratio | Pass |',
		'| --- | --- | ---: | ---: | ---: | ---: | --- |',
	);
	for (const r of rows) {
		out.push(
			`| ${r.id} | ${r.run} | ${r.tasks} | ${fmt(r.workerMs)} | ${fmt(r.nativeMs)} | ${ratio(r.workerMs, r.nativeMs)} | ${r.pass ? 'yes' : 'NO'} |`,
		);
	}
	const failures = rows.filter((r) => !r.pass);
	if (failures.length > 0) {
		out.push('', '## Differences', '');
		for (const r of failures) out.push(`### ${r.id} (${r.run})`, '', '```', ...r.diffs, '```', '');
	}
	return `${out.join('\n')}\n`;
}
