// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the index: workspaces from inline files or fixture folders, and a plain-data
 * view of an index (lazy values forced) for deep comparison.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readTjp } from '../../../../tests/grammar/corpus';
import { createWorkspace, type Workspace } from '../../workspace/workspace';
import type { SymbolIndex } from './types';

export function inline(files: Record<string, string>, entry = 'plan.tjp'): Workspace {
	return createWorkspace({ entry, files });
}

function walk(dir: string, base = dir, out: string[] = []): string[] {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p, base, out);
		else if (/\.tj[ip]$/.test(e.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
	}
	return out.sort();
}

/** A fixture folder under tests/fixtures/tjp, entry plan.tjp. */
export function fixture(name: string): Workspace {
	const root = `tests/fixtures/tjp/${name}`;
	const files: Record<string, string> = {};
	for (const f of walk(path.join(ROOT, root))) files[f] = readTjp(`${root}/${f}`);
	return createWorkspace({ entry: 'plan.tjp', files });
}

/** A golden plan's workspace, from its manifest root and golden file list. */
export function golden(id: string): Workspace {
	const manifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/manifest.json'), 'utf8'),
	) as Array<{ id: string; root: string }>;
	const plan = manifest.find((p) => p.id === id);
	if (!plan) throw new Error(`no golden ${id}`);
	const g = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${id}.json`), 'utf8'),
	) as { entry: string; files: string[] };
	const files: Record<string, string> = {};
	for (const f of g.files) files[f] = readTjp(`${plan.root}/${f}`);
	return createWorkspace({ entry: g.entry, files });
}

/** Everything an index holds, as plain data (attribute values parsed). */
export function plain(idx: SymbolIndex, files: Iterable<string>): unknown {
	const attrs = (list: readonly { parsed: unknown }[]) =>
		list.map((a) => ({ ...a, parsed: a.parsed }));
	const sym = <T extends { attrs: readonly { parsed: unknown }[] }>(s: T) => ({
		...s,
		attrs: attrs(s.attrs),
	});
	return {
		version: idx.version,
		visits: idx.visits,
		project: idx.project && { ...idx.project, attrs: attrs(idx.project.attrs) },
		tasks: [...idx.tasks.values()].map(sym),
		taskRoots: idx.taskRoots,
		resources: [...idx.resources.values()].map(sym),
		resourceRoots: idx.resourceRoots,
		dependencies: idx.dependencies,
		allocations: idx.allocations,
		references: idx.references,
		leaves: idx.leaves.map((l) => ({ ...l, attr: { ...l.attr, parsed: l.attr.parsed } })),
		workingHours: idx.workingHours.map((w) => ({
			...w,
			attr: { ...w.attr, parsed: w.attr.parsed },
		})),
		flags: [...idx.flags],
		globalFlags: attrs(idx.globalFlags),
		macros: [...idx.macros].map(([k, v]) => [k, v.map((d) => ({ ...d, words: [...d.words] }))]),
		scenarios: idx.scenarios,
		customAttributes: idx.customAttributes,
		customAttributeUses: idx.customAttributeUses,
		unresolved: idx.unresolved,
		textOnly: [...files].map((f) => [f, idx.textOnly(f)]),
	};
}
