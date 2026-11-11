// SPDX-License-Identifier: GPL-2.0-or-later
// Lookups over the committed keyword table (spec 6.3). The tokenizer asks resolveKeyword() whether
// an identifier is a keyword in the current context, the context tracker asks bodyContext() which
// context a statement's body opens, and completion lists keywordsInContext(). All of it works
// before the engine boots; docs.ts adds the engine's full documentation once syntax() resolves.
import { KEYWORDS, TJ_COMMIT, TJ_VERSION } from './keywords.generated';
import {
	GLOBAL_CONTEXT,
	PROLOG_CONTEXT,
	type ContextId,
	type KeywordEntry,
	type TopContextName,
} from './types';

export { KEYWORDS, TJ_COMMIT, TJ_VERSION };
export { GLOBAL_CONTEXT, PROLOG_CONTEXT };
export type { ContextId, KeywordEntry, TopContextName };

const byId = new Map<string, KeywordEntry>();
/** context -> name as written -> entry. The generator guarantees one entry per pair. */
const byContext = new Map<ContextId, Map<string, KeywordEntry>>();
/** context -> entries sorted by name, for completion. */
const listed = new Map<ContextId, readonly KeywordEntry[]>();

for (const entry of KEYWORDS) {
	byId.set(entry.keyword, entry);
	for (const context of entry.contexts) {
		let names = byContext.get(context);
		if (!names) byContext.set(context, (names = new Map()));
		names.set(entry.name, entry);
	}
}
for (const [context, names] of byContext) {
	listed.set(
		context,
		[...names.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
	);
}

/** Every context some keyword may appear in, sorted. */
export const CONTEXTS: readonly ContextId[] = [...byContext.keys()].sort();

/** The entry with this scoped id ('booking.task'), or null. */
export function keywordById(keyword: string): KeywordEntry | null {
	return byId.get(keyword) ?? null;
}

/**
 * The keyword that `name`, as written, means in `context` ('booking' in 'resource' is
 * 'booking.resource'), or null when it is not a keyword there. Case-sensitive, as TaskJuggler.
 */
export function resolveKeyword(name: string, context: ContextId): KeywordEntry | null {
	return byContext.get(context)?.get(name) ?? null;
}

/** The keywords valid in `context`, sorted by name; only the scenario-specific ones if asked. */
export function keywordsInContext(
	context: ContextId,
	opts: { scenarioSpecificOnly?: boolean } = {},
): readonly KeywordEntry[] {
	const all = listed.get(context) ?? [];
	return opts.scenarioSpecificOnly ? all.filter((e) => e.scenarioSpecific) : all;
}

/**
 * Whether `name` in `context` is a scenario-specific attribute, so that it accepts a scenario
 * prefix ('delayed:effort'). False when it is not a keyword there.
 */
export function isScenarioSpecific(name: string, context: ContextId): boolean {
	return resolveKeyword(name, context)?.scenarioSpecific ?? false;
}

/** Whether some keyword may appear in the body of the keyword with this scoped id. */
export function isContext(keyword: string): boolean {
	return byContext.has(keyword);
}

/**
 * The context that the body of a statement led by `entry` opens, or null when its body has no
 * keywords of its own. `subject` is the statement's first argument; it matters only for keywords
 * that are not contexts themselves but whose body is ('supplement task' opens 'supplement.task').
 */
export function bodyContext(entry: KeywordEntry, subject?: string): ContextId | null {
	if (isContext(entry.keyword)) return entry.keyword;
	if (subject !== undefined) {
		const scoped = `${entry.keyword}.${subject}`;
		if (isContext(scoped)) return scoped;
	}
	return null;
}

/** The context at the top level of a file parsed with this top context (spec 5.2). */
export function topContextId(top: TopContextName): ContextId {
	switch (top) {
		case 'global':
			return GLOBAL_CONTEXT;
		case 'project':
			return 'project';
		case 'prolog':
			return PROLOG_CONTEXT;
	}
}
