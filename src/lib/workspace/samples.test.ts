// SPDX-License-Identifier: GPL-2.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../../tests/grammar/corpus';
import { strings } from '../strings';
import { syntaxIssues } from '../tjp/document';
import { SAMPLES, sampleById } from './samples';
import { createWorkspace, decodeWorkspaceFile } from './workspace';

/** Where each sample's files live in the repository (the golden plan roots). */
const ROOTS: Record<string, string> = {
	'poc-sample': 'engine/golden/plans/poc-sample',
	'upstream-tutorial': 'engine/tj/examples/Tutorial',
	'syn-18-structure-include-macro': 'engine/golden/plans/synthetic/18-structure-include-macro',
	'upstream-fedora-20': 'engine/tj/examples/Fedora-20',
};

describe('SAMPLES', () => {
	it('lists the four samples of spec 6.2 with labels from the strings file', () => {
		expect(SAMPLES.map((s) => s.id)).toEqual(Object.keys(strings.samples));
		for (const s of SAMPLES) {
			expect(s.label).toBe(strings.samples[s.id]);
			expect(sampleById(s.id)).toBe(s);
		}
		expect(sampleById('nope')).toBeNull();
	});

	it.each(SAMPLES.map((s) => [s.id, s] as const))(
		'%s loads as the engine would read it',
		async (id, s) => {
			const { entry, files } = await s.load();
			expect(Object.keys(files)).toContain(entry);
			const golden = JSON.parse(
				fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${id}.json`), 'utf8'),
			) as { entry: string; files: string[] };
			expect(entry).toBe(golden.entry);
			expect(Object.keys(files).sort()).toEqual([...golden.files].sort());
			for (const [p, text] of Object.entries(files)) {
				expect(text).toBe(
					decodeWorkspaceFile(fs.readFileSync(path.join(ROOT, ROOTS[id] ?? '', p))),
				);
			}
			const snap = createWorkspace({ entry, files }).snapshot();
			expect(snap.includes.order.length).toBe(Object.keys(files).length);
			expect(snap.includes.edges.filter((e) => e.problem !== null)).toEqual([]);
			for (const f of snap.files.values()) expect(syntaxIssues(f.tree, f.text)).toEqual([]);
		},
	);
});
