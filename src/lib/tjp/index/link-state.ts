// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The state the link walk (link.ts) fills: symbols, sites and pending references, and the
 * handlers for attributes inside declarations. References whose targets may be declared later
 * (dependencies, `responsible`, `managers`) are resolved after the walk (link-finish.ts), as
 * TaskJuggler resolves them after parsing; `allocate` and `flags` resolve as they are read, as
 * rule_allocationHeader and rule_flag do.
 */
import type { WorkspacePath } from '../../../engine/protocol';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { TextOnly } from '../text-only';
import type { SourceRange } from '../tree';
import type { ContextTracker } from './calendar';
import type {
	AttrFact,
	DeclFact,
	ExtendFact,
	FileFacts,
	ListItemFact,
	MacroFact,
	ProjectFact,
	ScenarioFact,
} from './facts';
import type { HintTable } from './hints';
import { blockingIn, stronger } from './ranges';
import type {
	AllocationSite,
	AttrSite,
	CustomAttribute,
	CustomAttributeUse,
	DeclSite,
	DependencySite,
	IndexVisit,
	LeaveScope,
	LeaveSite,
	MacroDef,
	ProjectSymbol,
	PropertyKind,
	ReferenceSite,
	ReferenceVia,
	ScenarioSymbol,
	SymbolHit,
	UnresolvedDecl,
	WorkingHoursSite,
} from './types';

/** TaskJuggler's `@property`: a kind and the full id, null when unknown. */
export interface Prop {
	readonly kind: PropertyKind;
	readonly id: string | null;
}

export type Scope =
	| { readonly kind: 'file' }
	| { readonly kind: 'project' }
	| {
			readonly kind: 'decl';
			readonly prop: Prop;
			readonly sym: MutableSymbol | null;
			readonly site: 'decl' | 'supplement';
			/** The X4 reason of an enclosing unresolved declaration. */
			readonly x4: TextOnly | null;
	  };

export interface MutableSymbol {
	kind: PropertyKind;
	id: string;
	localId: string;
	name: string | null;
	parent: string | null;
	children: string[];
	idSource: 'text' | 'engine';
	decl: DeclSite;
	supplements: DeclSite[];
	attrs: AttrSite[];
	bodyMacroCalls: SourceRange[];
	textOnly: TextOnly | null;
	expandedOnly: boolean;
	visit: number;
	sharedWith: string[];
	/** Reading order of the declaration, for sorting children. */
	seq: number;
}

export interface PendingDep {
	form: 'depends' | 'precedes';
	item: ListItemFact;
	owner: Prop;
	attr: AttrSite;
	x4: TextOnly | null;
}

export interface PendingResourceRef {
	item: ListItemFact;
	/** The id TaskJuggler looks up (`resourceprefix` applied), null when unknown. */
	lookup: string | null;
	owner: Prop;
	via: ReferenceVia;
	x4: TextOnly | null;
}

export class LinkState {
	readonly visits: IndexVisit[] = [];
	readonly tasks = new Map<string, MutableSymbol>();
	readonly resources = new Map<string, MutableSymbol>();
	readonly taskRoots: string[] = [];
	readonly resourceRoots: string[] = [];
	readonly unresolved: UnresolvedDecl[] = [];
	readonly references: ReferenceSite[] = [];
	readonly pendingDeps: PendingDep[] = [];
	readonly pendingResourceRefs: PendingResourceRef[] = [];
	readonly dependencies: DependencySite[] = [];
	readonly allocations: AllocationSite[] = [];
	readonly leaves: LeaveSite[] = [];
	readonly workingHours: WorkingHoursSite[] = [];
	readonly flags = new Map<string, SourceRange>();
	readonly globalFlags: AttrSite[] = [];
	readonly macros = new Map<string, MacroDef[]>();
	readonly scenarios: ScenarioSymbol[] = [];
	readonly customAttributes: CustomAttribute[] = [];
	readonly customAttributeUses: CustomAttributeUse[] = [];
	readonly supplementHits: SymbolHit[] = [];
	/** Statement-level macro calls, per visit read (finishLink decides which are safe). */
	readonly macroCalls: SourceRange[] = [];
	/** X4 whole blocks of unresolved declarations and X5 call sites, per file. */
	readonly extraRanges = new Map<WorkspacePath, TextOnly[]>();
	/** Per visit: item offsets and their reading sequence numbers. */
	readonly itemMarks = new Map<number, { offsets: number[]; seqs: number[] }>();
	readonly visitsOfFile = new Map<WorkspacePath, number[]>();
	project: ProjectSymbol | null = null;
	projectAttrs: AttrSite[] = [];
	seq = 0;
	lastCandidates = 0;

	constructor(
		readonly ws: WorkspaceSnapshot,
		readonly factsOf: (path: WorkspacePath) => FileFacts | null,
		readonly hints: HintTable,
		readonly ctx: ContextTracker,
	) {}

	/** Records that visit `i` of `file` is read (visits TaskJuggler rejects are not). */
	registerVisit(i: number, file: WorkspacePath): void {
		const list = this.visitsOfFile.get(file);
		if (list) list.push(i);
		else this.visitsOfFile.set(file, [i]);
	}

	markItem(visit: number, offset: number): void {
		let m = this.itemMarks.get(visit);
		if (!m) {
			m = { offsets: [], seqs: [] };
			this.itemMarks.set(visit, m);
		}
		m.offsets.push(offset);
		m.seqs.push(this.seq);
	}

	map(kind: PropertyKind): Map<string, MutableSymbol> {
		return kind === 'task' ? this.tasks : this.resources;
	}

	has(kind: PropertyKind, id: string): boolean {
		return this.map(kind).has(id);
	}

	symbol(kind: PropertyKind, id: string): MutableSymbol | null {
		return this.map(kind).get(id) ?? null;
	}

	textAt(r: SourceRange): string {
		return this.ws.files.get(r.file)?.text.sliceString(r.from, r.to) ?? '';
	}

	blockingBase(facts: FileFacts, r: SourceRange): TextOnly | null {
		return blockingIn(facts.ranges, r.from, r.to);
	}

	addExtraRange(t: TextOnly): void {
		const list = this.extraRanges.get(t.at.file);
		if (list) list.push(t);
		else this.extraRanges.set(t.at.file, [t]);
	}

	/**
	 * The id of a declaration from its text and the parent (`undefined` when unknown), or from a
	 * unique engine hint on its header line.
	 */
	resolveId(
		facts: FileFacts,
		fact: DeclFact,
		parent: string | null | undefined,
	): { id: string; parent: string | null; source: 'text' | 'engine' } | null {
		this.lastCandidates = 0;
		const local = fact.localId;
		if (local !== null && fact.kind === 'task' && parent !== undefined) {
			return { id: parent === null ? local : `${parent}.${local}`, parent, source: 'text' };
		}
		const taken = (id: string): boolean => this.has(fact.kind, id);
		const cands = this.hints.candidates(
			fact.kind,
			facts.file.path,
			fact.line,
			parent,
			local,
			taken,
		);
		this.lastCandidates = cands.length;
		const only = cands.length === 1 ? cands[0] : undefined;
		if (local !== null && fact.kind === 'resource') {
			return { id: local, parent: parent ?? only?.parent ?? null, source: 'text' };
		}
		if (!only) return null;
		return { id: only.id, parent: parent ?? only.parent, source: 'engine' };
	}

	addSymbol(
		fact: DeclFact,
		visit: number,
		id: string,
		parent: string | null,
		source: 'text' | 'engine',
		x4: TextOnly | null,
	): MutableSymbol {
		const sym: MutableSymbol = {
			kind: fact.kind,
			id,
			localId: fact.kind === 'task' ? id.slice(id.lastIndexOf('.') + 1) : id,
			name: fact.name,
			parent,
			children: [],
			idSource: source,
			decl: fact.site,
			supplements: [],
			attrs: [],
			bodyMacroCalls: [],
			textOnly: stronger(fact.textOnly, x4),
			expandedOnly: false,
			visit,
			sharedWith: [],
			seq: this.seq,
		};
		this.map(fact.kind).set(id, sym);
		const p = parent === null ? null : this.symbol(fact.kind, parent);
		if (p) p.children.push(id);
		else (fact.kind === 'task' ? this.taskRoots : this.resourceRoots).push(id);
		return sym;
	}

	addMacro(m: MacroFact, visit: number): void {
		if (m.name === null) return;
		const def: MacroDef = {
			name: m.name,
			statement: m.statement,
			nameAt: m.nameAt,
			body: m.body,
			text: m.text,
			nestedCalls: m.nestedCalls,
			words: m.words,
			visit,
		};
		const list = this.macros.get(m.name);
		if (list) list.push(def);
		else this.macros.set(m.name, [def]);
	}

	scenario(visit: number, f: ScenarioFact, parent: string | null): void {
		this.scenarios.push({ id: f.id, name: f.name, parent, statement: f.statement, idAt: f.idAt });
		this.ctx.addScenario(visit, f.idAt.to, f.id);
		for (const c of f.children) this.scenario(visit, c, f.id);
	}

	extend(f: ExtendFact): void {
		if (f.scope === null) return;
		for (const a of f.attrs) this.customAttributes.push({ scope: f.scope, ...a });
	}

	setProject(f: ProjectFact, frame: [number, number] | null): void {
		if (this.project) return;
		this.project = {
			id: f.id,
			name: f.name,
			version: f.version,
			decl: f.site,
			interval: f.interval,
			start: frame?.[0] ?? null,
			end: frame?.[1] ?? null,
			attrs: this.projectAttrs,
			textOnly: f.textOnly,
		};
	}

	projectAttr(visit: number, fact: AttrFact): void {
		const site = fact.site;
		this.projectAttrs.push(site);
		if (site.keyword === 'workinghours')
			this.workingHours.push({ scope: { kind: 'project' }, attr: site });
		this.ctx.projectAttr(visit, site, site.value ? this.textAt(site.value) : null);
	}

	addLeave(scope: LeaveScope, attr: AttrSite, fact: AttrFact): void {
		const keyword = attr.keyword === 'vacation' ? 'vacation' : 'leaves';
		this.leaves.push({ scope, keyword, attr, items: fact.items.map((i) => i.item) });
	}
}
