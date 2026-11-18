// SPDX-License-Identifier: GPL-2.0-or-later
// Names the e2e tests that passed only on their retry (ADR-0016 section 5), from the JSON
// reporter's file (playwright.config.ts writes test-results/e2e-results.json in CI). Prints a
// Markdown block for the step summary; always exits 0 (a flaky test is named, not failed).
//   node scripts/ci/flaky-summary.mjs [results.json] [label]
import fs from 'node:fs';

/** The tests of a Playwright JSON report whose final status is "flaky" (failed, then passed). */
export function flakyTests(report) {
	const out = [];
	const walk = (suite, titles) => {
		const here = suite.title && !suite.file ? [...titles, suite.title] : titles;
		for (const spec of suite.specs ?? []) {
			for (const t of spec.tests ?? []) {
				if (t.status !== 'flaky') continue;
				const failed = (t.results ?? []).filter((r) => r.status !== 'passed').length;
				out.push({
					project: t.projectName,
					file: spec.file,
					title: [...here, spec.title].join(' > '),
					failedAttempts: failed,
				});
			}
		}
		for (const s of suite.suites ?? []) walk(s, here);
	};
	for (const s of report?.suites ?? []) walk(s, []);
	return out;
}

export function markdown(flaky, label) {
	const head = `### Passed only on retry${label ? ` (${label})` : ''}`;
	if (flaky.length === 0) return `${head}\n\nNone.\n`;
	return [
		head,
		'',
		...flaky.map(
			(f) => `- [${f.project}] ${f.file}: ${f.title} (failed ${f.failedAttempts}x first)`,
		),
		'',
		'Twice in a week: fix it or move it to the @timing tier (ADR-0016 section 5).',
		'',
	].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const file = process.argv[2] ?? 'test-results/e2e-results.json';
	const label = process.argv[3] ?? '';
	if (!fs.existsSync(file)) {
		console.log(`### Passed only on retry${label ? ` (${label})` : ''}\n\nNo results file.\n`);
	} else {
		process.stdout.write(markdown(flakyTests(JSON.parse(fs.readFileSync(file, 'utf8'))), label));
	}
}
