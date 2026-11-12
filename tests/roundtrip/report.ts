// SPDX-License-Identifier: GPL-2.0-or-later
// Machine-readable gate evidence (phase-1.md 12, criterion 1): test-results/roundtrip-report.json
// and .md, written by the round-trip suite. test-results/ is not committed; CI uploads it.
import fs from 'node:fs';
import path from 'node:path';
import type { FileRow } from './check';
import { ROOT } from './corpus';

export interface CorpusTotals {
	corpus: string;
	plans: number;
	files: number;
	bytes: number;
	passed: number;
	failed: number;
	errorFiles: number;
	typedStatements: number;
	opaqueStatements: number;
	valuesChecked: number;
}

export function totalsOf(rows: readonly FileRow[]): CorpusTotals[] {
	const by = new Map<string, FileRow[]>();
	for (const r of rows) by.set(r.corpus, [...(by.get(r.corpus) ?? []), r]);
	return [...by].map(([corpus, list]) => ({
		corpus,
		plans: new Set(list.map((r) => r.plan)).size,
		files: list.length,
		bytes: list.reduce((n, r) => n + r.bytes, 0),
		passed: list.filter((r) => r.problems.length === 0).length,
		failed: list.filter((r) => r.problems.length > 0).length,
		errorFiles: list.filter((r) => r.errorNodes > 0).length,
		typedStatements: list.reduce((n, r) => n + r.typedStatements, 0),
		opaqueStatements: list.reduce((n, r) => n + r.opaqueStatements, 0),
		valuesChecked: list.reduce((n, r) => n + r.valuesChecked, 0),
	}));
}

export function markdown(rows: readonly FileRow[], totals: readonly CorpusTotals[]): string {
	const lines = [
		'# Round-trip report',
		'',
		'Parse, print, re-encode UTF-8, compare bytes (phase-1.md 9.1). `bytes` rows are byte-exact; the',
		'`text` row is the invalid-UTF-8 file, text-exact after decoding (ADR-0003 #1).',
		'',
		'| Corpus | Plans | Files | Bytes | Passed | Failed | Files with error nodes | Typed | Opaque | Values |',
		'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
		...totals.map(
			(t) =>
				`| ${t.corpus} | ${t.plans} | ${t.files} | ${t.bytes} | ${t.passed} | ${t.failed} | ` +
				`${t.errorFiles} | ${t.typedStatements} | ${t.opaqueStatements} | ${t.valuesChecked} |`,
		),
		'',
		'## Golden corpus',
		'',
		'| File | Bytes | Context | Compared | Error nodes | Result |',
		'| --- | ---: | --- | --- | ---: | --- |',
		...rows
			.filter((r) => r.corpus === 'golden')
			.map(
				(r) =>
					`| \`${r.file}\` | ${r.bytes} | ${r.top} | ${r.comparison} | ${r.errorNodes}` +
					`${r.firstErrorLine === null ? '' : ` (line ${r.firstErrorLine})`} | ` +
					`${r.problems.length === 0 ? 'pass' : `FAIL: ${r.problems.join('; ')}`} |`,
			),
		'',
	];
	return lines.join('\n');
}

export function writeReport(rows: readonly FileRow[]): string {
	const totals = totalsOf(rows);
	const dir = path.join(ROOT, 'test-results');
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, 'roundtrip-report.json'),
		`${JSON.stringify({ pass: rows.every((r) => r.problems.length === 0), totals, files: rows }, null, '\t')}\n`,
	);
	const md = markdown(rows, totals);
	fs.writeFileSync(path.join(dir, 'roundtrip-report.md'), md);
	return md;
}
