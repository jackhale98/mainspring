// SPDX-License-Identifier: GPL-2.0-or-later
// Property test for the incremental index (phase-1.md 6.4, T8): random edits typed into the
// workspace keep the index built with the facts cache (only changed files rescanned) equal to one
// built from scratch, with and without (increasingly stale) engine hints. The edits change
// tokens, declarations, include sites, prefixes, macros and supplements. Hints come from the
// literal declarations, or are the engine's own for the macro-id (X4) and macro-expanded (X5)
// fixtures; all are fingerprinted with the seed text, as the schedule runner records them.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildIndex, createFactsCache, type EngineHints } from './index';
import { fixture, golden, plain } from './testing';
import type { Workspace } from '../../workspace/workspace';

const SNIPPETS = [
	'{',
	'}',
	'"',
	'[',
	']',
	'\n',
	' ',
	'#',
	'${m}',
	'task t "T" {',
	'task "Auto"\n',
	'task ${m} "M"\n',
	'resource r9 "R9"\n',
	'effort 1d',
	'depends !a, b { gaplength 2d }',
	'allocate lena, r9',
	'flags hot',
	'include "lib/tasks.tji"\n',
	'include "tmpl.tji" { taskprefix g1 }\n',
	'include "defs.tji" { taskprefix root }\n',
	'include "sub/a.tji" { resourceprefix who }\n',
	'macro m [ x ]\n',
	'macro mk [ task ${1} "x" ]\n',
	'${mk "q9"}\n',
	'macro close [ } ]\n',
	'${close}',
	'supplement task rollout {',
	'supplement resource lena { efficiency 0.5 }\n',
	'timingresolution 15min\n',
	'scenario s "S"\n',
];

type Hint = { id: string; parent: string | null; file: string; line: number };
const h = (id: string, parent: string | null, line: number): Hint => ({
	id,
	parent,
	file: 'plan.tjp',
	line,
});

/** Seeds, with the engine's hints where the text cannot name every declaration. */
const SEEDS: ReadonlyArray<{ ws: () => Workspace; hints?: { tasks: Hint[]; resources: Hint[] } }> =
	[
		{ ws: () => golden('syn-18-structure-include-macro') },
		{ ws: () => fixture('include-prefix-property') },
		{ ws: () => fixture('include-nested') },
		{ ws: () => fixture('supplement') },
		{ ws: () => fixture('macro-statements') },
		{
			ws: () => fixture('macro-ids'),
			hints: {
				tasks: [h('dev', null, 12), h('dev.dev_sub', 'dev', 13), h('lit', null, 18)],
				resources: [h('ana', null, 9), h('ana2', null, 10)],
			},
		},
		{
			ws: () => fixture('macro-expanded'),
			hints: {
				tasks: [
					h('top', null, 9),
					h('top.q1', 'top', 10),
					h('top.lit', 'top', 11),
					h('top.q2', 'top', 14),
					h('after', null, 16),
				],
				resources: [h('ana', null, 8)],
			},
		},
	];

/** Fingerprints hints with the seed's line texts. */
function fingerprinted(ws: Workspace, hints: { tasks: Hint[]; resources: Hint[] }): EngineHints {
	const snap = ws.snapshot();
	const fp = (e: Hint) => {
		const doc = snap.files.get(e.file)?.text;
		return doc && e.line <= doc.lines ? { ...e, text: doc.line(e.line).text } : e;
	};
	return { tasks: hints.tasks.map(fp), resources: hints.resources.map(fp) };
}

interface Edit {
	file: number;
	at: number;
	del: number;
	insert: string;
}

const editArb: fc.Arbitrary<Edit> = fc.record({
	file: fc.nat({ max: 10 }),
	at: fc.double({ min: 0, max: 1, noNaN: true }),
	del: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 8 }), fc.integer({ min: 9, max: 60 })),
	insert: fc.oneof(
		fc.constant(''),
		fc.constantFrom(...SNIPPETS),
		fc.array(fc.constantFrom(...SNIPPETS), { minLength: 1, maxLength: 3 }).map((a) => a.join('')),
	),
});

/** Hints read off an index: each declaration's id at its header line. */
function hintsOf(ws: Workspace): EngineHints {
	const snap = ws.snapshot();
	const idx = buildIndex(snap, undefined, { cache: null });
	const entry = (s: {
		id: string;
		parent: string | null;
		decl: { header: { file: string; from: number } };
	}) => ({
		id: s.id,
		parent: s.parent,
		file: s.decl.header.file,
		line: snap.files.get(s.decl.header.file)?.text.lineAt(s.decl.header.from).number ?? 0,
	});
	return {
		tasks: [...idx.tasks.values()].map(entry),
		resources: [...idx.resources.values()].map(entry),
	};
}

describe('incremental index', () => {
	it('equals an index built from scratch after random edits', () => {
		fc.assert(
			fc.property(
				fc.nat({ max: SEEDS.length - 1 }),
				fc.boolean(),
				fc.array(editArb, { minLength: 1, maxLength: 6 }),
				(seed, useHints, edits) => {
					const spec = SEEDS[seed];
					if (!spec) return;
					const ws = spec.ws();
					const hints = !useHints
						? undefined
						: spec.hints
							? fingerprinted(ws, spec.hints)
							: hintsOf(ws);
					const cache = createFactsCache();
					buildIndex(ws.snapshot(), hints, { cache });
					for (const e of edits) {
						const paths = [...ws.snapshot().files.keys()].sort();
						const path = paths[e.file % paths.length] as string;
						const len = ws.state(path).doc.length;
						const from = Math.min(len, Math.floor(e.at * len));
						const to = Math.min(len, from + e.del);
						ws.commit(
							path,
							ws.state(path).update({ changes: { from, to, insert: e.insert } }),
							'typing',
						);
						const snap = ws.snapshot();
						const files = [...snap.files.keys()];
						const inc = buildIndex(snap, hints, { cache });
						const fresh = buildIndex(snap, hints, { cache: null });
						expect(plain(inc, files)).toEqual(plain(fresh, files));
					}
				},
			),
			{ numRuns: 200 },
		);
	}, 60_000);
});
