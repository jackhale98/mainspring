// SPDX-License-Identifier: GPL-2.0-or-later
// Every golden plan directory and every multi-file fixture as a workspace (phase-1.md 5.2, 6.2):
// the include graph reaches every file the engine reads, no include has a problem, and every
// file parses without error nodes in the context computed for it (the deliberate negative files
// aside), and prints back exactly.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEGATIVE, ROOT, errorNodes, printLeaves, readTjp } from '../../../tests/grammar/corpus';
import { contextConflicts } from './includes';
import { createWorkspace, type WorkspaceSeed } from './workspace';

interface Case {
	name: string;
	root: string;
	seed: WorkspaceSeed;
}

const manifest = JSON.parse(
	fs.readFileSync(path.join(ROOT, 'engine/golden/manifest.json'), 'utf8'),
) as Array<{ id: string; root: string }>;

const GOLDEN: Case[] = manifest.map((plan) => {
	const golden = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${plan.id}.json`), 'utf8'),
	) as { entry: string; files: string[] };
	const files: Record<string, string> = {};
	for (const f of golden.files) files[f] = readTjp(`${plan.root}/${f}`);
	return { name: plan.id, root: plan.root, seed: { entry: golden.entry, files } };
});

function walk(dir: string, base = dir, out: string[] = []): string[] {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, base, out);
		else if (/\.tj[ip]$/.test(e.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
	}
	return out.sort();
}

const FIXTURE_ROOT = 'tests/fixtures/tjp';
const FIXTURES: Case[] = fs
	.readdirSync(path.join(ROOT, FIXTURE_ROOT), { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => {
		const root = `${FIXTURE_ROOT}/${d.name}`;
		const files: Record<string, string> = {};
		for (const f of walk(path.join(ROOT, root))) files[f] = readTjp(`${root}/${f}`);
		return { name: d.name, root, seed: { entry: 'plan.tjp', files } };
	});

describe.each([...GOLDEN, ...FIXTURES])('$name', ({ root, seed }) => {
	const ws = createWorkspace(seed);
	const snap = ws.snapshot();

	it('reaches every file through includes without problems or context conflicts', () => {
		expect([...snap.includes.order].sort()).toEqual(Object.keys(seed.files).sort());
		expect(snap.includes.edges.filter((e) => e.problem !== null)).toEqual([]);
		expect(contextConflicts(snap.includes)).toEqual([]);
	});

	it('parses each file in its computed context with no error nodes', () => {
		for (const [p, file] of snap.files) {
			const text = file.text.toString();
			expect(text).toBe(seed.files[p]);
			expect(printLeaves(file.tree, text)).toBe(text);
			const errors = errorNodes(file.tree, text);
			const negative = NEGATIVE.get(`${root}/${p}`);
			if (negative === undefined) expect(errors, `${p} (${file.top})`).toEqual([]);
			else expect(errors[0]?.line).toBe(negative);
		}
	});

	it('sends the files as they were decoded', () => {
		expect(ws.texts()).toEqual(seed.files);
	});
});

describe('contexts and prefixes of the corpus', () => {
	const byName = new Map(
		[...GOLDEN, ...FIXTURES].map((c) => [c.name, createWorkspace(c.seed).snapshot()]),
	);
	const edges = (name: string) =>
		(byName.get(name)?.includes.edges ?? []).map((e) => [
			e.from,
			e.target,
			e.top,
			e.taskPrefix,
			e.resourcePrefix,
		]);

	it('matches the include structure of the multi-file plans', () => {
		expect(edges('bridge-include-subfolder')).toEqual([
			['plan.tjp', 'parts/tasks.tji', 'global', null, null],
			['parts/tasks.tji', 'parts/deep/more.tji', 'global', null, null],
			['parts/deep/more.tji', 'parts/shared.tji', 'global', null, null],
		]);
		expect(edges('syn-18-structure-include-macro')).toEqual([
			['plan.tjp', 'lib/resources.tji', 'global', null, null],
			['plan.tjp', 'lib/tasks.tji', 'global', null, null],
		]);
		expect(edges('upstream-fedora-20')).toEqual([
			['f-20.tjp', 'reports.tji', 'global', null, null],
		]);
		expect(edges('include-nested')).toEqual([
			['plan.tjp', 'defs.tji', 'global', null, null],
			['defs.tji', 'leaf.tji', 'global', null, null],
			['plan.tjp', 'more.tji', 'global', 'root', null],
			['plan.tjp', 'res.tji', 'global', null, 'who'],
		]);
		expect(edges('include-taskprefix')).toEqual([
			['plan.tjp', 'sub.tji', 'global', 'parent', null],
		]);
		expect(edges('include-resourceprefix')).toEqual([
			['plan.tjp', 'people.tji', 'global', null, 'team'],
		]);
	});
});
