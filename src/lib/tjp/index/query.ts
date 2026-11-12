// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The SymbolIndex object over a finished link (6.4), with its lazy queries: `symbolAt`,
 * `mentions`, `textOnly`, `blocking` and `contextAt`; and `lastSite`, the 5.4 rule for
 * single-valued attributes written several times (the last site in parse order is the one
 * TaskJuggler keeps and the one an edit rewrites).
 */
import type { WorkspacePath } from '../../../engine/protocol';
import type { WorkspaceSnapshot } from '../../workspace/workspace';
import type { TextOnly } from '../text-only';
import type { ContextTracker } from './calendar';
import type { FileFacts } from './facts';
import { preOrder } from './link-finish';
import type { LinkState, MutableSymbol } from './link-state';
import { findMentions } from './mentions';
import { blockingIn, rangeIndex, type RangeIndex } from './ranges';
import type {
	AttrSite,
	IndexContext,
	PropertyKind,
	ResourceSymbol,
	SourceRange,
	SymbolHit,
	SymbolIndex,
	TaskSymbol,
} from './types';

const contains = (r: SourceRange, file: WorkspacePath, pos: number): boolean =>
	r.file === file && r.from <= pos && pos <= r.to;
const size = (r: SourceRange): number => r.to - r.from;

function ordered<T>(
	roots: readonly string[],
	map: ReadonlyMap<string, MutableSymbol>,
): Map<string, T> {
	const out = new Map<string, T>();
	for (const id of preOrder(roots, map)) {
		const sym = map.get(id);
		if (sym) out.set(id, sym as unknown as T);
	}
	// Symbols not reachable from the roots (an orphan whose parent was never indexed).
	for (const [id, sym] of map) if (!out.has(id)) out.set(id, sym as unknown as T);
	return out;
}

export class IndexImpl implements SymbolIndex {
	readonly version: number;
	readonly visits;
	readonly project;
	readonly tasks: ReadonlyMap<string, TaskSymbol>;
	readonly taskRoots;
	readonly resources: ReadonlyMap<string, ResourceSymbol>;
	readonly resourceRoots;
	readonly dependencies;
	readonly allocations;
	readonly references;
	readonly leaves;
	readonly workingHours;
	readonly flags;
	readonly globalFlags;
	readonly macros;
	readonly scenarios;
	readonly customAttributes;
	readonly customAttributeUses;
	readonly unresolved;
	readonly #ws: WorkspaceSnapshot;
	readonly #facts: ReadonlyMap<WorkspacePath, FileFacts>;
	readonly #extra: ReadonlyMap<WorkspacePath, readonly TextOnly[]>;
	readonly #supplementHits: readonly SymbolHit[];
	readonly #ctx: ContextTracker;
	readonly #visitsOfFile: ReadonlyMap<WorkspacePath, readonly number[]>;
	readonly #ranges = new Map<WorkspacePath, RangeIndex>();
	#hits: Map<WorkspacePath, SymbolHit[]> | null = null;

	constructor(ws: WorkspaceSnapshot, facts: ReadonlyMap<WorkspacePath, FileFacts>, s: LinkState) {
		this.version = ws.version;
		this.visits = s.visits;
		this.project = s.project;
		this.tasks = ordered(s.taskRoots, s.tasks);
		this.taskRoots = s.taskRoots;
		this.resources = ordered(s.resourceRoots, s.resources);
		this.resourceRoots = s.resourceRoots;
		this.dependencies = s.dependencies;
		this.allocations = s.allocations;
		this.references = s.references;
		this.leaves = s.leaves;
		this.workingHours = s.workingHours;
		this.flags = s.flags;
		this.globalFlags = s.globalFlags;
		this.macros = s.macros;
		this.scenarios = s.scenarios;
		this.customAttributes = s.customAttributes;
		this.customAttributeUses = s.customAttributeUses;
		this.unresolved = s.unresolved;
		this.#ws = ws;
		this.#facts = facts;
		this.#extra = s.extraRanges;
		this.#supplementHits = s.supplementHits;
		this.#ctx = s.ctx;
		this.#visitsOfFile = s.visitsOfFile;
	}

	textOnly(file: WorkspacePath): readonly TextOnly[] {
		return this.#rangesOf(file).list;
	}

	blocking(file: WorkspacePath, from: number, to: number): TextOnly | null {
		return blockingIn(this.#rangesOf(file), from, to);
	}

	contextAt(file: WorkspacePath, pos: number, visit?: number): IndexContext {
		const v = visit ?? this.#visitsOfFile.get(file)?.[0];
		return this.#ctx.at(v ?? -1, pos);
	}

	isFor(ws: WorkspaceSnapshot): boolean {
		const own = this.#ws;
		if (ws === own) return true;
		if (ws.version !== own.version || ws.entry !== own.entry) return false;
		if (ws.files.size !== own.files.size) return false;
		for (const [path, file] of ws.files) if (own.files.get(path) !== file) return false;
		return true;
	}

	mentions(kind: PropertyKind, id: string): readonly TextOnly[] {
		return findMentions(this.#ws, this.#facts.values(), kind, id);
	}

	symbolAt(file: WorkspacePath, pos: number): SymbolHit | null {
		const hits = this.#hitsOf(file);
		let best: SymbolHit | null = null;
		let bestSize = Infinity;
		for (const h of hits) {
			const at = h.kind === 'reference' ? h.ref.at : h.at;
			if (!contains(at, file, pos)) continue;
			const n = size(at);
			if (n < bestSize) {
				best = h;
				bestSize = n;
			}
		}
		if (best) return best;
		let body: SymbolHit | null = null;
		bestSize = Infinity;
		for (const [kind, map] of [
			['task', this.tasks],
			['resource', this.resources],
		] as const) {
			for (const sym of map.values()) {
				const b = sym.decl.block;
				if (!contains(b, file, pos) || size(b) >= bestSize) continue;
				body = { kind, id: sym.id, at: b, role: 'body' };
				bestSize = size(b);
			}
		}
		return body;
	}

	#rangesOf(file: WorkspacePath): RangeIndex {
		let r = this.#ranges.get(file);
		if (!r) {
			const base = this.#facts.get(file)?.ranges.list ?? [];
			const extra = this.#extra.get(file) ?? [];
			r =
				extra.length === 0
					? (this.#facts.get(file)?.ranges ?? rangeIndex([]))
					: rangeIndex([...base, ...extra]);
			this.#ranges.set(file, r);
		}
		return r;
	}

	#hitsOf(file: WorkspacePath): SymbolHit[] {
		if (!this.#hits) {
			const all = new Map<WorkspacePath, SymbolHit[]>();
			const add = (f: WorkspacePath, h: SymbolHit): void => {
				const list = all.get(f);
				if (list) list.push(h);
				else all.set(f, [h]);
			};
			for (const ref of this.references) add(ref.at.file, { kind: 'reference', ref });
			for (const h of this.#supplementHits) if (h.kind === 'supplement') add(h.at.file, h);
			for (const [kind, map] of [
				['task', this.tasks],
				['resource', this.resources],
			] as const) {
				for (const sym of map.values()) {
					const at = sym.decl.header;
					add(at.file, { kind, id: sym.id, at, role: 'header' });
				}
			}
			for (const defs of this.macros.values()) {
				for (const d of defs) add(d.nameAt.file, { kind: 'macro', name: d.name, at: d.nameAt });
			}
			this.#hits = all;
		}
		return this.#hits.get(file) ?? [];
	}
}

/**
 * The site TaskJuggler keeps for a single-valued attribute: the last of `attrs` with this
 * keyword and scenario in reading order (5.4), or null. A prefix naming the top scenario
 * (`topScenario`, `SymbolIndex.scenarios[0]`) is the same as none: `start 2026-01-06
 * plan:start 2026-01-08` keeps 01-08 (native). A symbol's `attrs` are in the order the link
 * walk reads them, visit by visit, which is the order `compareParseOrder`
 * (workspace/include-order.ts) gives. Sizing attributes cannot have two sites: TaskJuggler
 * rejects a second sizing criterion for a task, so this matters for the others.
 */
export function lastSite(
	attrs: readonly AttrSite[],
	keyword: string,
	scenario: string | null = null,
	topScenario: string | null = null,
): AttrSite | null {
	const norm = (sc: string | null): string | null =>
		sc !== null && sc === topScenario ? null : sc;
	const want = norm(scenario);
	for (let i = attrs.length - 1; i >= 0; i--) {
		const a = attrs[i];
		if (a && a.keyword === keyword && norm(a.scenario) === want) return a;
	}
	return null;
}
