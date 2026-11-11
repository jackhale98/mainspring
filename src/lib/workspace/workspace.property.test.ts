// SPDX-License-Identifier: GPL-2.0-or-later
// Property tests for the workspace (phase-1.md 6.1, 6.2): random edits through Workspace.apply
// and Workspace.commit keep every document's tree equal to a fresh parse in its context, keep
// the include graph and contexts equal to those of a workspace built from scratch, and keep the
// text-only rules sound (a macro reason always covers a macro token, 5.4 and 15.4).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readTjp, serialize } from '../../../tests/grammar/corpus';
import { changeSetOf, parseTjp } from '../tjp/document';
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

interface Step {
	file: number;
	at: number;
	del: number;
	insert: string;
	via: 'apply' | 'commit';
}

const stepArb: fc.Arbitrary<Step> = fc.record({
	file: fc.nat({ max: 10 }),
	at: fc.double({ min: 0, max: 1, noNaN: true }),
	del: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 8 }), fc.integer({ min: 9, max: 80 })),
	insert: fc.oneof(
		fc.constant(''),
		fc.constantFrom(...SNIPPETS),
		fc.array(fc.constantFrom(...SNIPPETS), { minLength: 1, maxLength: 3 }).map((a) => a.join('')),
		fc.string({ maxLength: 5 }),
	),
	via: fc.constantFrom('apply', 'commit'),
});

function step(ws: Workspace, s: Step, n: number): void {
	const paths = [...ws.snapshot().files.keys()].sort();
	const path = paths[s.file % paths.length] ?? '';
	const file = ws.snapshot().files.get(path);
	if (!file) throw new Error(path);
	const len = file.text.length;
	const from = Math.min(len, Math.floor(s.at * len));
	const to = Math.min(len, from + s.del);
	if (s.via === 'commit') {
		ws.commit(path, ws.state(path).update({ changes: { from, to, insert: s.insert } }), 'typing');
		return;
	}
	const result = ws.apply({
		id: `e${n}`,
		intent: { type: 'setAttr' },
		base: { [path]: file.version },
		changes: { [path]: changeSetOf({ from, to, insert: s.insert }, len) },
	});
	expect(result).toBe('applied');
}

function check(ws: Workspace, expected: Record<string, string>): void {
	const snap = ws.snapshot();
	expect(ws.texts()).toEqual(expected);
	const fresh = createWorkspace({ entry: snap.entry, files: expected }).snapshot();
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

const RUNS = Number(process.env['WORKSPACE_RUNS'] ?? 150);

describe('workspace under random edits', () => {
	it('keeps trees, contexts and the include graph equal to a fresh build', () => {
		fc.assert(
			fc.property(
				fc.nat({ max: SEEDS.length - 1 }),
				fc.array(stepArb, { minLength: 1, maxLength: 5 }),
				(seedIndex, steps) => {
					const seed = SEEDS[seedIndex];
					if (!seed) return;
					const ws = createWorkspace(seed);
					steps.forEach((s, n) => {
						step(ws, s, n);
						check(ws, ws.texts());
					});
					// The composed changes since the start turn the seed into the current text.
					const since = ws.changesSince(0);
					const texts = ws.texts();
					for (const [p, text] of Object.entries(seed.files)) {
						const cs = since.get(p);
						const now = cs
							? cs.apply(createWorkspace({ entry: p, files: { [p]: text } }).state(p).doc)
							: null;
						expect(now ? now.toString() : text).toBe(texts[p]);
					}
				},
			),
			{ numRuns: RUNS },
		);
	}, 60_000);
});
