// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * After the walk: references that may point forward (dependencies as `TaskDependency#resolve`
 * does at scheduling time, `responsible`, `managers`), `extend` uses, declarations that exist
 * only through expansion (X5), declaration pre-order and shared declaration texts.
 *
 * Relative task references resolve as rule_taskDepId does (TjpSyntaxRules.rb:6082-6096): each
 * `!` moves one level up from the task being declared or supplemented; plain and dotted ids are
 * absolute (no task prefix).
 *
 * X5: an engine hint that no declaration took, on a line without a declaration header of its
 * kind, is a declaration injected by a macro call on that line. It is indexed at the call site
 * (the statement that starts the line), entirely text-only, and placed in pre-order where the
 * call is read.
 */
import { enclosingStatement } from '../tree';
import { resolveTaskRef } from '../values';
import { fresh } from './hints';
import { stronger } from './ranges';
import type { LinkState, MutableSymbol } from './link-state';
import type { HintEntry, MacroDef, PropertyKind, SourceRange } from './types';

export function finishLink(s: LinkState): void {
	unsafeMacroCalls(s);
	// Before references: a dependency may name a declaration only expansion makes (X5).
	expandedOnly(s, 'task', s.hints.hints.tasks);
	expandedOnly(s, 'resource', s.hints.hints.resources);
	resolveDependencies(s);
	for (const p of s.pendingResourceRefs) {
		const target = p.lookup !== null && s.resources.has(p.lookup) ? p.lookup : null;
		const textOnly = stronger(p.item.textOnly, p.x4);
		s.references.push({
			kind: 'resource',
			target,
			written: p.item.written,
			at: p.item.ref,
			via: p.via,
			owner: p.owner.id,
			textOnly,
		});
		if (!p.attr) continue;
		// rule_allocationHeader resolves the resource as it reads the allocation: one declared
		// later in reading order is an error natively ("dev is not a defined resource").
		const sym = target === null ? null : s.resources.get(target);
		s.allocations.push({
			task: p.owner.id,
			resource: target,
			declaredBefore: sym ? sym.seq < p.seq : false,
			written: p.item.written,
			item: p.item.item,
			ref: p.item.ref,
			statement: p.attr.statement,
			body: p.item.body,
			scenario: p.attr.scenario,
			site: p.attr.site,
			textOnly,
		});
	}
	for (const u of s.customAttributeUses) {
		u.declared = s.customAttributes.some((a) => a.scope === u.scope && a.id === u.name);
	}
	sharedTexts(s);
}

function resolveDependencies(s: LinkState): void {
	for (const p of s.pendingDeps) {
		const it = p.item;
		const own = p.owner.id;
		let full: string | null = null;
		if (it.path !== null) {
			if (it.up === 0) full = it.path;
			else if (own !== null) {
				const r = resolveTaskRef({ up: it.up, path: it.path }, own);
				full = r.ok ? r.value : null;
			}
		}
		const target = full !== null && s.tasks.has(full) ? full : null;
		const self = own !== null && s.tasks.has(own) ? own : null;
		const textOnly = stronger(it.textOnly, p.x4);
		s.dependencies.push({
			pred: p.form === 'depends' ? target : self,
			succ: p.form === 'depends' ? self : target,
			form: p.form,
			written: it.written,
			item: it.item,
			ref: it.ref,
			statement: p.attr.statement,
			body: it.body,
			scenario: p.attr.scenario,
			site: p.attr.site,
			textOnly,
		});
		s.references.push({
			kind: 'task',
			target,
			written: it.written,
			at: it.ref,
			via: p.form,
			owner: own,
			textOnly,
		});
	}
}

const CALL = /^\$\{(\?)?\s*([A-Za-z_]\w*)/;
const DECLARING: readonly string[] = ['task', 'resource', 'supplement', 'include', 'macro'];

/**
 * A statement-level macro call (`${children}`) may declare tasks the text cannot see or reshape
 * the text around it, so it blocks every enclosing edit (text-only.ts X3, no `within`), unless
 * it is known to be harmless: its macro is defined exactly once, with no nested calls or
 * arguments, none of the declaring keywords in its body and no structural risk (scan-items.ts);
 * or it is an optional call (`${?x}`) of a macro defined nowhere. A macro body that defines a
 * macro can redefine any name when it is called (MacroTable#add overwrites), so then no call is
 * safe.
 *
 * How far the text-only range reaches: a body with unbalanced braces or an unterminated token
 * changes the structure of everything after the call, so the range runs to the end of the
 * file; a line comment in the body comments out the rest of the call's line (native: `${c}`
 * with `c` = `#` drops `length 5d`). Otherwise it is the call statement.
 *
 * Known limitation: an unbalanced or unterminated call blocks the rest of its own file, not
 * the files included after it, which TaskJuggler also reads through the changed structure.
 * Engine hints cover what the text cannot: when the engine read a header line with other ids
 * (a call that rebalances later, or reshapes another file), that declaration is text-only
 * (link.ts).
 */
function unsafeMacroCalls(s: LinkState): void {
	const redefines = [...s.macros.values()].some((defs) => defs.some((d) => d.words.has('macro')));
	const seen = new Set<string>();
	for (const at of s.macroCalls) {
		const key = `${at.file}\0${at.from}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const m = CALL.exec(s.textAt(at));
		const defs = m ? (s.macros.get(m[2] ?? '') ?? []) : null;
		const harmless = (d: MacroDef): boolean =>
			!d.nestedCalls && d.structural === null && DECLARING.every((w) => !d.words.has(w));
		const safe =
			!redefines &&
			defs !== null &&
			(defs.length === 0 ? m?.[1] === '?' : defs.length === 1 && defs.every(harmless));
		if (safe) continue;
		const risks = new Set((defs ?? []).map((d) => d.structural));
		s.addExtraRange({ reason: 'macro-call', at: reach(s, at, risks), within: null });
	}
	riskyMacroTokens(s, redefines);
}

const CALL_IN_TOKEN = /\$\{\??\s*([A-Za-z_]\w*)/g;
const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;

/**
 * The structural reach applies to every macro call, not only statement-level ones: the grammar
 * folds a call into the opaque statement before it (`journalentry … ${close}`) or reads it as
 * a value, and TaskJuggler splices it all the same. Each `MacroCall`/`MacroWord` token (the X2
 * ranges, strings aside: a call inside a string expands inside the string) whose macro is risky,
 * or could be redefined, blocks to the end of its file or line as `reach` says.
 */
function riskyMacroTokens(s: LinkState, redefines: boolean): void {
	for (const file of s.visitsOfFile.keys()) {
		const facts = s.factsOf(file);
		if (!facts) continue;
		for (const r of facts.ranges.list) {
			if (r.reason !== 'macro-call' || r.within === null) continue;
			// Quoted strings (call arguments, templated values) expand inside the string.
			const text = s.textAt(r.at).replace(QUOTED, '""');
			if (!text.startsWith('$') && !/^\w/.test(text)) continue;
			const risks = new Set<MacroDef['structural']>();
			for (const m of text.matchAll(CALL_IN_TOKEN)) {
				for (const d of s.macros.get(m[1] ?? '') ?? []) risks.add(d.structural);
			}
			if (redefines) risks.add('unterminated');
			risks.delete(null);
			if (risks.size > 0)
				s.addExtraRange({ reason: 'macro-call', at: reach(s, r.at, risks), within: null });
		}
	}
}

function reach(
	s: LinkState,
	at: SourceRange,
	risks: ReadonlySet<MacroDef['structural']>,
): SourceRange {
	const doc = s.ws.files.get(at.file)?.text;
	if (!doc) return at;
	if (risks.has('braces') || risks.has('unterminated')) return { ...at, to: doc.length };
	if (risks.has('comment')) return { ...at, to: Math.max(at.to, doc.lineAt(at.from).to) };
	return at;
}

/** The reading sequence of `offset` in the file's first visit (fractional, after the item). */
function seqAt(s: LinkState, file: string, offset: number): number | null {
	const visit = s.visitsOfFile.get(file)?.[0];
	const m = visit === undefined ? undefined : s.itemMarks.get(visit);
	if (!m) return null;
	let lo = 0;
	let hi = m.offsets.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((m.offsets[mid] ?? 0) <= offset) lo = mid + 1;
		else hi = mid;
	}
	return lo === 0 ? null : (m.seqs[lo - 1] ?? null);
}

function callSite(s: LinkState, e: HintEntry): SourceRange | null {
	const file = s.ws.files.get(e.file);
	if (!file || e.line < 1 || e.line > file.text.lines) return null;
	const line = file.text.line(e.line);
	const lead = line.text.length - line.text.trimStart().length;
	const pos = line.from + lead;
	if (pos >= line.to) return null;
	const stmt = enclosingStatement(file.tree.resolveInner(pos, 1));
	if (stmt && stmt.from === pos) return { file: e.file, from: stmt.from, to: stmt.to };
	return { file: e.file, from: pos, to: line.from + line.text.trimEnd().length };
}

function expandedOnly(s: LinkState, kind: PropertyKind, hints: readonly HintEntry[]): void {
	const map = s.map(kind);
	// Only a line with a statement-level macro call can inject a declaration; a leftover hint
	// anywhere else is stale and dropped.
	const callLines = new Set<string>();
	for (const at of s.macroCalls) {
		const n = s.ws.files.get(at.file)?.text.lineAt(at.from).number;
		if (n !== undefined) callLines.add(`${at.file}\0${n}`);
	}
	let k = 0;
	for (const e of hints) {
		if (map.has(e.id) || !callLines.has(`${e.file}\0${e.line}`)) continue;
		const visit = s.visitsOfFile.get(e.file)?.[0];
		if (visit === undefined) continue;
		const facts = s.factsOf(e.file);
		if (!facts || facts.headerLines.has(`${kind}:${e.line}`)) continue;
		const doc = s.ws.files.get(e.file)?.text;
		if (!doc || !fresh(e, doc)) continue;
		if (e.parent !== null && !map.has(e.parent)) continue;
		const at = callSite(s, e);
		if (!at) continue;
		const base = seqAt(s, e.file, at.from);
		if (base === null) continue;
		const textOnly = { reason: 'expanded-only' as const, at, within: null };
		s.addExtraRange(textOnly);
		const sym: MutableSymbol = {
			kind,
			id: e.id,
			localId: kind === 'task' ? e.id.slice(e.id.lastIndexOf('.') + 1) : e.id,
			name: null,
			parent: e.parent,
			children: [],
			idSource: 'engine',
			decl: { header: at, id: null, name: null, block: at, body: null, leadingComments: null },
			supplements: [],
			attrs: [],
			bodyMacroCalls: [],
			textOnly,
			expandedOnly: true,
			visit,
			sharedWith: [],
			seq: base + 0.5 + ++k * 1e-6,
		};
		map.set(e.id, sym);
		const siblings =
			e.parent === null
				? kind === 'task'
					? s.taskRoots
					: s.resourceRoots
				: (map.get(e.parent)?.children ?? []);
		let i = siblings.length;
		while (i > 0 && (map.get(siblings[i - 1] ?? '')?.seq ?? 0) > sym.seq) i--;
		siblings.splice(i, 0, e.id);
	}
}

/** Fills `sharedWith` for declarations whose text several include visits read. */
function sharedTexts(s: LinkState): void {
	if (![...s.visitsOfFile.values()].some((v) => v.length > 1)) return;
	for (const map of [s.tasks, s.resources]) {
		const byText = new Map<string, MutableSymbol[]>();
		for (const sym of map.values()) {
			if (sym.expandedOnly) continue;
			const k = `${sym.decl.block.file}\0${sym.decl.block.from}`;
			const list = byText.get(k);
			if (list) list.push(sym);
			else byText.set(k, [sym]);
		}
		for (const list of byText.values()) {
			if (list.length < 2) continue;
			for (const sym of list) sym.sharedWith = list.filter((o) => o !== sym).map((o) => o.id);
		}
	}
}

/** Ids of a symbol tree in pre-order. */
export function preOrder(
	roots: readonly string[],
	map: ReadonlyMap<string, MutableSymbol>,
): string[] {
	const out: string[] = [];
	const stack = [...roots].reverse();
	while (stack.length > 0) {
		const id = stack.pop() as string;
		out.push(id);
		const kids = map.get(id)?.children ?? [];
		for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as string);
	}
	return out;
}
