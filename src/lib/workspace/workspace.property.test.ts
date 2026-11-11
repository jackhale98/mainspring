// SPDX-License-Identifier: GPL-2.0-or-later
// Property tests for the workspace (phase-1.md 6.1, 6.2): random edits through Workspace.apply
// and Workspace.commit keep every document's tree equal to a fresh parse in its context, keep
// the include graph and contexts equal to those of a workspace built from scratch, and keep the
// text-only rules sound (a macro reason always covers a macro token, 5.4 and 15.4). Expected
// texts come from an independent mirror kept by plain string splicing.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readTjp, serialize } from '../../../tests/grammar/corpus';
import { changeSetOf, parseTjp, textOf } from '../tjp/document';
import { MACRO_TOKENS } from '../tjp/grammar/parser';
import { textOnlyOf } from '../tjp/text-only';
import { createWorkspace, type Workspace, type WorkspaceSeed } from './workspace';

function seedFrom(root: string, entry: string, files: readonly string[]): WorkspaceSeed {
	const out: Record<string, string> = {};
	for (const f of files) out[f] = readTjp(`${root}/${f}`);
	return { entry, files: out };
}

const SEEDS: readonly WorkspaceSeed[] = [
	seedFrom('engine/golden/plans/synthetic/18-structure-include-macro', 'plan.tjp', [
		'plan.tjp',
		'lib/resources.tji',
		'lib/tasks.tji',
	]),
	seedFrom('engine/golden/plans/bridge/include-subfolder', 'plan.tjp', [
		'plan.tjp',
		'parts/tasks.tji',
		'parts/shared.tji',
		'parts/deep/more.tji',
	]),
	seedFrom('engine/golden/plans/synthetic/19-errors-parse', 'plan.tjp', [
		'plan.tjp',
		'lib/broken.tji',
	]),
	seedFrom('tests/fixtures/tjp/include-nested', 'plan.tjp', [
		'plan.tjp',
		'defs.tji',
		'leaf.tji',
		'more.tji',
		'res.tji',
	]),
	seedFrom('tests/fixtures/tjp/macro-statements', 'plan.tjp', ['plan.tjp']),
];

/** Pieces that change tokens, statements, include sites and the project header. */
const SNIPPETS = [
	'{',
	'}',
	'"',
	'[',
	']',
	'\n',
	'\r\n',
	' ',
	'#',
	'/*',
	'*/',
	'${m}',
	'$(HOME)',
	'task t "T" {',
	'effort 1d',
	'depends !a, b { gaplength 2d }',
	'include "lib/tasks.tji"\n',
	'include "parts/tasks.tji"\n',
	'include "defs.tji" { taskprefix root }\n',
	'include "plan.tjp"\n',
	'include "missing.tji"\n',
	'project p "P" 2026-01-05 +1m {\n',
	'timezone "UTC"\n',
	'macro m [ x ]\n',
	'supplement task t {',
	'é',
	'@',
];

interface Edit {
	file: number;
	at: number;
	del: number;
	insert: string;
}

/** One step: typed (commit), applied, applied to two files, or a two-file edit with a stale base. */
type Step =
	{ via: 'commit' | 'apply'; edit: Edit } | { via: 'multi' | 'stale'; edit: Edit; other: Edit };

const editArb: fc.Arbitrary<Edit> = fc.record({
	file: fc.nat({ max: 10 }),
	at: fc.double({ min: 0, max: 1, noNaN: true }),
	del: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 8 }), fc.integer({ min: 9, max: 80 })),
	insert: fc.oneof(
		fc.constant(''),
		fc.constantFrom(...SNIPPETS),
		fc.array(fc.constantFrom(...SNIPPETS), { minLength: 1, maxLength: 3 }).map((a) => a.join('')),
		fc.string({ maxLength: 5 }),
	),
});

const stepArb: fc.Arbitrary<Step> = fc.oneof(
	fc.record({ via: fc.constantFrom('commit' as const, 'apply' as const), edit: editArb }),
	fc.record({
		via: fc.constantFrom('multi' as const, 'stale' as const),
		edit: editArb,
		other: editArb,
	}),
);

/** The mirror: the texts the steps should produce, kept with plain string splicing. */
type Mirror = Record<string, string>;

interface Placed {
	path: string;
	from: number;
	to: number;
	insert: string;
}

function place(mirror: Mirror, e: Edit, skip?: string): Placed | null {
	const paths = Object.keys(mirror)
		.filter((p) => p !== skip)
		.sort();
	const path = paths[e.file % paths.length];
	if (path === undefined) return null;
	const len = (mirror[path] ?? '').length;
	const from = Math.min(len, Math.floor(e.at * len));
	return { path, from, to: Math.min(len, from + e.del), insert: e.insert };
}

function splice(mirror: Mirror, p: Placed): void {
	const t = mirror[p.path] ?? '';
	mirror[p.path] = t.slice(0, p.from) + p.insert + t.slice(p.to);
}

function step(ws: Workspace, mirror: Mirror, s: Step, n: number): void {
	const a = place(mirror, s.edit);
	if (!a) return;
	const version = (p: string) => ws.snapshot().files.get(p)?.version ?? -1;
	const cs = (p: Placed) => changeSetOf(p, (mirror[p.path] ?? '').length);
	if (s.via === 'commit') {
		const tr = ws.state(a.path).update({ changes: a });
		ws.commit(a.path, tr, 'typing');
		splice(mirror, a);
		return;
	}
	if (s.via === 'apply') {
		const r = ws.apply({
			id: `e${n}`,
			intent: { type: 'setAttr' },
			base: { [a.path]: version(a.path) },
			changes: { [a.path]: cs(a) },
		});
		expect(r).toBe('applied');
		splice(mirror, a);
		return;
	}
	if (!('other' in s)) return;
	const b = place(mirror, s.other, a.path);
	if (!b) return;
	const base = {
		[a.path]: version(a.path),
		[b.path]: version(b.path) - (s.via === 'stale' ? 1 : 0),
	};
	const r = ws.apply({
		id: `e${n}`,
		intent: { type: 'moveTask' },
		base,
		changes: { [a.path]: cs(a), [b.path]: cs(b) },
	});
	if (s.via === 'stale') {
		expect(r).toBe('stale');
		stats.stale++;
		return;
	}
	expect(r).toBe('applied');
	splice(mirror, a);
	splice(mirror, b);
	stats.multi++;
}

function check(ws: Workspace, mirror: Mirror): void {
	const snap = ws.snapshot();
	expect(ws.texts()).toEqual(mirror);
	const fresh = createWorkspace({ entry: snap.entry, files: mirror }).snapshot();
	expect(snap.includes).toEqual(fresh.includes);
	for (const [p, file] of snap.files) {
		const text = file.text.toString();
		expect(file.top).toBe(fresh.files.get(p)?.top);
		expect(serialize(file.tree)).toEqual(serialize(parseTjp(text, { top: file.top })));
		expect(ws.state(p).doc.toString()).toBe(text);
		for (const t of textOnlyOf(file)) {
			if (t.reason !== 'macro-call' && t.reason !== 'env-var') continue;
			let covers = false;
			file.tree.iterate({
				from: t.at.from,
				to: t.at.to,
				enter(n) {
					if (MACRO_TOKENS.has(n.name) && n.from >= t.at.from && n.to <= t.at.to) covers = true;
				},
			});
			expect(covers, `${t.reason} at ${p}:${t.at.from}`).toBe(true);
		}
	}
}

const stats = { steps: 0, contextFlips: 0, edgeChanges: 0, multi: 0, stale: 0 };

const RUNS = Number(process.env['WORKSPACE_RUNS'] ?? 200);

/** The include structure as one comparable string. */
const shape = (ws: Workspace): string =>
	JSON.stringify(
		ws
			.snapshot()
			.includes.edges.map((e) => [e.from, e.site.from, e.target, e.top, e.problem, e.taskPrefix]),
	);
const tops = (ws: Workspace): string =>
	JSON.stringify([...ws.snapshot().files].map(([p, f]) => [p, f.top]));

describe('workspace under random edits', () => {
	it('keeps texts, trees, contexts and the include graph equal to a fresh build', () => {
		fc.assert(
			fc.property(
				fc.nat({ max: SEEDS.length - 1 }),
				fc.array(stepArb, { minLength: 1, maxLength: 6 }),
				(seedIndex, steps) => {
					const seed = SEEDS[seedIndex];
					if (!seed) return;
					const ws = createWorkspace(seed);
					const mirror: Mirror = { ...seed.files };
					steps.forEach((s, n) => {
						const before = [shape(ws), tops(ws)];
						step(ws, mirror, s, n);
						stats.steps++;
						if (shape(ws) !== before[0]) stats.edgeChanges++;
						if (tops(ws) !== before[1]) stats.contextFlips++;
						check(ws, mirror);
					});
					// The composed changes since the start turn the seed into the current text.
					const since = ws.changesSince(0);
					for (const [p, text] of Object.entries(seed.files)) {
						const cs = since.get(p);
						expect(cs ? cs.apply(textOf(text)).toString() : text).toBe(mirror[p]);
					}
				},
			),
			{ numRuns: RUNS },
		);
		// The generator reaches the interesting cases: include edges change, contexts flip, and
		// multi-file edits apply or go stale.
		expect(stats.edgeChanges).toBeGreaterThan(0);
		expect(stats.contextFlips).toBeGreaterThan(0);
		expect(stats.multi).toBeGreaterThan(0);
		expect(stats.stale).toBeGreaterThan(0);
	}, 60_000);
});
