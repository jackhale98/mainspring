// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Refinement of engine messages (phase-1.md 6.6 step 2): TaskJuggler gives a file and a line
 * but no column (14.1), so the range comes from the message id, its text and the tree of the
 * text that was scheduled. Rules are tried in order: the id's own rules (RULES), then generic
 * ones (a quoted token on the line, a macro call on the line, a declaration header the text
 * names), then the line's content. Every rule returns a range in the scheduled text, or null.
 *
 * TaskJuggler reports some messages after the statement they are about, at the scanner's
 * position after its look-ahead token (`attr_overwrite` at the next line's `}`,
 * `marco_redefinition` on the line after the macro), and errors found while scheduling at the
 * task's header line. Those rules search backwards (LOOK_BACK lines) or in the task's body.
 */
import type { TjpFile } from './document';
import { contentAtOrBefore, contentSpan, type LineSpan, type Span } from './diagnostics-lines';
import {
	headerOf,
	LineSearch,
	ownAttributes,
	pickForScenario,
	refLeaves,
	sameRef,
	scenarioOf,
} from './diagnostics-find';
import { checkedStatements, statementValueError } from './diagnostics-values';
import type { DependencySite, SymbolIndex } from './index/types';
import { statementKeyword } from './tree';
import { DEFAULT_CONTEXT } from './values';

export interface RefineInput {
	readonly file: TjpFile;
	/** The engine line, in the scheduled text. */
	readonly line: LineSpan;
	readonly id: string;
	readonly text: string;
	readonly scenario: string | null;
	/** An index of the scheduled snapshot, or null. */
	readonly index: SymbolIndex | null;
}

export interface Refined extends Span {
	precision: 'token' | 'statement' | 'line';
}

class Ctx extends LineSearch {
	constructor(readonly input: RefineInput) {
		super(input.file, input.line);
	}
	match(re: RegExp): RegExpExecArray | null {
		return re.exec(this.input.text);
	}
}

type Rule = (c: Ctx) => Refined | null;

const token = (s: Span | null): Refined | null =>
	s && { from: s.from, to: s.to, precision: 'token' };
const statement = (s: Span | null): Refined | null =>
	s && { from: s.from, to: s.to, precision: 'statement' };

// --- Rules on the line itself -------------------------------------------------------------

/** `Unexpected token 'X' found`: the token X; `<END>` is the end of the content. */
const unexpectedToken: Rule = (c) => {
	const x = c.match(/Unexpected token '(.*?)' found/)?.[1];
	if (x === undefined) return null;
	if (x === '<END>') {
		const end = c.text.trimEnd().length;
		return token({ from: end, to: end });
	}
	return token(c.token(x));
};

/** `Unexpected characters found: '  foo...'`: the token where the shown text starts. */
const unexpectedChars: Rule = (c) => {
	const shown = c.match(/found: '([\s\S]*?)(?:\.\.\.)?'$/)?.[1]?.trim() ?? '';
	const lineText = c.slice(c.line);
	const at = shown === '' ? -1 : lineText.indexOf(shown);
	if (at >= 0) {
		const pos = c.line.from + at;
		const leaf = c.leaves.find((l) => l.from <= pos && pos < l.to);
		return token(
			leaf
				? { from: pos, to: Math.min(leaf.to, c.line.to) }
				: { from: pos, to: pos + shown.length },
		);
	}
	return token(c.onLine(c.leafNamed('ScanError', 'UnknownWord')));
};

/** An unterminated token: from its start to the end of the line. */
const scanError: Rule = (c) => {
	return token(c.onLine(c.leafNamed('ScanError')));
};

/** The first quoted text that is a token on the line. */
const quotedToken: Rule = (c) => {
	for (const m of c.input.text.matchAll(/'([^'\s]+)'/g)) {
		const hit = c.token(m[1] ?? '');
		if (hit) return token(hit);
	}
	return null;
};

/** A macro call on the line: the engine reports expanded text at the call's line (5.4). */
const macroCall: Rule = (c) => {
	const call = c.leafNamed('MacroCall', 'MacroWord');
	return token(call && { from: call.from, to: Math.min(call.to, c.line.to) });
};

/** A value error of a typed statement on the line, else the only statement on it. */
const valueOnLine: Rule = (c) => {
	const idx = c.input.index;
	for (const stmt of checkedStatements(c.file, c.line.from, c.line.to)) {
		if (stmt.from < c.line.from || stmt.from > c.line.to) continue;
		const ctx = idx ? idx.contextAt(c.file.path, stmt.from) : DEFAULT_CONTEXT;
		const e = statementValueError(c.file, stmt, ctx);
		if (e) return token(e);
	}
	const on = c.statementsOnLine();
	return on.length === 1 ? statement(on[0] ?? null) : null;
};

const keywordStatement =
	(...keywords: string[]): Rule =>
	(c) =>
		statement(c.statementBefore(keywords));

/** `… attribute <name> …`: the nearest statement setting that attribute. */
const namedAttribute: Rule = (c) => {
	const name = c.match(/attribute (\w+)/)?.[1];
	return name ? statement(c.statementBefore([name])) : null;
};

const macroRedefined: Rule = (c) => {
	const name = c.match(/Redefining macro (\w+)/)?.[1];
	return name ? token(c.macroBefore(name)) : null;
};

/** `macro_stack` infos quote the call (`  ${name args}`): the definition or the call. */
const macroStack: Rule = (c) => {
	const name = c.match(/\$\{\s*\??(\w+)/)?.[1];
	if (!name) return null;
	const def = c.macroBefore(name);
	if (def && def.from >= c.line.from) return token(def);
	const call = c.leaves.find((l) => l.name === 'MacroCall' && c.slice(l).includes(name));
	return token(call ? { from: call.from, to: Math.min(call.to, c.line.to) } : null);
};

const declId =
	(kind: 'task' | 'resource'): Rule =>
	(c) => {
		const id = c.match(/^(?:Task|Resource) (\S+) has already been defined/)?.[1] ?? null;
		const d = c.decl(kind, id);
		return token(d?.getChild('Id') ?? null);
	};

/** The include statement's file name, or the statement. */
const includeFile: Rule = (c) => {
	const name = c.match(/include file (.+)$/)?.[1];
	const s = c.statementBefore(['include']);
	if (!s) return null;
	const str = s.getChild('String') ?? s.getChild('TemplateString');
	if (name && str && c.slice(str).includes(name)) return token(str);
	return statement(s);
};

// --- Rules about a task's body ------------------------------------------------------------

/** The statement of attribute `keywords` for task `id` (header on the line), for the scenario. */
function taskAttribute(c: Ctx, id: string | null, keywords: readonly string[]): Refined | null {
	const want = new Set(keywords);
	const sym = id === null ? undefined : c.input.index?.tasks.get(id);
	if (sym) {
		const sites = sym.attrs.filter((a) => want.has(a.keyword) && a.statement.file === c.file.path);
		const site = pickForScenario(sites, (a) => a.scenario, c.input.scenario);
		if (site) return statement(site.statement);
	}
	const d = c.decl('task', id);
	if (!d) return null;
	const own = ownAttributes(d).filter((s) => want.has(statementKeyword(s, c.text) ?? ''));
	const s = pickForScenario(own, (x) => scenarioOf(x, c.text), c.input.scenario);
	return statement(s ?? headerOf(d));
}

const attributeOfTask =
	(re: RegExp, ...keywords: string[]): Rule =>
	(c) => {
		const id = c.match(re)?.[1] ?? null;
		const kws = keywords.length > 0 ? keywords : [c.input.id];
		return taskAttribute(c, id, kws);
	};

/** The dependency (owner, other) as the message names it. */
function dependencyNames(c: Ctx): { owner: string; other: string | null } | null {
	const t = c.input.text;
	let m = /^Task (\S+) has unknown (?:depends|precedes) (\S+)$/.exec(t);
	if (m) return { owner: m[1] ?? '', other: m[2] ?? '' };
	m = /^Task (\S+) \(.*\) must (?:start|end) .* of task (\S+?)\. This condition/.exec(t);
	if (m) return { owner: m[1] ?? '', other: m[2] ?? '' };
	m = /^Task (\S+) cannot depend on (?:child|parent) (\S+)$/.exec(t);
	if (m) return { owner: m[1] ?? '', other: m[2] ?? '' };
	m = /^No need to specify dependency (\S+) multiple times for task (\S+?)\.$/.exec(t);
	if (m) return { owner: m[2] ?? '', other: m[1] ?? '' };
	m = /^Task (\S+) cannot depend on self$/.exec(t);
	if (m) return { owner: m[1] ?? '', other: m[1] ?? '' };
	return null;
}

const ownerOf = (d: DependencySite) => (d.form === 'depends' ? d.succ : d.pred);
const otherOf = (d: DependencySite) => (d.form === 'depends' ? d.pred : d.succ);

/** A dependency message: the reference token in the owner's `depends`/`precedes`. */
const dependencyRef: Rule = (c) => {
	const names = dependencyNames(c);
	if (!names) return null;
	const { owner, other } = names;
	const deps = c.input.index?.dependencies.filter(
		(d) =>
			ownerOf(d) === owner &&
			d.ref.file === c.file.path &&
			(other === null ||
				otherOf(d) === other ||
				(otherOf(d) === null && sameRef(d.written, other))),
	);
	if (deps && deps.length > 0) {
		const on = deps.find((d) => d.ref.from >= c.line.from && d.ref.from <= c.line.to);
		return token((on ?? deps[0])?.ref ?? null);
	}
	const decl = c.decl('task', owner);
	if (!decl) return null;
	const refs = refLeaves(decl, new Set(['TaskRef']));
	const hit = refs.find((r) => other !== null && sameRef(c.slice(r), other)) ?? null;
	return token(hit) ?? statement(headerOf(decl));
};

/** `<id> is not a defined resource.`: the reference on the line, else in the task's body. */
const resourceRef: Rule = (c) => {
	const id = c.match(/^(\S+) is not a (?:defined|leaf) resource/)?.[1];
	if (id === undefined) return null;
	const on = c.token(id);
	if (on) return token(on);
	const decl = c.decl(null, null);
	if (!decl) return null;
	const refs = refLeaves(decl, new Set(['ResourceRef']));
	return token(refs.find((r) => c.slice(r) === id) ?? null);
};

const unknownTask: Rule = (c) => {
	const id = c.match(/^Unknown task (\S+)$/)?.[1];
	if (id === undefined) return null;
	const leaf = c.leaves.find((l) => sameRef(c.slice(l), id) && /^[!\w.]+$/.test(c.slice(l)));
	return token(leaf ?? null);
};

/** A message that names a task or resource whose header is on the line: the header. */
const namedHeader: Rule = (c) => {
	const m = c.match(/\b([Tt]ask|[Rr]esource) ([\w.]+?)(?=[\s,.:;()']|$)/);
	if (!m) return null;
	const kind = (m[1] ?? '').toLowerCase() === 'task' ? 'task' : 'resource';
	const d = c.decl(kind, m[2] ?? null);
	return statement(d && headerOf(d));
};

// --- The table ----------------------------------------------------------------------------

const VALUE: Rule[] = [valueOnLine];
const CONSTRAINT = attributeOfTask(/of task (\S+) is too/);

/** Rules per TaskJuggler message id, tried before the generic rules. */
export const RULES: Readonly<Record<string, readonly Rule[]>> = {
	no_reduce: [unexpectedToken],
	unexpctd_token: [unexpectedToken],
	no_token_match: [unexpectedChars],
	runaway_token: [scanError],
	junk_after_cut: [valueOnLine, scanError],
	marco_redefinition: [macroRedefined],
	macro_stack: [macroStack],
	attr_overwrite: [namedAttribute],
	container_attribute: [namedAttribute],
	purge_unknown_id: [quotedToken],
	multiple_durations: [keywordStatement('effort', 'duration', 'length', 'milestone')],
	task_exists: [declId('task')],
	resource_exists: [declId('resource')],
	task_depend_unknown: [dependencyRef],
	task_depend_self: [dependencyRef],
	task_depend_child: [dependencyRef],
	task_depend_parent: [dependencyRef],
	task_depend_multi: [dependencyRef],
	task_pred_before: [dependencyRef],
	task_succ_after: [dependencyRef],
	resource_id_expected: [resourceRef],
	leaf_resource_id_expected: [resourceRef],
	unknown_task: [unknownTask],
	minstart: [CONSTRAINT],
	maxstart: [CONSTRAINT],
	minend: [CONSTRAINT],
	maxend: [CONSTRAINT],
	effort_no_allocations: [attributeOfTask(/^Task (\S+) has an effort/, 'effort')],
	overbooked_effort: [attributeOfTask(/for task (\S+) exceeds/, 'effort')],
	overbooked_length: [attributeOfTask(/for task (\S+) exceeds/, 'length')],
	overbooked_duration: [attributeOfTask(/for task (\S+) exceeds/, 'duration')],
	bad_include: [includeFile],
	include_before_project: [keywordStatement('include')],
	include_recursion: [keywordStatement('include')],
	too_large_timing_res: [valueOnLine, keywordStatement('timingresolution')],
	bad_timing_res: [valueOnLine, keywordStatement('timingresolution')],
	bad_time_zone: [valueOnLine, keywordStatement('timezone')],
	date_in_range: VALUE,
	interval_start_in_range: VALUE,
	interval_end_in_range: VALUE,
	misaligned_date: VALUE,
	start_before_end: VALUE,
	effort_zero: VALUE,
	working_duration_too_small: VALUE,
	task_complete: VALUE,
	task_priority: VALUE,
	time_error: VALUE,
	time_interval: VALUE,
	time_bad_time: VALUE,
	bad_workinghours: VALUE,
	too_many_bangs: [unexpectedToken, keywordStatement('depends', 'precedes')],
};

const GENERIC: readonly Rule[] = [quotedToken, macroCall, namedHeader];

/** The content of the line, or of the nearest line before it with content. */
function lineFallback(c: Ctx): Refined {
	const own = contentSpan(c.file.tree, c.text, c.line);
	if (own) return { ...own, precision: 'line' };
	const before = contentAtOrBefore(c.file.tree, c.file.text, c.line.number - 1);
	if (before) return { from: before.from, to: before.to, precision: 'line' };
	return { from: c.line.from, to: c.line.from, precision: 'line' };
}

/** The range of one engine message in the scheduled text of its file. */
export function refineMessage(input: RefineInput): Refined {
	const c = new Ctx(input);
	for (const rule of [...(RULES[input.id] ?? []), ...GENERIC]) {
		const r = rule(c);
		if (r && r.from <= r.to && r.from >= 0 && r.to <= c.text.length) return r;
	}
	return lineFallback(c);
}
