// SPDX-License-Identifier: GPL-2.0-or-later
// Property test for the incremental index (phase-1.md 6.4, T8): random edits typed into the
// workspace keep the index built with the facts cache (only changed files rescanned) equal to one
// built from scratch, with and without (increasingly stale) engine hints. The edits change
// tokens, declarations, include sites, prefixes, macros and supplements.
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
	'supplement task rollout {',
	'supplement resource lena { efficiency 0.5 }\n',
	'timingresolution 15min\n',
	'scenario s "S"\n',
];

const SEEDS: ReadonlyArray<() => Workspace> = [
	() => golden('syn-18-structure-include-macro'),
	() => fixture('include-prefix-property'),
	() => fixture('include-nested'),
	() => fixture('supplement'),
	() => fixture('macro-statements'),
];

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
					const ws = (SEEDS[seed] as () => Workspace)();
					const hints = useHints ? hintsOf(ws) : undefined;
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
