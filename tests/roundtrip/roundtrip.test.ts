// SPDX-License-Identifier: GPL-2.0-or-later
// Gate criterion 1 (phase-1.md 9.1, 12): parsing then printing every golden file reproduces it
// byte for byte. The golden corpus is the union of `files` over the manifest's plans (39 plans,
// 48 files, phase-1.md 15 #11); the T16 fixtures and Syntax/Correct are checked the same way.
// Each plan is a workspace, so a file is parsed in the context its include site gives it. The
// grammar, workspace and index corpus tests beside src/lib cover parts of this; this suite is
// the gate's own and writes test-results/roundtrip-report.{json,md}.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { NEGATIVE } from '../grammar/corpus';
import { checkFile, decode, type FileRow } from './check';
import {
	GOLDEN_FILES,
	GOLDEN_PLANS,
	INVALID_UTF8_FILE,
	ROOT,
	fixturePlans,
	goldenPlans,
	manifest,
	readBytes,
	syntaxCorrectPlans,
	walk,
	type PlanCase,
} from './corpus';
import { totalsOf, writeReport } from './report';

const golden = goldenPlans();
const PLANS: readonly PlanCase[] = [...golden, ...fixturePlans(), ...syntaxCorrectPlans()];

/** First error line the golden's message gives for a file, for the deliberate parse failures. */
function goldenErrorLine(plan: string, file: string): number | null {
	const g = JSON.parse(
		fs.readFileSync(path.join(ROOT, `engine/golden/expected/${plan}.json`), 'utf8'),
	) as { result: { messages: Array<{ level: string; file: string | null; line: number | null }> } };
	const m = g.result.messages.find((x) => x.level === 'error' && x.file === file);
	return m?.line ?? null;
}

function rowsOf(plan: PlanCase): FileRow[] {
	const bytes = new Map(plan.files.map((f) => [f, readBytes(`${plan.root}/${f}`)]));
	const texts: Record<string, string> = {};
	for (const [f, b] of bytes) texts[f] = decode(b);
	const snap = createWorkspace({ entry: plan.entry, files: texts }).snapshot();
	return plan.files.map((f): FileRow => {
		const repoPath = `${plan.root}/${f}`;
		const file = snap.files.get(f);
		const meta = { corpus: plan.corpus, plan: plan.id, file: repoPath };
		const expected = NEGATIVE.get(repoPath) ?? null;
		if (!file) {
			return {
				...meta,
				bytes: bytes.get(f)?.length ?? 0,
				top: 'unreached',
				comparison: 'bytes',
				errorNodes: 0,
				firstErrorLine: null,
				typedStatements: 0,
				opaqueStatements: 0,
				valuesChecked: 0,
				problems: ['file is not reached through the include graph'],
			};
		}
		return checkFile(
			meta,
			bytes.get(f) ?? new Uint8Array(),
			file,
			expected,
			repoPath === INVALID_UTF8_FILE,
		);
	});
}

const rows: FileRow[] = PLANS.flatMap(rowsOf);
const rowsOfCorpus = (c: string): FileRow[] => rows.filter((r) => r.corpus === c);

afterAll(() => {
	const md = writeReport(rows);
	console.info(md.split('\n## Golden corpus')[0]);
});

describe('golden corpus is the manifest', () => {
	it('has 39 plans and 48 files', () => {
		expect(manifest()).toHaveLength(GOLDEN_PLANS);
		expect(golden).toHaveLength(GOLDEN_PLANS);
		const union = new Set(golden.flatMap((p) => p.files.map((f) => `${p.root}/${f}`)));
		expect(union.size).toBe(GOLDEN_FILES);
		expect(rowsOfCorpus('golden')).toHaveLength(GOLDEN_FILES);
	});

	it('lists exactly the plan files on disk, plan by plan', () => {
		for (const p of golden) {
			expect([...p.files].sort(), p.id).toEqual(walk(path.join(ROOT, p.root)));
			expect(p.files, `${p.id} entry`).toContain(p.entry);
		}
	});

	it('covers every file of engine/tj/examples', () => {
		const union = new Set(golden.flatMap((p) => p.files.map((f) => `${p.root}/${f}`)));
		const examples = walk(path.join(ROOT, 'engine/tj/examples')).map(
			(f) => `engine/tj/examples/${f}`,
		);
		expect(examples.length).toBeGreaterThan(0);
		expect(examples.filter((f) => !union.has(f))).toEqual([]);
	});

	it('has the two deliberate parse failures and one invalid-UTF-8 file', () => {
		const withErrors = rowsOfCorpus('golden').filter((r) => r.errorNodes > 0);
		expect(withErrors.map((r) => r.file).sort()).toEqual(
			[...NEGATIVE.keys()].filter((f) => f.startsWith('engine/')).sort(),
		);
		for (const [file, line] of NEGATIVE) {
			if (!file.startsWith('engine/')) continue;
			const plan = golden.find((p) => file.startsWith(`${p.root}/`));
			expect(goldenErrorLine(plan?.id ?? '', file.slice((plan?.root.length ?? 0) + 1)), file).toBe(
				line,
			);
		}
		const textOnly = rows.filter((r) => r.comparison === 'text');
		expect(textOnly.map((r) => r.file)).toEqual([INVALID_UTF8_FILE]);
		// ADR-0003 #1: the exemption is real, the bytes are not valid UTF-8.
		expect(() =>
			new TextDecoder('utf-8', { fatal: true }).decode(readBytes(INVALID_UTF8_FILE)),
		).toThrow();
	});
});

describe.each(['golden', 'fixture', 'syntax-correct'])('%s corpus', (corpus) => {
	const list = rowsOfCorpus(corpus);

	it.each(list.map((r) => [r.file, r] as const))('%s', (_file, row) => {
		expect(row.problems).toEqual([]);
	});

	it('has typed statements, and every file reached', () => {
		const [t] = totalsOf(list);
		expect(t?.files).toBeGreaterThan(0);
		expect(t?.typedStatements).toBeGreaterThan(0);
		expect(list.filter((r) => r.top === 'unreached')).toEqual([]);
	});
});

describe('corpus sizes', () => {
	it('checks the T16 fixtures and Syntax/Correct in full', () => {
		expect(new Set(rowsOfCorpus('fixture').map((r) => r.plan)).size).toBe(25);
		// The spec says 79 files; the suite has 85 at the pinned upstream commit.
		expect(rowsOfCorpus('syntax-correct')).toHaveLength(
			walk(path.join(ROOT, 'engine/tj/test/TestSuite/Syntax/Correct')).length,
		);
		expect(rowsOfCorpus('syntax-correct').length).toBeGreaterThanOrEqual(79);
		const negatives = rowsOfCorpus('fixture').filter((r) => r.errorNodes > 0);
		expect(negatives.map((r) => r.file).sort()).toEqual(
			[...NEGATIVE.keys()].filter((f) => f.startsWith('tests/')).sort(),
		);
	});

	it('sees typed values and typed statements in the golden corpus', () => {
		const [g] = totalsOf(rowsOfCorpus('golden'));
		expect(g?.valuesChecked).toBeGreaterThan(500);
		expect(g?.typedStatements).toBeGreaterThan(g?.opaqueStatements ?? Infinity);
	});
});
