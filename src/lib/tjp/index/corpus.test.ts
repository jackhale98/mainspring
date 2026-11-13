// SPDX-License-Identifier: GPL-2.0-or-later
// The index against every golden plan (phase-1.md 9.2, T8): with hints from the golden result
// (fingerprinted with the golden text), task and resource ids, parents, pre-order, declaration
// file and line, names and milestones equal the engine's; without hints, every declaration the
// text names matches and the rest lie in unresolved declarations; dependency targets agree with
// the schedule where it shows them. Plans the engine stopped reading before any declaration are
// skipped (3 of 40: syn-19, bridge-parse-failure, syn-22), and the totals say how many were
// compared.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ScheduleResult } from '../../../engine/protocol';
import { ROOT, readTjp } from '../../../../tests/grammar/corpus';
import { createWorkspace } from '../../workspace/workspace';
import { buildIndex, hintsFromResult, type SymbolIndex } from './index';

interface Golden {
	id: string;
	entry: string;
	files: string[];
	result: ScheduleResult;
}

const manifest = JSON.parse(
	fs.readFileSync(path.join(ROOT, 'engine/golden/manifest.json'), 'utf8'),
) as Array<{ id: string; root: string }>;

const CASES = manifest.map((plan) => {
	const g = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${plan.id}.json`), 'utf8'),
	) as Golden;
	const files: Record<string, string> = {};
	for (const f of g.files) files[f] = readTjp(`${plan.root}/${f}`);
	return { id: plan.id, golden: g, seed: { entry: g.entry, files } };
});

/**
 * Plans the engine stopped reading before their declarations (a syntax error, or an error in the
 * header such as syn-22's `too_large_timing_res`): it reports no properties while the text has
 * some, so there is nothing to compare.
 */
const stoppedEarly = (g: Golden, idx: SymbolIndex): boolean =>
	g.result.tasks.length === 0 &&
	g.result.resources.length === 0 &&
	g.result.messages.some((m) => m.level === 'error' || m.level === 'fatal') &&
	idx.tasks.size + idx.resources.size + idx.unresolved.length > 0;

function lineOf(
	idx: SymbolIndex,
	kind: 'task' | 'resource',
	id: string,
	text: (f: string) => string,
) {
	const sym = kind === 'task' ? idx.tasks.get(id) : idx.resources.get(id);
	if (!sym) return null;
	const at = sym.decl.header;
	// The keyword's line: the header may start with a scenario prefix on the same line.
	const before = text(at.file).slice(0, at.from);
	return { file: at.file, line: before.split('\n').length, parent: sym.parent };
}

const totals = {
	plans: 0,
	compared: 0,
	tasks: 0,
	resources: 0,
	names: 0,
	milestones: 0,
	engineIds: 0,
	depsObserved: 0,
	depsResolved: 0,
};

describe.each(CASES)('$id', ({ golden, seed }) => {
	const snap = createWorkspace(seed).snapshot();
	const text = (f: string): string => snap.files.get(f)?.text.toString() ?? '';
	const hints = hintsFromResult(
		golden.result,
		(_f, line) => line,
		(f, line) => text(f).split('\n')[line - 1] ?? null,
	);
	const withHints = buildIndex(snap, hints, { cache: null });
	const without = buildIndex(snap, undefined, { cache: null });
	const skip = stoppedEarly(golden, without);
	totals.plans++;
	if (!skip) totals.compared++;

	it.skipIf(skip)('with hints: ids, parents, pre-order and source lines equal the engine', () => {
		for (const kind of ['task', 'resource'] as const) {
			const expected = kind === 'task' ? golden.result.tasks : golden.result.resources;
			const map = kind === 'task' ? withHints.tasks : withHints.resources;
			expect([...map.keys()], kind).toEqual(expected.map((t) => t.id));
			for (const t of expected) {
				const got = lineOf(withHints, kind, t.id, text);
				expect(got, `${kind} ${t.id}`).toEqual({
					file: t.source?.file,
					line: t.source?.line,
					parent: t.parent,
				});
			}
			totals[kind === 'task' ? 'tasks' : 'resources'] += expected.length;
		}
		totals.engineIds += [...withHints.tasks.values(), ...withHints.resources.values()].filter(
			(s) => s.idSource === 'engine',
		).length;
		expect(withHints.unresolved).toEqual([]);
	});

	it.skipIf(skip)('with hints: names and milestones equal the engine', () => {
		for (const t of golden.result.tasks) {
			const sym = withHints.tasks.get(t.id);
			if (sym?.name !== null && sym?.name !== undefined) {
				expect(sym.name, `task ${t.id}`).toBe(t.name);
				totals.names++;
			}
			const milestone = sym?.attrs.some((a) => a.keyword === 'milestone' && a.scenario === null);
			if (milestone) {
				expect(t.milestone, `milestone ${t.id}`).toBe(true);
				totals.milestones++;
			}
		}
		for (const r of golden.result.resources) {
			const sym = withHints.resources.get(r.id);
			if (sym?.name === null || sym?.name === undefined) continue;
			expect(sym.name, `resource ${r.id}`).toBe(r.name);
			totals.names++;
		}
	});

	it.skipIf(skip)('without hints: literal declarations match, the rest are unresolved', () => {
		for (const kind of ['task', 'resource'] as const) {
			const expected = kind === 'task' ? golden.result.tasks : golden.result.resources;
			const byId = new Map(expected.map((t) => [t.id, t]));
			const map = kind === 'task' ? without.tasks : without.resources;
			for (const id of map.keys()) {
				const t = byId.get(id);
				expect(t, `${kind} ${id} is known to the engine`).toBeDefined();
				expect(lineOf(without, kind, id, text)).toEqual({
					file: t?.source?.file,
					line: t?.source?.line,
					parent: t?.parent,
				});
			}
			const blocks = without.unresolved
				.filter((u) => u.kind === kind)
				.map((u) => {
					const s = text(u.decl.block.file);
					return {
						file: u.decl.block.file,
						first: s.slice(0, u.decl.block.from).split('\n').length,
						last: s.slice(0, u.decl.block.to).split('\n').length,
					};
				});
			// A macro call or macro body the index marks text-only also covers its engine line.
			const lineAt = (file: string, offset: number): number =>
				text(file).slice(0, offset).split('\n').length;
			const inMacro = (file: string, line: number): boolean =>
				without.textOnly(file as never).some((r) => {
					if (r.reason !== 'macro-call' && r.reason !== 'macro-body') return false;
					return lineAt(file, r.at.from) <= line && line <= lineAt(file, r.at.to);
				});
			for (const t of expected) {
				if (map.has(t.id)) continue;
				const line = t.source?.line ?? -1;
				const file = t.source?.file ?? '';
				const inside = blocks.some(
					(b) => b.file === t.source?.file && b.first <= line && line <= b.last,
				);
				expect(
					inside || inMacro(file, line),
					`${kind} ${t.id} lies in an unresolved declaration or a text-only macro call`,
				).toBe(true);
			}
		}
	});

	it.skipIf(skip)('dependency targets agree with what the engine scheduled', () => {
		const tasks = new Map(golden.result.tasks.map((t) => [t.id, t]));
		// Ids the engine itself reports as unknown ("Task first has unknown depends nosuch",
		// TaskScenario#checkDependency), e.g. in bridge-xref-stop: the index cannot resolve them.
		const unknown = new Set(
			golden.result.messages
				.filter((m) => m.id === 'task_depend_unknown')
				.map((m) => / has unknown (depends|precedes) (\S+)$/.exec(m.text))
				.filter((m) => m !== null)
				.map((m) => `${m[1]} ${m[2]}`),
		);
		for (const d of withHints.dependencies) {
			if (d.textOnly?.reason === 'macro-call') continue;
			// The written id is the predecessor of a `depends` and the successor of a `precedes`.
			const target = d.form === 'precedes' ? d.succ : d.pred;
			if (target === null && unknown.has(`${d.form} ${d.written}`)) continue;
			expect(d.pred, `${d.form} ${d.written}`).not.toBeNull();
			expect(d.succ, `${d.form} ${d.written}`).not.toBeNull();
			const pred = tasks.get(d.pred ?? '');
			const succ = tasks.get(d.succ ?? '');
			expect(pred && succ, `${d.pred} -> ${d.succ}`).toBeTruthy();
			totals.depsResolved++;
			if (!golden.result.ok || d.body !== null || !pred || !succ) continue;
			for (const [sc, s] of Object.entries(succ.scenarios)) {
				if (d.scenario !== null && d.scenario !== sc) continue;
				const p = pred.scenarios[sc];
				if (!p?.scheduled || !s.scheduled || p.end === null || s.start === null) continue;
				expect(s.start, `${d.succ} starts after ${d.pred} ends (${sc})`).toBeGreaterThanOrEqual(
					p.end,
				);
				totals.depsObserved++;
			}
		}
		for (const a of withHints.allocations) {
			if (a.textOnly?.reason === 'macro-call') continue;
			expect(a.resource, `allocate ${a.written}`).not.toBeNull();
			expect(a.declaredBefore, `allocate ${a.written} after its resource`).toBe(true);
		}
	});
});

describe('corpus totals', () => {
	it('reports agreement numbers', () => {
		console.log(`index golden agreement: ${JSON.stringify(totals)}`);
		expect(totals.compared).toBe(totals.plans - 3);
		expect(totals.tasks).toBeGreaterThan(1500);
		expect(totals.names).toBeGreaterThan(1900);
	});
});
