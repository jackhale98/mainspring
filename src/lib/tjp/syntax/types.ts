// SPDX-License-Identifier: GPL-2.0-or-later
// Types and context ids shared by the keyword table and its lookups (spec 6.3). Kept apart from
// keywords.ts so that the generated table can import them without a cycle.

/**
 * Where a statement sits: a scoped keyword id from KEYWORDS whose body holds it ('task',
 * 'limits.task', 'supplement.resource'), GLOBAL_CONTEXT for the top level of a file, or
 * PROLOG_CONTEXT for the top level of a file included before the `project` header.
 */
export type ContextId = string;

/**
 * The top level of a file that is not included elsewhere, or is included after the `project`
 * header: TaskJuggler's "properties", plus `project` itself. The table does not encode that the
 * header comes first; the engine reports that.
 */
export const GLOBAL_CONTEXT: ContextId = '';

/**
 * The top level of a file included before the `project` header, which TaskJuggler reads as
 * prolog: only `macro` and `include` (of macro files) (TjpSyntaxRules.rb, rule_prologInclude).
 * The angle brackets keep it apart from every keyword id.
 */
export const PROLOG_CONTEXT: ContextId = '<prolog>';

/** The context a file is parsed in at its top level (spec 5.2 and 6.1). */
export type TopContextName = 'global' | 'project' | 'prolog';

export interface KeywordEntry {
	/** Scoped id, as KeywordDoc.keyword ('booking.task'). Unique. */
	readonly keyword: string;
	/** The keyword as written ('booking'). */
	readonly name: string;
	/** Where it may appear, sorted. Empty for documentation-only entries such as 'functions'. */
	readonly contexts: readonly ContextId[];
	/** Whether it accepts a scenario prefix ('delayed:effort'). */
	readonly scenarioSpecific: boolean;
	/** TaskJuggler's syntax line, e.g. "effort <value> (min | h | d | w | m | y)". */
	readonly syntax: string;
	/** The first sentence of TaskJuggler's documentation. */
	readonly summary: string;
}
