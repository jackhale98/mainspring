// SPDX-License-Identifier: GPL-2.0-only
// Follows TaskJuggler's TjpSyntaxRules.rb at 3b36c79 (ADR-0001 addendum).
/**
 * Statement keywords that TaskJuggler 3.8.4 accepts but its SyntaxReference, and so the generated
 * keyword table, leaves out (TjpSyntaxRules.rb at 3b36c79). Without them a valid file would get
 * error nodes. They are recognised as keywords of opaque statements only; completion and hover do
 * not offer them.
 *
 * - Deprecated forms (`level(:deprecated)`): `shift` in task, resource and allocation bodies
 *   (rule_taskShiftAssignments and friends), `startcredit`/`endcredit`, a scenario's `enabled`,
 *   `disabled` and `projection { sloppy | strict }`.
 * - `leaveallowances`, which the reference documents under the id `leaveallowance`.
 */
import { bodyContext, resolveKeyword, type ContextId, type KeywordEntry } from '../syntax/keywords';

interface Extra {
	readonly entry: KeywordEntry;
	/** The context its body opens, if it has one. */
	readonly body: ContextId | null;
}

function extra(
	keyword: string,
	contexts: readonly ContextId[],
	syntax: string,
	body: ContextId | null = null,
): Extra {
	const name = keyword.split('.')[0] ?? keyword;
	return {
		entry: { keyword, name, contexts, scenarioSpecific: false, syntax, summary: '' },
		body,
	};
}

const TASK = ['supplement.task', 'task'];
const RESOURCE = ['resource', 'supplement.resource'];

const EXTRAS: readonly Extra[] = [
	extra('shift.task', TASK, 'shift <shift> [<interval2>]'),
	extra('shift.resource', RESOURCE, 'shift <shift> [<interval2>]'),
	extra('shift.allocate', ['allocate'], 'shift <shift> [<interval2>]'),
	extra('startcredit', TASK, 'startcredit <amount>'),
	extra('endcredit', TASK, 'endcredit <amount>'),
	extra('enabled', ['scenario'], 'enabled'),
	extra('disabled', ['scenario'], 'disabled'),
	extra('projection', ['scenario'], 'projection [{ <attributes> }]', 'projection'),
	extra('sloppy.projection', ['projection'], 'sloppy'),
	extra('strict.projection', ['projection'], 'strict'),
	extra('leaveallowances', RESOURCE, 'leaveallowances <leave allowance> [, ...]'),
];

const byContext = new Map<ContextId, Map<string, Extra>>();
const byKeyword = new Map<string, Extra>();
for (const e of EXTRAS) {
	byKeyword.set(e.entry.keyword, e);
	for (const c of e.entry.contexts) {
		let names = byContext.get(c);
		if (!names) byContext.set(c, (names = new Map()));
		names.set(e.entry.name, e);
	}
}

/** The keyword `name` is in `context`: the table's entry, else one of the extras above. */
export function resolveHeadKeyword(name: string, context: ContextId): KeywordEntry | null {
	return resolveKeyword(name, context) ?? byContext.get(context)?.get(name)?.entry ?? null;
}

/** The context the body of a statement led by `entry` opens (see bodyContext). */
export function headBodyContext(entry: KeywordEntry, subject?: string): ContextId | null {
	const e = byKeyword.get(entry.keyword);
	if (e && e.entry === entry) return e.body;
	return bodyContext(entry, subject);
}

/** The extra keywords, for tests. */
export const EXTRA_KEYWORDS: readonly KeywordEntry[] = EXTRAS.map((e) => e.entry);
