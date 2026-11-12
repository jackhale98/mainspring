// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Public types of the symbol index (phase-1.md 6.4). Additions to the spec's interface, all
 * needed by T9 to T11 and recorded in the T8 report:
 *
 * - `visits`: TaskJuggler reads an included file once per include site (TjpSyntaxRules.rb
 *   rule_propertiesInclude), so one text range can declare several ids. Every symbol and site
 *   names the visit it comes from, and `sharedWith` lists the other ids its text declares.
 * - `allocations`, `customAttributes`, `customAttributeUses`, `scenarios`, `globalFlags`,
 *   `workingHours` and `expandedOnly` flags, typed sites the edit intents (7.1) and the
 *   `extend` diagnostic (15.2) need.
 * - `textOnly(file)`, `blocking(file, from, to)` and `contextAt(file, pos)`: the text-only
 *   ranges with engine hints applied (X4 narrowed, X5 added), and the per-position
 *   ProjectContext for `checkValue`.
 */
import type { WorkspacePath } from '../../../engine/protocol';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { TextOnly, TextOnlyReason } from '../text-only';
import type { SourceRange } from '../tree';
import type { ProjectContext, TypedValue } from '../values';

export type { SourceRange, TextOnly, TextOnlyReason };

export type TaskId = string;
/** TaskJuggler resource ids are global (flat namespace); `resourceprefix` only sets parents. */
export type ResourceId = string;
export type PropertyKind = 'task' | 'resource';

export interface DeclSite {
	/** From the statement start through the name (the part before the body). */
	header: SourceRange;
	id: SourceRange | null;
	name: SourceRange | null;
	/** The whole statement. */
	block: SourceRange;
	body: SourceRange | null;
	/** Comment lines directly above the block (no blank line between). */
	leadingComments: SourceRange | null;
}

export interface AttrSite {
	/** The keyword as written ('effort'); for an extension attribute its name ('Phone'). */
	keyword: string;
	/** The scenario prefix without its colon, or null. */
	scenario: string | null;
	statement: SourceRange;
	/** From the first value token to the statement end; null for flags such as `milestone`. */
	value: SourceRange | null;
	/** Parsed lazily; null for opaque, text-only, untyped or invalid values (15.5). */
	readonly parsed: TypedValue | null;
	site: 'decl' | 'supplement';
	textOnly: TextOnly | null;
}

interface PropertyCommon {
	name: string | null;
	idSource: 'text' | 'engine';
	decl: DeclSite;
	supplements: readonly DeclSite[];
	/** Own attributes of the declaration and its supplement blocks, in parse order. */
	attrs: readonly AttrSite[];
	/** Statement-level macro calls in the declaration and supplement bodies (5.4). */
	bodyMacroCalls: readonly SourceRange[];
	textOnly: TextOnly | null;
	/** Declared only through macro expansion (X5); `decl` is then the call site. */
	expandedOnly: boolean;
	/** The include visit (index into `SymbolIndex.visits`) the declaration was read in. */
	visit: number;
	/** Other ids the same declaration text gives in other include visits. */
	sharedWith: readonly string[];
}

export interface TaskSymbol extends PropertyCommon {
	id: TaskId;
	localId: string;
	parent: TaskId | null;
	children: readonly TaskId[];
}

export interface ResourceSymbol extends PropertyCommon {
	id: ResourceId;
	parent: ResourceId | null;
	children: readonly ResourceId[];
}

export interface DependencySite {
	/** Null when unresolvable. */
	pred: TaskId | null;
	succ: TaskId | null;
	form: 'depends' | 'precedes';
	/** The reference as written: '!compile', 'app.editor'. */
	written: string;
	/** The `DepItem`, with its body. */
	item: SourceRange;
	/** The `TaskRef` token(s). */
	ref: SourceRange;
	statement: SourceRange;
	body: SourceRange | null;
	scenario: string | null;
	site: 'decl' | 'supplement';
	textOnly: TextOnly | null;
}

export interface AllocationSite {
	task: TaskId | null;
	resource: ResourceId | null;
	/**
	 * The resource is declared before the allocation in reading order. TaskJuggler rejects an
	 * allocation of a resource declared later (rule_allocationHeader), so edits must not rely on
	 * one where this is false.
	 */
	declaredBefore: boolean;
	written: string;
	item: SourceRange;
	ref: SourceRange;
	statement: SourceRange;
	/** The item's opaque body (`{ alternative … }`), if any. */
	body: SourceRange | null;
	scenario: string | null;
	site: 'decl' | 'supplement';
	textOnly: TextOnly | null;
}

export type ReferenceVia =
	| 'depends'
	| 'precedes'
	| 'allocate'
	| 'responsible'
	| 'managers'
	| 'flags'
	| 'supplement'
	| 'taskprefix'
	| 'resourceprefix';

export interface ReferenceSite {
	kind: 'task' | 'resource' | 'flag';
	target: string | null;
	written: string;
	at: SourceRange;
	via: ReferenceVia;
	/** The task or resource whose statement holds the reference; null at file level. */
	owner: string | null;
	textOnly: TextOnly | null;
}

export type LeaveScope = { kind: 'global' } | { kind: 'resource'; resource: ResourceId | null };

export interface LeaveSite {
	scope: LeaveScope;
	keyword: 'leaves' | 'vacation';
	attr: AttrSite;
	/** Each `Leave` item (for `vacation`, each interval). */
	items: readonly SourceRange[];
}

export type CalendarScope = { kind: 'project' } | { kind: 'resource'; resource: ResourceId | null };

export interface WorkingHoursSite {
	scope: CalendarScope;
	attr: AttrSite;
}

export interface MacroDef {
	name: string;
	statement: SourceRange;
	nameAt: SourceRange;
	/** The `[ … ]` token. */
	body: SourceRange;
	/** The text between the brackets. */
	text: string;
	/** The body holds `${…}` or `$(…)` (nested calls or arguments). */
	nestedCalls: boolean;
	/** Identifier-like words of the body (conservative: strings and comments included). */
	words: ReadonlySet<string>;
	/**
	 * Why splicing the body can reshape the text around a call (unbalanced braces, a comment
	 * start, an unterminated string, cut-here string or macro), or null.
	 */
	structural: 'braces' | 'comment' | 'unterminated' | null;
	visit: number;
}

export interface ScenarioSymbol {
	id: string;
	name: string | null;
	parent: string | null;
	statement: SourceRange;
	idAt: SourceRange;
}

export interface CustomAttribute {
	scope: PropertyKind;
	/** `date`, `number`, `reference`, `richtext` or `text`. */
	type: string;
	id: string;
	name: string | null;
	statement: SourceRange;
	idAt: SourceRange;
	inherit: boolean;
	scenarioSpecific: boolean;
}

export interface CustomAttributeUse {
	scope: PropertyKind;
	name: string;
	statement: SourceRange;
	nameAt: SourceRange;
	owner: string | null;
	/** Some `extend` in the workspace declares this name for the scope. */
	declared: boolean;
}

export interface ProjectSymbol {
	id: string | null;
	name: string | null;
	version: string | null;
	decl: DeclSite;
	interval: SourceRange | null;
	/** Epoch seconds as TaskJuggler reads the header; null when it is text-only or invalid. */
	start: number | null;
	end: number | null;
	/** Typed and opaque statements of the header body and of files included in it. */
	attrs: readonly AttrSite[];
	textOnly: TextOnly | null;
}

export type UnresolvedReason =
	| 'macro-id'
	| 'auto-id'
	/** A literal id below an unknown parent (macro id, macro prefix). */
	| 'unknown-parent'
	| 'duplicate'
	/** `@property` holds the other kind (a resource prefix leaking into tasks). */
	| 'property-conflict';

export interface UnresolvedDecl {
	kind: PropertyKind;
	reason: UnresolvedReason;
	localId: string | null;
	/** The parent when known. */
	parent: string | null;
	/** Engine hint candidates on the header line after filtering (0, or several). */
	candidates: number;
	decl: DeclSite;
	visit: number;
}

export type Prefix = { kind: 'none' } | { kind: 'id'; id: string } | { kind: 'unknown' };

/** One reading of a file: the entry, or one include site along one chain (rule 5.4). */
export interface IndexVisit {
	file: WorkspacePath;
	/** The visit that includes this one; null for the entry. */
	parent: number | null;
	site: SourceRange | null;
	taskPrefix: Prefix;
	resourcePrefix: Prefix;
}

export type SymbolHit =
	| { kind: 'task' | 'resource'; id: string; at: SourceRange; role: 'header' | 'body' }
	| { kind: 'supplement'; target: string | null; of: PropertyKind; at: SourceRange }
	| { kind: 'reference'; ref: ReferenceSite }
	| { kind: 'macro'; name: string; at: SourceRange };

/** A project setting the index may not know. */
export type ContextSetting =
	| 'zone'
	| 'granularity'
	| 'dailyWorkingHours'
	| 'yearlyWorkingDays'
	| 'weeklyWorkingHours'
	| 'frame';

/** ProjectContext at one position, plus the scenarios declared before it. */
export interface IndexContext extends ProjectContext {
	readonly scenarios: readonly string[];
	/**
	 * Settings written as macro calls or env references before this position (or a header
	 * frame that is): their values here are placeholders, so a caller must not refuse a value
	 * on a check that depends on them. An unknown zone or resolution also sets `granularity` to
	 * 60 s, so alignment checks pass.
	 */
	readonly unknown: ReadonlySet<ContextSetting>;
}

export interface SymbolIndex {
	/** WorkspaceSnapshot.version it was built from. */
	readonly version: number;
	readonly visits: readonly IndexVisit[];
	readonly project: ProjectSymbol | null;
	/** In declaration pre-order. */
	readonly tasks: ReadonlyMap<TaskId, TaskSymbol>;
	readonly taskRoots: readonly TaskId[];
	readonly resources: ReadonlyMap<ResourceId, ResourceSymbol>;
	readonly resourceRoots: readonly ResourceId[];
	readonly dependencies: readonly DependencySite[];
	readonly allocations: readonly AllocationSite[];
	readonly references: readonly ReferenceSite[];
	readonly leaves: readonly LeaveSite[];
	readonly workingHours: readonly WorkingHoursSite[];
	/** Declared flags: the first declaration of each. */
	readonly flags: ReadonlyMap<string, SourceRange>;
	/** `flags` declarations at file level, in parse order (for `declareFlag`). */
	readonly globalFlags: readonly AttrSite[];
	readonly macros: ReadonlyMap<string, readonly MacroDef[]>;
	readonly scenarios: readonly ScenarioSymbol[];
	readonly customAttributes: readonly CustomAttribute[];
	readonly customAttributeUses: readonly CustomAttributeUse[];
	readonly unresolved: readonly UnresolvedDecl[];
	symbolAt(file: WorkspacePath, pos: number): SymbolHit | null;
	/** Mentions in macro bodies and opaque statements (5.4 References). */
	mentions(kind: PropertyKind, id: string): readonly TextOnly[];
	/** The file's text-only ranges with engine hints applied, sorted by start. */
	textOnly(file: WorkspacePath): readonly TextOnly[];
	/** As `findTextOnly` (text-only.ts) over `textOnly(file)`. */
	blocking(file: WorkspacePath, from: number, to: number): TextOnly | null;
	/** The project settings in force at a position (its first visit, unless `visit` is given). */
	contextAt(file: WorkspacePath, pos: number, visit?: number): IndexContext;
	/** Whether the index was built from this snapshot: same version, entry and file objects. */
	isFor(ws: WorkspaceSnapshot): boolean;
}

/** Engine ids for declarations the text cannot name (X4, X5). Lines are mapped to the current text. */
export interface EngineHints {
	readonly tasks: ReadonlyArray<HintEntry>;
	readonly resources: ReadonlyArray<HintEntry>;
}

export interface HintEntry {
	readonly id: string;
	readonly parent: string | null;
	readonly file: WorkspacePath;
	readonly line: number;
	/** The line's text as it was scheduled; the hint applies only while it reads the same. */
	readonly text?: string;
}
