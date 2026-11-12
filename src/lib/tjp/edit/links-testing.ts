// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the dependency and allocation intents (deps.ts, deps-gap.ts, allocation.ts):
 * the golden and T16 fixture workspaces, random intents over them for fast-check, and a check of
 * what each intent must mean in the index rebuilt from the edited text (9.3 P3).
 */
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { CORPORA, ROOT, readTjp } from '../../../../tests/grammar/corpus';
import { createWorkspace, type WorkspaceSnapshot } from '../../workspace/workspace';
import { buildIndex, type SymbolIndex } from '../index';
import { itemNode, taskState } from './dep-graph';
import { linkItems, unprefixed } from './deps-links';
import { textsAfter } from './testing';
import type { EditIntent, EditResult } from './types';

export interface LinkCorpus {
	readonly name: string;
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
	readonly tasks: readonly string[];
	readonly resources: readonly string[];
	/** For golden plans: the manifest id. */
	readonly golden: string | null;
}

function load(name: string, entry: string, files: Record<string, string>, golden: string | null) {
	const snap = createWorkspace({ entry, files }).snapshot();
	const index = buildIndex(snap);
	const tasks = [...index.tasks.values()].filter((t) => !t.expandedOnly).map((t) => t.id);
	return { name, snap, index, tasks, resources: [...index.resources.keys()], golden };
}

/** Golden plans (by manifest) and the T16 fixture plans, as workspaces with their index. */
export function linkCorpora(): LinkCorpus[] {
	const manifest = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/manifest.json'), 'utf8'),
	) as Array<{ id: string; root: string }>;
	const out: LinkCorpus[] = manifest.map((plan) => {
		const g = JSON.parse(
			fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${plan.id}.json`), 'utf8'),
		) as { entry: string; files: string[] };
		const files: Record<string, string> = {};
		for (const f of g.files) files[f] = readTjp(`${plan.root}/${f}`);
		return load(plan.root, g.entry, files, plan.id);
	});
	const all = CORPORA.find((c) => c.name === 'fixtures')?.files ?? [];
	const root = 'tests/fixtures/tjp';
	for (const d of fs.readdirSync(path.join(ROOT, root), { withFileTypes: true })) {
		if (!d.isDirectory()) continue;
		const dir = `${root}/${d.name}`;
		const files: Record<string, string> = {};
		for (const f of all) if (f.startsWith(`${dir}/`)) files[f.slice(dir.length + 1)] = readTjp(f);
		if (files['plan.tjp'] !== undefined) out.push(load(dir, 'plan.tjp', files, null));
	}
	return out.filter((c) => c.tasks.length > 0);
}

export const LINK_TYPES = [
	'addDepends',
	'removeDepends',
	'setDependsGap',
	'allocate',
	'addAllocation',
	'removeAllocation',
	'replaceAllocation',
] as const;
export type LinkType = (typeof LINK_TYPES)[number];

const GAPS = [
	{ kind: 'gapduration', value: '1d' },
	{ kind: 'gapduration', value: '4h' },
	{ kind: 'gaplength', value: '2d' },
	{ kind: 'gaplength', value: '1w' },
	null,
] as const;

/**
 * A random intent of `type` on corpus `c`. Removals and gaps mostly pick an existing link or
 * allocation, so they produce edits rather than no-ops.
 */
export function intentArb(c: LinkCorpus, type: LinkType): fc.Arbitrary<EditIntent> {
	const task = fc.constantFrom(...c.tasks);
	const res = c.resources.length > 0 ? fc.constantFrom(...c.resources) : fc.constant('nobody');
	const links = c.index.dependencies.filter((d) => d.pred !== null && d.succ !== null);
	const link =
		links.length > 0
			? fc.constantFrom(...links).map((d) => ({ task: d.succ ?? '', target: d.pred ?? '' }))
			: fc.record({ task, target: task });
	const pair = fc.oneof(fc.record({ task, target: task }), link, link);
	const allocs = c.index.allocations.filter((a) => a.task !== null && a.resource !== null);
	const alloc =
		allocs.length > 0
			? fc.constantFrom(...allocs).map((a) => ({ task: a.task ?? '', resource: a.resource ?? '' }))
			: fc.record({ task, resource: res });
	const own = fc.oneof(fc.record({ task, resource: res }), alloc, alloc);
	switch (type) {
		case 'addDepends':
			return fc.record({ task, target: task }).map((p) => ({ type, ...p }));
		case 'removeDepends':
			return pair.map((p) => ({ type, ...p }));
		case 'setDependsGap':
			return fc
				.tuple(pair, fc.constantFrom(...GAPS))
				.map(([p, gap]) => ({ type, ...p, gap: gap && { ...gap } }));
		case 'allocate':
			return fc
				.tuple(task, fc.uniqueArray(res, { maxLength: 3 }))
				.map(([t, resources]) => ({ type, task: t, resources }));
		case 'addAllocation':
			return fc.record({ task, resource: res }).map((p) => ({ type, ...p }));
		case 'removeAllocation':
			return own.map((p) => ({ type, ...p }));
		case 'replaceAllocation':
			return fc.tuple(own, res).map(([p, to]) => ({ type, task: p.task, from: p.resource, to }));
	}
}

/** The edited workspace and its fresh index. */
export function rebuilt(snap: WorkspaceSnapshot, r: EditResult): LinkCorpus {
	const files = textsAfter(snap, r);
	return load('after', snap.entry, files, null);
}

const allocated = (c: LinkCorpus, task: string): Set<string> =>
	new Set(taskState(c.snap, c.index, task).state.allocs.filter((x): x is string => x !== null));

/** What the intent must mean in the rebuilt index (9.3 P3); a message when it does not. */
export function meaningProblem(
	before: LinkCorpus,
	after: LinkCorpus,
	intent: EditIntent,
): string | null {
	const ids = (c: LinkCorpus): string =>
		[...c.index.tasks.values()].map((t) => `${t.id}<${t.parent ?? ''}`).join(',') +
		'|' +
		[...c.index.resources.values()].map((t) => `${t.id}<${t.parent ?? ''}`).join(',');
	if (ids(before) !== ids(after)) return 'the task or resource tree changed';
	const plain = (task: string, target: string) =>
		linkItems(after.index, task, target).filter((d) => unprefixed(after.index, d.scenario));
	switch (intent.type) {
		case 'addDepends':
			return plain(intent.task, intent.target).length > 0 ? null : 'no link after addDepends';
		case 'removeDepends':
			return linkItems(after.index, intent.task, intent.target).length === 0
				? null
				: 'a link item is left';
		case 'setDependsGap': {
			const all = linkItems(after.index, intent.task, intent.target);
			const items =
				plain(intent.task, intent.target).length > 0 ? plain(intent.task, intent.target) : all;
			for (const d of items) {
				const body = itemNode(after.snap, d.item.file, d.item)?.getChild('Body');
				const names = body ? body.getChildren('GapdurationStatement').length : 0;
				const lengths = body ? body.getChildren('GaplengthStatement').length : 0;
				const want = intent.gap?.kind;
				const ok =
					want === undefined
						? names + lengths === 0
						: (want === 'gapduration' ? names : lengths) === 1 && names + lengths === 1;
				if (!ok) return `item ${d.written} has ${names} gapduration and ${lengths} gaplength`;
			}
			return null;
		}
		case 'addAllocation':
			return allocated(after, intent.task).has(intent.resource) ? null : 'not allocated';
		case 'removeAllocation':
			return allocated(after, intent.task).has(intent.resource) ? 'still allocated' : null;
		case 'allocate': {
			const got = [...allocated(after, intent.task)].sort().join(',');
			const want = [...new Set(intent.resources)].sort().join(',');
			return got === want ? null : `allocated ${got}, wanted ${want}`;
		}
		case 'replaceAllocation': {
			const a = allocated(after, intent.task);
			return a.has(intent.to) && !a.has(intent.from) ? null : 'not replaced';
		}
		default:
			return null;
	}
}
