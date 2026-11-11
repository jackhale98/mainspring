// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The include graph of a workspace (phase-1.md 5.2, 5.4 `include`, 6.2), walked in TaskJuggler's
 * parse order from the entry file.
 *
 * Where `include` may stand, and the context its file is read in (TjpSyntaxRules.rb at 3b36c79):
 * - before the `project` header, at the top of the entry file or of a prolog file:
 *   `rule_prologInclude` (3525), the file is read as `projectProlog` → top 'prolog';
 * - in the `project` header body: `rule_projectBodyInclude` (3509), read as
 *   `projectBodyAttributes` → top 'project';
 * - at the top level after the header: `rule_propertiesInclude` (3685), read as `properties` →
 *   top 'global'. Only this form takes the `{ taskprefix … resourceprefix … }` body.
 * TaskJuggler accepts `include` nowhere else (ProjectFileParser.rb:485, "Include files can only
 * occur at global level or in the project header"), so includes in task or resource bodies are
 * not include statements in our tree either. Includes inside macro bodies are text-only (X1).
 *
 * Paths resolve as paths.ts says. Recursion is detected as `Scanner#include` does (Scanner.rb:
 * 327-334): a target that is already open further up the chain of including files. TaskJuggler
 * compares the unnormalised names, so it notices spelled-differently cycles only when the name
 * grows past what the file system accepts; it errors either way, and so do we.
 *
 * Prefixes: `taskprefix X` resolves X through `rule_taskId` (6134-6148), which prepends the
 * prefix already in force; an include without one keeps it (`pushFileStack`,
 * ProjectFileParser.rb:470-476, saves and restores the values without clearing them). So the
 * prefix that applies inside a file is the composition along its include chain. The same holds
 * for `resourceprefix` (4786, 7493).
 *
 * A file reached from several include sites is parsed once, in the context of the first one in
 * parse order, and walked once. Each edge keeps the context of its own site, so
 * `contextConflicts` lists the sites whose context differs from the one the file was parsed in.
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import type { TopContext } from '../tjp/document';
import { bodyOf, statementHead, statementsIn, type SourceRange } from '../tjp/tree';
import { parseString } from '../tjp/values/string-literal';
import { resolveIncludePath, type PathLookup, type WorkspacePath } from './paths';

export type IncludeProblem =
	| 'not-found'
	| 'outside-workspace'
	| 'bad-suffix'
	| 'recursive'
	/** The name is a macro call, an environment reference or a templated string (5.4 X2/X3). */
	| 'macro-path';

export interface IncludeEdge {
	/** The including file. */
	from: WorkspacePath;
	/** The whole `include` statement. */
	site: SourceRange;
	/** The file name as TaskJuggler reads it (unquoted); the raw token text for a macro path. */
	literal: string;
	/** The resolved file; also set for a 'recursive' edge, which is not followed. */
	target: WorkspacePath | null;
	/** The context the site reads its file in. */
	top: TopContext;
	/** The task prefix in force inside the target (composed along the chain), or null. */
	taskPrefix: string | null;
	/** The resource prefix in force inside the target (composed along the chain), or null. */
	resourcePrefix: string | null;
	/** The `taskprefix`/`resourceprefix` values as written in this site's body. */
	written: { taskPrefix: SourceRange | null; resourcePrefix: SourceRange | null };
	problem: IncludeProblem | null;
}

export interface IncludeGraph {
	/** Files in parse order (first visit), starting with the entry. */
	readonly order: readonly WorkspacePath[];
	/** Include statements in parse order. */
	readonly edges: readonly IncludeEdge[];
	/** The top context each visited file is parsed in. Files not visited are 'global'. */
	readonly tops: ReadonlyMap<WorkspacePath, TopContext>;
}

export interface IncludeSource {
	readonly lookup: PathLookup;
	/**
	 * The file's tree parsed with `top`, and a reader for its text. Called once per visited file.
	 */
	parse(
		path: WorkspacePath,
		top: TopContext,
	): { readonly tree: Tree; readonly read: (from: number, to: number) => string };
}

interface Prefixes {
	task: string;
	resource: string;
}

/** Walks the include graph from `entry`, which is parsed as 'global'. */
export function buildIncludeGraph(entry: WorkspacePath, source: IncludeSource): IncludeGraph {
	const order: WorkspacePath[] = [entry];
	const edges: IncludeEdge[] = [];
	const tops = new Map<WorkspacePath, TopContext>([[entry, 'global']]);
	let projectSeen = false;

	const walk = (path: WorkspacePath, top: TopContext, chain: WorkspacePath[], pre: Prefixes) => {
		const { tree, read } = source.parse(path, top);
		const include = (stmt: SyntaxNode, siteTop: TopContext): void => {
			const edge = includeEdge(path, stmt, read, siteTop, pre, source.lookup);
			if (edge.target !== null && chain.includes(edge.target)) edge.problem = 'recursive';
			edges.push(edge);
			const target = edge.problem === null ? edge.target : null;
			if (target === null || tops.has(target)) return;
			tops.set(target, siteTop);
			order.push(target);
			walk(target, siteTop, [...chain, target], {
				task: edge.taskPrefix ?? '',
				resource: edge.resourcePrefix ?? '',
			});
		};
		for (const stmt of statementsIn(tree.topNode)) {
			if (stmt.name === 'IncludeStatement') {
				include(stmt, top === 'global' && !projectSeen ? 'prolog' : top);
			} else if (stmt.name === 'ProjectStatement' && top === 'global') {
				const body = bodyOf(stmt);
				if (body) {
					for (const s of statementsIn(body))
						if (s.name === 'IncludeStatement') include(s, 'project');
				}
				projectSeen = true;
			}
		}
	};
	walk(entry, 'global', [entry], { task: '', resource: '' });
	return { order, edges, tops };
}

function includeEdge(
	from: WorkspacePath,
	stmt: SyntaxNode,
	read: (from: number, to: number) => string,
	top: TopContext,
	pre: Prefixes,
	lookup: PathLookup,
): IncludeEdge {
	const site = { file: from, from: stmt.from, to: stmt.to };
	const head = statementHead(stmt);
	const nameNode = head?.nextSibling ?? null;
	const written = {
		taskPrefix: null as SourceRange | null,
		resourcePrefix: null as SourceRange | null,
	};
	const body = bodyOf(stmt);
	if (body) {
		for (const s of statementsIn(body)) {
			const head = statementHead(s);
			const kw = head?.name === 'Keyword' ? read(head.from, head.to) : null;
			const arg = head?.nextSibling ?? null;
			if (!arg || (kw !== 'taskprefix' && kw !== 'resourceprefix')) continue;
			const at = { file: from, from: arg.from, to: arg.to };
			if (kw === 'taskprefix') written.taskPrefix = at;
			else written.resourcePrefix = at;
		}
	}
	const compose = (outer: string, at: SourceRange | null): string | null => {
		const own = at ? read(at.from, at.to) : '';
		const full = own === '' ? outer : outer === '' ? own : `${outer}.${own}`;
		return full === '' ? null : full;
	};
	const edge: IncludeEdge = {
		from,
		site,
		literal: nameNode ? read(nameNode.from, nameNode.to) : '',
		target: null,
		top,
		taskPrefix: compose(pre.task, written.taskPrefix),
		resourcePrefix: compose(pre.resource, written.resourcePrefix),
		written,
		problem: 'macro-path',
	};
	if (nameNode?.name !== 'String') return edge;
	const parsed = parseString(edge.literal);
	if (!parsed.ok) return edge;
	edge.literal = parsed.value;
	const r = resolveIncludePath(from, parsed.value, lookup);
	if (r.ok) {
		edge.target = r.path;
		edge.problem = null;
	} else {
		edge.problem = r.problem;
	}
	return edge;
}

/** Edges whose site reads the target in another context than the one it was parsed in. */
export function contextConflicts(graph: IncludeGraph): IncludeEdge[] {
	return graph.edges.filter(
		(e) => e.target !== null && e.problem === null && graph.tops.get(e.target) !== e.top,
	);
}

/**
 * The position of `at` in TaskJuggler's reading order: the offsets of the include sites from the
 * entry down to its file, then its own offset. Null for a file the entry does not reach.
 */
export function parseOrderKey(
	graph: IncludeGraph,
	at: { readonly file: WorkspacePath; readonly from: number },
): number[] | null {
	const visit = new Map<WorkspacePath, IncludeEdge>();
	for (const e of graph.edges) {
		if (e.problem === null && e.target !== null && !visit.has(e.target)) visit.set(e.target, e);
	}
	const key = [at.from];
	let file = at.file;
	const entry = graph.order[0];
	for (let guard = 0; file !== entry; guard++) {
		const e = visit.get(file);
		if (!e || guard > graph.order.length) return null;
		key.unshift(e.site.from);
		file = e.from;
	}
	return key;
}

/**
 * Compares two positions in parse order (negative when `a` is read first). Positions in files
 * the entry does not reach come last, in path order. This is the order of 5.4's last-site rule
 * for single-valued attributes written in several `supplement` blocks.
 */
export function compareParseOrder(
	graph: IncludeGraph,
	a: { readonly file: WorkspacePath; readonly from: number },
	b: { readonly file: WorkspacePath; readonly from: number },
): number {
	const ka = parseOrderKey(graph, a);
	const kb = parseOrderKey(graph, b);
	if (!ka || !kb) {
		if (ka) return -1;
		if (kb) return 1;
		return a.file < b.file ? -1 : a.file > b.file ? 1 : a.from - b.from;
	}
	for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
		const d = (ka[i] ?? 0) - (kb[i] ?? 0);
		if (d !== 0) return d;
	}
	return ka.length - kb.length;
}
