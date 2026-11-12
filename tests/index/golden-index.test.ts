// SPDX-License-Identifier: GPL-2.0-or-later
// The index against the goldens (phase-1.md 9.2, gate evidence for "symbol index across included
// files"). For every plan whose golden has tasks or resources (the engine reached the
// declarations), the index's tasks and resources must equal the golden's id, parent, pre-order
// and declaration file and line:
//   - with fingerprinted engine hints (the golden's own lines as the fingerprint), for all ids,
//     including those a macro writes;
//   - without hints, for every declaration the text spells out, the rest being listed in
//     `unresolved`.
// Plans the engine stopped before any declaration have nothing to compare and are named in the
// report. Totals go to test-results/index-crosscheck.json. The src/lib/tjp/index/corpus.test.ts
// suite adds names, milestones and dependency checks; this one is the gate's own.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../src/engine/protocol';
import { TjLines } from '../../src/lib/tjp/lines';
import { buildIndex, hintsFromResult, type SymbolIndex } from '../../src/lib/tjp/index';
import { createWorkspace } from '../../src/lib/workspace/workspace';
import { decode } from '../roundtrip/check';
import { ROOT, goldenPlans, readBytes } from '../roundtrip/corpus';

interface Golden {
	id: string;
	entry: string;
	result: ScheduleResult;
}

const CASES = goldenPlans().map((plan) => {
	const g = JSON.parse(
		fs.readFileSync(path.join(ROOT, `engine/golden/expected/${plan.id}.json`), 'utf8'),
	) as Golden;
	const files: Record<string, string> = {};
	for (const f of plan.files) files[f] = decode(readBytes(`${plan.root}/${f}`));
	const snap = createWorkspace({ entry: plan.entry, files }).snapshot();
	return { id: plan.id, golden: g, files, snap };
});

type Kind = 'task' | 'resource';
const KINDS: readonly Kind[] = ['task', 'resource'];

/** The engine reported no properties although the text has declarations (it stopped early). */
function stoppedEarly(g: Golden, idx: SymbolIndex): boolean {
	return (
		g.result.tasks.length === 0 &&
		g.result.resources.length === 0 &&
		idx.tasks.size + idx.resources.size + idx.unresolved.length > 0
	);
}

const totals = {
	plans: 0,
	compared: 0,
	skipped: [] as string[],
	tasks: 0,
	resources: 0,
	hinted: 0,
};
const totalsDeclared = { literalTasks: 0, literalResources: 0, unresolvedBlocks: 0 };

afterAll(() => {
	const dir = path.join(ROOT, 'test-results');
	fs.mkdirSync(dir, { recursive: true });
	const report = { ...totals, ...totalsDeclared };
	fs.writeFileSync(
		path.join(dir, 'index-crosscheck.json'),
		`${JSON.stringify(report, null, '\t')}\n`,
	);
	console.info(`index vs goldens: ${JSON.stringify(report)}`);
});

describe.each(CASES)('$id', ({ golden, files, snap }) => {
	const lines = (f: string): TjLines => new TjLines(files[f] ?? '');
	const sentLine = (f: string, n: number): string | null =>
		(files[f] ?? '').split(/\r\n|\r|\n/)[n - 1] ?? null;
	const where = (idx: SymbolIndex, kind: Kind, id: string) => {
		const sym = (kind === 'task' ? idx.tasks : idx.resources).get(id);
		if (!sym) return null;
		const at = sym.decl.header;
		return { file: at.file, line: lines(at.file).lineOf(at.from), parent: sym.parent };
	};
	const hinted = buildIndex(
		snap,
		hintsFromResult(golden.result, (_f, n) => n, sentLine),
		{
			cache: null,
		},
	);
	const bare = buildIndex(snap, undefined, { cache: null });
	const skip = stoppedEarly(golden, bare);
	totals.plans++;
	if (skip) totals.skipped.push(golden.id);
	else totals.compared++;

	it.skipIf(skip)('with hints: ids, parents, order, file and line equal the golden', () => {
		for (const kind of KINDS) {
			const expected = kind === 'task' ? golden.result.tasks : golden.result.resources;
			const map = kind === 'task' ? hinted.tasks : hinted.resources;
			expect([...map.keys()], `${kind} ids in order`).toEqual(expected.map((t) => t.id));
			for (const t of expected) {
				expect(where(hinted, kind, t.id), `${kind} ${t.id}`).toEqual({
					file: t.source?.file,
					line: t.source?.line,
					parent: t.parent,
				});
			}
			totals[kind === 'task' ? 'tasks' : 'resources'] += expected.length;
		}
		totals.hinted += [...hinted.tasks.values(), ...hinted.resources.values()].filter(
			(s) => s.idSource === 'engine',
		).length;
		expect(hinted.unresolved).toEqual([]);
	});

	it.skipIf(skip)('without hints: literal declarations match, the rest are unresolved', () => {
		for (const kind of KINDS) {
			const expected = kind === 'task' ? golden.result.tasks : golden.result.resources;
			const byId = new Map(expected.map((t) => [t.id, t]));
			const map = kind === 'task' ? bare.tasks : bare.resources;
			for (const id of map.keys()) {
				const t = byId.get(id);
				expect(t, `${kind} ${id} is known to the engine`).toBeDefined();
				expect(where(bare, kind, id)).toEqual({
					file: t?.source?.file,
					line: t?.source?.line,
					parent: t?.parent,
				});
			}
			totalsDeclared[kind === 'task' ? 'literalTasks' : 'literalResources'] += map.size;
			// Every id the text does not name sits inside an unresolved declaration's block.
			const blocks = bare.unresolved
				.filter((u) => u.kind === kind)
				.map((u) => ({
					file: u.decl.block.file,
					first: lines(u.decl.block.file).lineOf(u.decl.block.from),
					last: lines(u.decl.block.file).lineOf(u.decl.block.to),
				}));
			totalsDeclared.unresolvedBlocks += blocks.length;
			for (const t of expected) {
				if (map.has(t.id)) continue;
				const line = t.source?.line ?? -1;
				const inside = blocks.some(
					(b) => b.file === t.source?.file && b.first <= line && line <= b.last,
				);
				expect(inside, `${kind} ${t.id} lies in an unresolved declaration`).toBe(true);
			}
		}
	});
});

describe('totals', () => {
	it('compares every plan the engine read, and states the count', () => {
		expect(totals.plans).toBe(36);
		expect(totals.skipped.sort()).toEqual([
			'bridge-parse-failure',
			'syn-19-errors-parse',
			'syn-22-tz-kathmandu-resolution',
		]);
		expect(totals.compared).toBe(33);
		expect(totals.tasks).toBeGreaterThan(1500);
		// Ids only the engine can give (macro ids, expanded-only declarations) were resolved by hints.
		expect(totals.hinted).toBeGreaterThan(0);
	});
});
