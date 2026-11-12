// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The include graph of a workspace (phase-1.md 5.2, 5.4 `include`, 6.2), walked in TaskJuggler's
 * parse order from the entry file. References are to TjpSyntaxRules.rb (TSR) and
 * ProjectFileParser.rb (PFP) at 3b36c79.
 *
 * Contexts. `include` may stand in three places, and its file is read in that context:
 * - before the `project` header (top of the entry file, or of a prolog file): `rule_prologInclude`
 *   (TSR 3525) → top 'prolog'. TaskJuggler 3.8.4 always rejects it: `rule_includeFile` (TSR 1940)
 *   raises `include_before_project` while `@project` is nil. Such edges get the problem
 *   'before-project'; the file is still followed so that the editor can parse it;
 * - in the `project` header body: `rule_projectBodyInclude` (TSR 3509) → top 'project';
 * - at the top level after the header: `rule_propertiesInclude` (TSR 3685) → top 'global'. Only
 *   this form takes the `{ taskprefix … resourceprefix … }` body.
 * TaskJuggler accepts `include` nowhere else (PFP 485), so includes in task or resource bodies are
 * not include statements in our tree. Includes in macro bodies, or produced by a statement-level
 * macro call (`${inc}`), are invisible here (5.4 X1); the engine's file list is the truth.
 *
 * Visits. TaskJuggler reads a file once per include site: a template included under two task
 * prefixes declares its tasks twice. Each file is parsed once (in the context of its first visit),
 * but every followed site makes a visit, and the includes of a file are walked again on each
 * visit. Edges are listed per visit, in parse order; `visitsOf` gives the visits of a file. A
 * declaration in a file with several visits declares several engine ids (T8, T10).
 * `contextConflicts` lists the visits whose context differs from the parse context.
 *
 * Paths resolve as paths.ts says. Recursion is detected as `Scanner#include` (Scanner.rb 327-334)
 * does: a target already open further up the chain of including files.
 *
 * Prefixes. `taskprefix X` resolves X through `rule_taskId` (TSR 6134-6148), which prepends the
 * prefix in force; an include without one keeps it (`pushFileStack`, PFP 470-476). So the prefix
 * in force inside a file is the composition along its chain (`taskPrefix`). The same holds for
 * `resourceprefix` (`rule_resourceId`, TSR 4786). A prefix written as a macro call, environment
 * reference or templated string is unknown: the edge gets 'macro-prefix' and every visit below
 * has `taskPrefixUnknown` or `resourcePrefixUnknown` (each prefix on its own), so the ids it
 * declares of that kind need engine hints. Any other non-id argument (a string, say) is a syntax
 * error, reported by the tree; that prefix is unknown too, with no problem on the edge.
 *
 * Parents. A top-level task gets `@property` as its parent when that is set, else the task named
 * by `@taskprefix` (`rule_taskHeader`, TSR 6113-6117); after the block `@property` is that parent
 * (`rule_task`, TSR 5910), and `popFileStack` (PFP 480-488) clears it when an include returns. So
 * in a prefixed file, an include that follows a top-level task inherits `@property`: the included
 * file's tasks go under the outer prefix, not under the composed one (native: `outer.leaf`, not
 * `outer.mid.leaf`; fixture include-prefix-property). `IncludeVisit.property` records that
 * inherited parent; it applies to the visit's top-level declarations before its first include.
 * Resources work the same way (`rule_resourceHeader`, TSR 4796-4800); a resource inherited as
 * parent of a task (or the reverse) is not modelled.
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import type { TopContext } from '../tjp/document';
import { MACRO_TOKENS } from '../tjp/grammar/parser';
import { bodyOf, statementHead, statementsIn, type SourceRange } from '../tjp/tree';
import { parseString } from '../tjp/values/string-literal';
import { resolveIncludePath, type PathLookup, type WorkspacePath } from './paths';

export {
	compareParseOrder,
	parseOrderKey,
	type ParsePosition,
	type VisitChoice,
} from './include-order';

export type IncludeProblem =
	/** Not followed: */
	| 'not-found'
	| 'outside-workspace'
	| 'bad-suffix'
	| 'recursive'
	/** The name is a macro call, an environment reference or a templated string. */
	| 'macro-path'
	/** No file name, or one that does not parse as a string. */
	| 'no-name'
	/** More than VISIT_LIMIT visits. */
	| 'visit-limit'
	/** Followed: */
	| 'before-project'
	| 'macro-prefix';

export interface IncludeEdge {
	/** The including file. */
	from: WorkspacePath;
	/** The whole `include` statement. */
	site: SourceRange;
	/** The file name as TaskJuggler reads it (unquoted); the raw token text otherwise. */
	literal: string;
	/** The resolved file; also set for a 'recursive' edge, which is not followed. */
	target: WorkspacePath | null;
	/** The context the site reads its file in. */
	top: TopContext;
	/** The task prefix in force inside the target on this visit, or null (none or unknown). */
	taskPrefix: string | null;
	/** The resource prefix in force inside the target on this visit, or null. */
	resourcePrefix: string | null;
	/** The `taskprefix`/`resourceprefix` values as written in this site's body. */
	written: { taskPrefix: SourceRange | null; resourcePrefix: SourceRange | null };
	problem: IncludeProblem | null;
	/** The visit of `from` this site was read in. */
	parentVisit: number;
	/** The visit it opened, or null when it was not followed. */
	visit: number | null;
}

export interface IncludeVisit {
	readonly index: number;
	readonly file: WorkspacePath;
	/** The edge that opened it; null for the entry. */
	readonly edge: number | null;
	/** The including visit; null for the entry. */
	readonly parent: number | null;
	readonly top: TopContext;
	readonly taskPrefix: string | null;
	readonly resourcePrefix: string | null;
	/** A task prefix on the chain is not a literal id: task ids declared here need engine hints. */
	readonly taskPrefixUnknown: boolean;
	/** The same for resource prefixes and resource ids. */
	readonly resourcePrefixUnknown: boolean;
	/**
	 * The `@property` inherited from the include site (module comment), or null; `id` is null when
	 * the prefix it comes from is unknown. Notes for the index (T8):
	 * - natively `@project.task(@taskprefix)` can be nil (the prefix names no task), and then the
	 *   tasks are top-level; `@project.resource(@resourceprefix)` likewise;
	 * - the inherited `@property` also changes how `supplement task x` resolves: `rule_taskId`
	 *   (TSR 6137-6139) prepends `@property.fullId` instead of `@taskprefix` while it is a task.
	 */
	readonly property: { readonly kind: 'task' | 'resource'; readonly id: string | null } | null;
}

export interface IncludeGraph {
	/** Files in parse order (first visit), starting with the entry. */
	readonly order: readonly WorkspacePath[];
	/** Include statements per visit, in parse order. */
	readonly edges: readonly IncludeEdge[];
	/** Visits in parse order; visits[0] is the entry. */
	readonly visits: readonly IncludeVisit[];
	/** The top context each visited file is parsed in (its first visit's). Others are 'global'. */
	readonly tops: ReadonlyMap<WorkspacePath, TopContext>;
}

export interface IncludeSource {
	readonly lookup: PathLookup;
	/** The file's tree parsed with `top`, and a reader for its text. Called once per file. */
	parse(
		path: WorkspacePath,
		top: TopContext,
	): { readonly tree: Tree; readonly read: (from: number, to: number) => string };
}

/** Visits beyond this many are not made (diamond-shaped includes can multiply them). */
export const VISIT_LIMIT = 10_000;

const FOLLOWED: ReadonlySet<IncludeProblem | null> = new Set([
	null,
	'before-project',
	'macro-prefix',
]);

type Property = IncludeVisit['property'];

/** Walks the include graph from `entry`, which is parsed as 'global'. */
export function buildIncludeGraph(entry: WorkspacePath, source: IncludeSource): IncludeGraph {
	const order: WorkspacePath[] = [entry];
	const edges: IncludeEdge[] = [];
	const visits: IncludeVisit[] = [];
	const tops = new Map<WorkspacePath, TopContext>([[entry, 'global']]);
	const parsed = new Map<WorkspacePath, ReturnType<IncludeSource['parse']>>();
	let projectSeen = false;

	const chainHas = (visit: IncludeVisit, file: WorkspacePath): boolean => {
		for (
			let v: IncludeVisit | undefined = visit;
			v;
			v = v.parent === null ? undefined : visits[v.parent]
		) {
			if (v.file === file) return true;
		}
		return false;
	};

	const walk = (visit: IncludeVisit): void => {
		let doc = parsed.get(visit.file);
		if (!doc) {
			doc = source.parse(visit.file, tops.get(visit.file) ?? visit.top);
			parsed.set(visit.file, doc);
		}
		const { tree, read } = doc;
		let property: Property = visit.property;
		const include = (stmt: SyntaxNode, siteTop: TopContext): void => {
			const { edge, unknown } = includeEdge(visit, stmt, read, siteTop, source.lookup);
			if (edge.target !== null && FOLLOWED.has(edge.problem) && chainHas(visit, edge.target)) {
				edge.problem = 'recursive';
			}
			if (edge.target !== null && FOLLOWED.has(edge.problem) && visits.length >= VISIT_LIMIT) {
				edge.problem = 'visit-limit';
			}
			edges.push(edge);
			if (edge.target === null || !FOLLOWED.has(edge.problem)) return;
			if (!tops.has(edge.target)) {
				tops.set(edge.target, siteTop);
				order.push(edge.target);
			}
			const child: IncludeVisit = {
				index: visits.length,
				file: edge.target,
				edge: edges.length - 1,
				parent: visit.index,
				top: siteTop,
				taskPrefix: edge.taskPrefix,
				resourcePrefix: edge.resourcePrefix,
				taskPrefixUnknown: unknown.task,
				resourcePrefixUnknown: unknown.resource,
				property: siteTop === 'global' ? property : null,
			};
			edge.visit = child.index;
			visits.push(child);
			walk(child);
			property = null;
		};
		for (const stmt of statementsIn(tree.topNode)) {
			if (stmt.name === 'IncludeStatement') {
				include(stmt, visit.top === 'global' && !projectSeen ? 'prolog' : visit.top);
			} else if (stmt.name === 'ProjectStatement' && visit.top === 'global') {
				const body = bodyOf(stmt);
				if (body) {
					for (const s of statementsIn(body))
						if (s.name === 'IncludeStatement') include(s, 'project');
				}
				projectSeen = true;
			} else if (visit.top === 'global' && stmt.name === 'TaskStatement') {
				property ??= prefixProperty('task', visit.taskPrefix, visit.taskPrefixUnknown);
			} else if (visit.top === 'global' && stmt.name === 'ResourceStatement') {
				property ??= prefixProperty('resource', visit.resourcePrefix, visit.resourcePrefixUnknown);
			}
		}
	};
	const root: IncludeVisit = {
		index: 0,
		file: entry,
		edge: null,
		parent: null,
		top: 'global',
		taskPrefix: null,
		resourcePrefix: null,
		taskPrefixUnknown: false,
		resourcePrefixUnknown: false,
		property: null,
	};
	visits.push(root);
	walk(root);
	return { order, edges, visits, tops };
}

/** `@property` after a top-level declaration with no inherited parent: the prefix's property. */
function prefixProperty(
	kind: 'task' | 'resource',
	prefix: string | null,
	unknown: boolean,
): Property {
	if (unknown) return { kind, id: null };
	return prefix === null ? null : { kind, id: prefix };
}

function includeEdge(
	visit: IncludeVisit,
	stmt: SyntaxNode,
	read: (from: number, to: number) => string,
	top: TopContext,
	lookup: PathLookup,
): { edge: IncludeEdge; unknown: { task: boolean; resource: boolean } } {
	const from = visit.file;
	const head = statementHead(stmt);
	const nameNode = head?.nextSibling ?? null;
	const written = {
		taskPrefix: null as SourceRange | null,
		resourcePrefix: null as SourceRange | null,
	};
	let macroPrefix = false;
	const unknown = { task: visit.taskPrefixUnknown, resource: visit.resourcePrefixUnknown };
	const body = bodyOf(stmt);
	if (body) {
		for (const s of statementsIn(body)) {
			const h = statementHead(s);
			const kw = h?.name === 'Keyword' ? read(h.from, h.to) : null;
			const arg = h?.nextSibling ?? null;
			if (!arg || (kw !== 'taskprefix' && kw !== 'resourceprefix')) continue;
			const literal = arg.name === 'Identifier' || arg.name === 'AbsoluteId';
			if (MACRO_TOKENS.has(arg.name)) macroPrefix = true;
			const at = { file: from, from: arg.from, to: arg.to };
			if (kw === 'taskprefix') {
				written.taskPrefix = at;
				if (!literal) unknown.task = true;
			} else {
				written.resourcePrefix = at;
				if (!literal) unknown.resource = true;
			}
		}
	}
	const compose = (
		outer: string | null,
		at: SourceRange | null,
		isUnknown: boolean,
	): string | null => {
		if (isUnknown) return null;
		const own = at ? read(at.from, at.to) : '';
		const o = outer ?? '';
		const full = own === '' ? o : o === '' ? own : `${o}.${own}`;
		return full === '' ? null : full;
	};
	const edge: IncludeEdge = {
		from,
		site: { file: from, from: stmt.from, to: stmt.to },
		literal: nameNode ? read(nameNode.from, nameNode.to) : '',
		target: null,
		top,
		taskPrefix: compose(visit.taskPrefix, written.taskPrefix, unknown.task),
		resourcePrefix: compose(visit.resourcePrefix, written.resourcePrefix, unknown.resource),
		written,
		problem: 'no-name',
		parentVisit: visit.index,
		visit: null,
	};
	if (!nameNode) return { edge, unknown };
	if (MACRO_TOKENS.has(nameNode.name)) {
		edge.problem = 'macro-path';
		return { edge, unknown };
	}
	if (nameNode.name !== 'String') return { edge, unknown };
	const parsed = parseString(edge.literal);
	if (!parsed.ok) return { edge, unknown };
	edge.literal = parsed.value;
	const r = resolveIncludePath(from, parsed.value, lookup);
	if (!r.ok) {
		edge.problem = r.problem;
		return { edge, unknown };
	}
	edge.target = r.path;
	edge.problem = top === 'prolog' ? 'before-project' : macroPrefix ? 'macro-prefix' : null;
	return { edge, unknown };
}

/** The visits of one file, in parse order. */
export function visitsOf(graph: IncludeGraph, path: WorkspacePath): IncludeVisit[] {
	return graph.visits.filter((v) => v.file === path);
}

/** Visits read in another context than the one their file was parsed in. */
export function contextConflicts(graph: IncludeGraph): IncludeVisit[] {
	return graph.visits.filter((v) => graph.tops.get(v.file) !== v.top);
}
