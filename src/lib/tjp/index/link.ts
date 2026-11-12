// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The link walk: the files' facts read in TaskJuggler's order from the entry, once per include
 * visit, as ProjectFileParser does. It emulates the parser state that decides ids:
 *
 * - `@property` (`this.property`): the task or resource being declared or supplemented. A
 *   declaration's parent is `@property`, or the prefix property when it is nil
 *   (rule_taskHeader/rule_resourceHeader, TjpSyntaxRules.rb:6114, 4797); after its body
 *   `@property` becomes that parent (rule_task, :5910), so after the first top-level task of a
 *   prefixed include the prefix task stays in `@property`, and a nested include read then
 *   parents its tasks to it, not to its own prefix. Each include file ends with `@property` nil
 *   (popFileStack, ProjectFileParser.rb:483-489). `supplement` saves and restores it (:5812).
 * - Visits, prefixes and the `@property` an include site leaves come from the include graph
 *   (workspace/includes.ts). A macro prefix is unknown, and so are ids below it until engine
 *   hints name them. Includes before the project header fail in TaskJuggler 3.8.4
 *   (`include_before_project`, rule_includeFile at :1940), so those visits declare nothing.
 * - `supplement task X` names `@property.fullId + '.X'` under a task `@property`, else the
 *   prefix in force + '.X' (rule_taskId, :6134); `supplement resource X` the resource prefix.
 * - Task ids: parent full id + '.' + id. Resource ids are flat: the id alone.
 * - Non-literal ids take engine hints (hints.ts); without one the declaration and everything
 *   below it is unresolved, and its block is text-only (X4).
 */
import type { WorkspacePath } from '../../../engine/protocol';
import type { IncludeEdge } from '../../workspace/includes';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { TextOnly } from '../text-only';
import type { SourceRange } from '../tree';
import { ContextTracker } from './calendar';
import type { AttrFact, BodyItem, DeclFact, FileFacts, ProjectFact, SupplementFact } from './facts';
import type { HintTable } from './hints';
import { stronger } from './ranges';
import { declAttr } from './link-attrs';
import { finishLink } from './link-finish';
import { LinkState, type MutableSymbol, type Prop, type Scope } from './link-state';
import type { IndexVisit, Prefix, PropertyKind } from './types';

interface Frame {
	/** Index into `ws.includes.visits` (and `this.visits`). */
	readonly visit: number;
	readonly facts: FileFacts;
}

function prefixOf(id: string | null, unknown: boolean): Prefix {
	if (unknown) return { kind: 'unknown' };
	return id === null ? { kind: 'none' } : { kind: 'id', id };
}

export class Linker extends LinkState {
	private property: Prop | null = null;
	/** Edges by including visit and site offset. */
	private readonly edges = new Map<string, IncludeEdge>();

	constructor(
		ws: WorkspaceSnapshot,
		factsOf: (path: WorkspacePath) => FileFacts | null,
		hints: HintTable,
		ctx: ContextTracker,
	) {
		super(ws, factsOf, hints, ctx);
		for (const e of ws.includes.edges) this.edges.set(`${e.parentVisit}\0${e.site.from}`, e);
		for (const v of ws.includes.visits) {
			const edge = v.edge === null ? null : ws.includes.edges[v.edge];
			this.visits.push({
				file: v.file,
				parent: v.parent,
				site: edge?.site ?? null,
				taskPrefix: prefixOf(v.taskPrefix, v.taskPrefixUnknown),
				resourcePrefix: prefixOf(v.resourcePrefix, v.resourcePrefixUnknown),
			});
		}
	}

	run(): void {
		const facts = this.factsOf(this.ws.entry);
		if (facts) this.enter(0, facts);
		finishLink(this);
	}

	/** Reads one visit of a file, starting with the `@property` its include site leaves. */
	private enter(visit: number, facts: FileFacts): void {
		const v = this.ws.includes.visits[visit];
		// The graph names the inherited parent by id without checking it: natively
		// `@project.task(prefix)` can be nil, and the declarations are then top-level.
		const p = v?.property ?? null;
		this.property =
			p && (p.id === null || this.has(p.kind, p.id)) ? { kind: p.kind, id: p.id } : null;
		this.registerVisit(visit, facts.file.path);
		this.walk({ visit, facts }, facts.items, facts.top === 'project' ? PROJECT : FILE);
	}

	private walk(frame: Frame, items: readonly BodyItem[], scope: Scope): void {
		for (const item of items) {
			this.seq++;
			this.ctx.mark(frame.visit, itemFrom(item));
			this.markItem(frame.visit, itemFrom(item));
			switch (item.t) {
				case 'include':
					this.include(frame, item.at);
					break;
				case 'decl':
					this.decl(frame, item, scope);
					break;
				case 'supplement':
					this.supplement(frame, item, scope);
					break;
				case 'project':
					this.projectDecl(frame, item);
					break;
				case 'macro':
					if (item.name !== null) this.addMacro(item, frame.visit);
					break;
				case 'macroCall':
					this.macroCall(item.at, scope);
					break;
				case 'scenario':
					if (scope.kind === 'project') this.scenario(frame.visit, item, null);
					break;
				case 'extend':
					if (scope.kind === 'project') this.extend(item);
					break;
				case 'attr':
					this.attr(frame, item, scope);
					break;
			}
		}
	}

	/**
	 * Follows an include site in this visit. Includes before the project header fail in
	 * TaskJuggler 3.8.4 ('before-project'), so their files declare nothing.
	 */
	private include(frame: Frame, at: SourceRange): void {
		const edge = this.edges.get(`${frame.visit}\0${at.from}`);
		if (!edge) return;
		const inner = edge.visit === null ? null : (this.visits[edge.visit] ?? null);
		const written = (r: SourceRange | null): string | null => (r ? this.textAt(r) : null);
		if (inner) {
			this.prefixRef(
				'task',
				edge.written.taskPrefix,
				inner.taskPrefix,
				written(edge.written.taskPrefix),
			);
			this.prefixRef(
				'resource',
				edge.written.resourcePrefix,
				inner.resourcePrefix,
				written(edge.written.resourcePrefix),
			);
		}
		if (edge.visit === null || edge.target === null || edge.problem === 'before-project') return;
		const facts = this.factsOf(edge.target);
		if (!facts) return;
		this.enter(edge.visit, facts);
		this.property = null;
		this.ctx.mark(frame.visit, at.to);
		this.markItem(frame.visit, at.to);
	}

	private macroCall(at: SourceRange, scope: Scope): void {
		if (scope.kind === 'decl') scope.sym?.bodyMacroCalls.push(at);
		this.macroCalls.push(at);
	}

	private prefixRef(
		kind: PropertyKind,
		at: SourceRange | null,
		p: Prefix,
		written: string | null,
	): void {
		if (!at || written === null) return;
		const id = p.kind === 'id' ? p.id : null;
		const known = id !== null && (kind === 'task' ? this.tasks.has(id) : this.resources.has(id));
		this.references.push({
			kind,
			target: known ? id : null,
			written,
			at,
			via: kind === 'task' ? 'taskprefix' : 'resourceprefix',
			owner: null,
			textOnly: null,
		});
	}

	private prefixOf(frame: Frame, kind: PropertyKind): Prefix {
		const v = this.visits[frame.visit] as IndexVisit;
		return kind === 'task' ? v.taskPrefix : v.resourcePrefix;
	}

	/** The prefix property TaskJuggler uses when `@property` is nil. */
	private prefixProp(frame: Frame, kind: PropertyKind): Prop | null {
		const p = this.prefixOf(frame, kind);
		if (p.kind === 'none') return null;
		if (p.kind === 'unknown') return { kind, id: null };
		const known = kind === 'task' ? this.tasks.has(p.id) : this.resources.has(p.id);
		return known ? { kind, id: p.id } : null;
	}

	private decl(frame: Frame, fact: DeclFact, scope: Scope): void {
		const parentProp = this.property ?? this.prefixProp(frame, fact.kind);
		const conflict = parentProp !== null && parentProp.kind !== fact.kind;
		const parent = parentProp === null ? null : conflict ? undefined : (parentProp.id ?? undefined);
		const resolved = conflict ? null : this.resolveId(frame.facts, fact, parent);
		const outer = scope.kind === 'decl' ? scope.x4 : null;
		let x4 = outer;
		let sym: MutableSymbol | null = null;
		let id: string | null = null;
		if (resolved && !this.has(fact.kind, resolved.id)) {
			id = resolved.id;
			sym = this.addSymbol(fact, frame.visit, id, resolved.parent, resolved.source, outer);
		} else {
			if (resolved) id = resolved.id;
			if (fact.idForm !== 'literal') {
				const own: TextOnly = {
					reason: fact.idForm === 'macro' ? 'macro-id' : 'auto-id',
					at: fact.site.block,
					within: null,
				};
				this.addExtraRange(own);
				x4 = stronger(outer, own);
			}
			this.unresolved.push({
				kind: fact.kind,
				reason: resolved
					? 'duplicate'
					: conflict
						? 'property-conflict'
						: fact.idForm === 'literal'
							? 'unknown-parent'
							: fact.idForm === 'macro'
								? 'macro-id'
								: 'auto-id',
				localId: fact.localId,
				parent: parent ?? null,
				candidates: resolved ? 1 : this.lastCandidates,
				decl: fact.site,
				visit: frame.visit,
			});
		}
		this.property = { kind: fact.kind, id };
		this.walk(frame, fact.body, { kind: 'decl', prop: this.property, sym, site: 'decl', x4 });
		this.property = parentProp;
	}

	private supplement(frame: Frame, fact: SupplementFact, scope: Scope): void {
		const kind = fact.kind;
		if (kind === null) return;
		let full: string | null = null;
		if (fact.written !== null) {
			// rule_taskId (TSR 6134): under a task `@property`, its full id; else the prefix.
			const p = this.property;
			const base: Prefix =
				kind === 'task' && p?.kind === 'task'
					? p.id === null
						? { kind: 'unknown' }
						: { kind: 'id', id: p.id }
					: this.prefixOf(frame, kind);
			if (base.kind !== 'unknown')
				full = base.kind === 'id' ? `${base.id}.${fact.written}` : fact.written;
		}
		const target = full !== null && this.has(kind, full) ? full : null;
		if (fact.refAt) {
			this.references.push({
				kind,
				target,
				written: fact.written ?? this.textAt(fact.refAt),
				at: fact.refAt,
				via: 'supplement',
				owner: null,
				textOnly: this.blockingBase(frame.facts, fact.refAt),
			});
		}
		const sym = target === null ? null : this.symbol(kind, target);
		sym?.supplements.push(fact.site);
		this.supplementHits.push({ kind: 'supplement', target, of: kind, at: fact.site.header });
		const saved = this.property;
		this.property = { kind, id: target };
		const x4 = scope.kind === 'decl' ? scope.x4 : null;
		this.walk(frame, fact.body, { kind: 'decl', prop: this.property, sym, site: 'supplement', x4 });
		this.property = saved;
	}

	private projectDecl(frame: Frame, fact: ProjectFact): void {
		const frameRange = this.ctx.header(frame.visit, fact.site.header.to, fact.intervalText);
		this.setProject(fact, frameRange);
		this.walk(frame, fact.body, PROJECT);
		this.property = null;
	}

	private attr(frame: Frame, fact: AttrFact, scope: Scope): void {
		if (scope.kind === 'decl') {
			declAttr(this, fact, scope, this.prefixOf(frame, 'resource'));
			return;
		}
		const site = fact.site;
		if (site.keyword === 'flags') {
			this.globalFlags.push(site);
			for (const it of fact.items) {
				if (it.path !== null && !this.flags.has(it.path)) this.flags.set(it.path, it.ref);
			}
			return;
		}
		if (scope.kind === 'file') {
			if (site.keyword === 'leaves' || site.keyword === 'vacation')
				this.addLeave({ kind: 'global' }, site, fact);
			return;
		}
		this.projectAttr(frame.visit, fact);
	}
}

const FILE: Scope = { kind: 'file' };
const PROJECT: Scope = { kind: 'project' };

function itemFrom(item: BodyItem): number {
	switch (item.t) {
		case 'attr':
			return item.site.statement.from;
		case 'decl':
		case 'supplement':
		case 'project':
			return item.site.block.from;
		case 'macroCall':
		case 'include':
			return item.at.from;
		case 'macro':
		case 'scenario':
		case 'extend':
			return item.statement.from;
	}
}
