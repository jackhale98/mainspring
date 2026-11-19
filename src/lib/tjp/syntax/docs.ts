// SPDX-License-Identifier: GPL-2.0-or-later
// Keyword documentation for hover and the phone docs sheet (spec 6.3, 6.7): the committed table
// alone until the engine's docs load, then its full doc and "see also". The engine's docs are its
// `syntax()` result, which the engine build ships as a static asset (ADR-0017, engine/docs-asset.ts).
import type { KeywordDoc, SyntaxDocs } from '../../../engine/protocol';
import { KEYWORDS, keywordById, TJ_VERSION } from './keywords';
import { SUMMARIES } from './summaries.generated';
import type { KeywordEntry } from './types';

/** The engine's docs once they have loaded; the table alone before that. */
export interface KeywordDocsSource {
	table: readonly KeywordEntry[];
	engine: SyntaxDocs | null;
	/**
	 * The engine's docs are being fetched (ADR-0017): they may still come. False once they have,
	 * or failed to.
	 */
	loading: boolean;
	/**
	 * A load failed a moment ago and the loader will not try again yet (engine/docs-asset.ts
	 * `retryAt`): hover and completion neither start a load nor wait. Omitted: false.
	 */
	coolingDown?: boolean;
}

export type KeywordDocView = KeywordEntry & {
	/** The first sentence: the entry's own, else the committed summaries'. */
	summary: string;
	doc: string | null;
	seeAlso: readonly string[];
	/**
	 * `doc` is null because the engine's docs are still being fetched (they may come); false once
	 * they failed.
	 */
	loading: boolean;
};

const engineIndex = new WeakMap<SyntaxDocs, Map<string, KeywordDoc>>();

/**
 * Whether these engine docs describe the TaskJuggler the table was generated from. Docs from a
 * different version are ignored rather than mixed with the table.
 */
export function engineDocsMatch(engine: SyntaxDocs): boolean {
	return engine.tjVersion === TJ_VERSION;
}

function engineDoc(engine: SyntaxDocs | null, keyword: string): KeywordDoc | null {
	if (!engine || !engineDocsMatch(engine)) return null;
	let index = engineIndex.get(engine);
	if (!index) {
		index = new Map(engine.keywords.map((k) => [k.keyword, k]));
		engineIndex.set(engine, index);
	}
	return index.get(keyword) ?? null;
}

function tableEntry(table: readonly KeywordEntry[], keyword: string): KeywordEntry | null {
	// The usual table is KEYWORDS, which has an index; any other is searched.
	if (table === KEYWORDS) return keywordById(keyword);
	return table.find((e) => e.keyword === keyword) ?? null;
}

/**
 * The documentation for a scoped keyword id ('booking.task'): the table entry, with the engine's
 * full `doc` and `seeAlso` when they have loaded (`doc` is null and `seeAlso` empty before that).
 * The syntax line and summary stay the table's, which CI keeps equal to the engine's. Null for an
 * id that is not in the table.
 */
export function keywordDoc(src: KeywordDocsSource, keyword: string): KeywordDocView | null {
	const entry = tableEntry(src.table, keyword);
	if (!entry) return null;
	const summary = entry.summary ?? SUMMARIES[keyword] ?? '';
	const full = engineDoc(src.engine, keyword);
	if (!full) return { ...entry, summary, doc: null, seeAlso: [], loading: src.loading };
	return { ...entry, summary, doc: full.doc || null, seeAlso: full.seeAlso, loading: false };
}
