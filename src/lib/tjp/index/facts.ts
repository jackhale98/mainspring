// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Per-file facts: what one file's tree says, independent of where it is included. `scan.ts`
 * builds them once per `TjpFile` (cached by object identity, so an unchanged file is never
 * rescanned); `link.ts` reads them for every include visit, adding prefixes, parents, engine
 * hints and resolved references.
 *
 * Ranges are absolute offsets in the file. `AttrSite` objects are built here with the file's
 * own text-only reason; the link copies one only when an enclosing unresolved declaration
 * makes it text-only (X4).
 */
import type { Text } from '@codemirror/state';
import type { TopContext, TjpFile } from '../document';
import type { TextOnly } from '../text-only';
import type { SourceRange } from '../tree';
import { parseIdList, parseValue, type TypedValue, type ValueKind } from '../values';
import type { RangeIndex } from './ranges';
import type { AttrSite, DeclSite, PropertyKind } from './types';

/** An item of a `depends`, `precedes`, `allocate`, `responsible`, `managers` or `flags` list. */
export interface ListItemFact {
	readonly item: SourceRange;
	readonly ref: SourceRange;
	readonly written: string;
	/** Leading `!` count (task references). */
	readonly up: number;
	/** The id or dotted id; null when the reference is a macro token. */
	readonly path: string | null;
	readonly body: SourceRange | null;
	readonly textOnly: TextOnly | null;
}

export interface AttrFact {
	readonly t: 'attr';
	readonly site: LazyAttr;
	readonly items: readonly ListItemFact[];
	/** `ExtensionStatement`: the attribute name token. */
	readonly custom: SourceRange | null;
}

export interface DeclFact {
	readonly t: 'decl';
	readonly kind: PropertyKind;
	readonly site: DeclSite;
	/** 1-based line of the keyword, as TaskJuggler records it. */
	readonly line: number;
	readonly idForm: 'literal' | 'macro' | 'auto';
	readonly localId: string | null;
	readonly name: string | null;
	readonly textOnly: TextOnly | null;
	readonly body: readonly BodyItem[];
}

export interface SupplementFact {
	readonly t: 'supplement';
	/** Null for `supplement account`/`report` and malformed headers. */
	readonly kind: PropertyKind | null;
	readonly site: DeclSite;
	/** The literal reference; null when it is a macro token. */
	readonly written: string | null;
	readonly refAt: SourceRange | null;
	readonly body: readonly BodyItem[];
}

export interface MacroCallFact {
	readonly t: 'macroCall';
	readonly at: SourceRange;
}

export interface IncludeFact {
	readonly t: 'include';
	readonly at: SourceRange;
}

export interface MacroFact {
	readonly t: 'macro';
	readonly name: string | null;
	readonly nameAt: SourceRange;
	readonly statement: SourceRange;
	readonly body: SourceRange;
	readonly text: string;
	readonly nestedCalls: boolean;
	readonly words: ReadonlySet<string>;
}

export interface ProjectFact {
	readonly t: 'project';
	readonly site: DeclSite;
	readonly id: string | null;
	readonly name: string | null;
	readonly version: string | null;
	readonly interval: SourceRange | null;
	/** The interval text when it holds no macro token. */
	readonly intervalText: string | null;
	readonly textOnly: TextOnly | null;
	readonly body: readonly BodyItem[];
}

export interface ScenarioFact {
	readonly t: 'scenario';
	readonly id: string;
	readonly idAt: SourceRange;
	readonly name: string | null;
	readonly statement: SourceRange;
	readonly children: readonly ScenarioFact[];
}

export interface ExtendAttrFact {
	readonly type: string;
	readonly id: string;
	readonly idAt: SourceRange;
	readonly name: string | null;
	readonly statement: SourceRange;
	readonly inherit: boolean;
	readonly scenarioSpecific: boolean;
}

export interface ExtendFact {
	readonly t: 'extend';
	readonly scope: PropertyKind | null;
	readonly statement: SourceRange;
	readonly attrs: readonly ExtendAttrFact[];
}

export type BodyItem =
	| AttrFact
	| DeclFact
	| SupplementFact
	| MacroCallFact
	| IncludeFact
	| MacroFact
	| ProjectFact
	| ScenarioFact
	| ExtendFact;

export interface FileFacts {
	readonly file: TjpFile;
	readonly top: TopContext;
	readonly items: readonly BodyItem[];
	/** The file's text-only ranges with every non-literal id treated as resolved (X4 narrow). */
	readonly ranges: RangeIndex;
	/** Declaration headers per `${kind}:${line}`. */
	readonly headerLines: ReadonlyMap<string, number>;
	/** Outermost macro bodies and opaque statements, for `mentions`. */
	readonly opaque: readonly TextOnly[];
}

interface ParseCell {
	parsed?: TypedValue | null;
	/** The file's own reasons leave the value typed (an X4 copy still parses). */
	readonly parseable: boolean;
}

/** An AttrSite whose value is parsed on first access. Copies share the parse. */
export class LazyAttr implements AttrSite {
	readonly keyword: string;
	readonly scenario: string | null;
	readonly statement: SourceRange;
	readonly value: SourceRange | null;
	readonly site: 'decl' | 'supplement';
	readonly textOnly: TextOnly | null;
	readonly #cell: ParseCell;
	readonly #doc: Text;
	readonly #kind: ValueKind | 'resourceList' | null;

	constructor(
		init: Omit<AttrSite, 'parsed'>,
		doc: Text,
		kind: ValueKind | 'resourceList' | null,
		cell?: ParseCell,
	) {
		this.keyword = init.keyword;
		this.scenario = init.scenario;
		this.statement = init.statement;
		this.value = init.value;
		this.site = init.site;
		this.textOnly = init.textOnly;
		this.#doc = doc;
		this.#kind = kind;
		this.#cell = cell ?? { parseable: init.textOnly === null };
	}

	get parsed(): TypedValue | null {
		if (this.#cell.parsed === undefined) this.#cell.parsed = this.#parse();
		return this.#cell.parsed;
	}

	/** The same site with another text-only reason. */
	withTextOnly(textOnly: TextOnly | null): LazyAttr {
		return new LazyAttr({ ...this, textOnly }, this.#doc, this.#kind, this.#cell);
	}

	#parse(): TypedValue | null {
		const v = this.value;
		const kind = this.#kind;
		if (!v || kind === null || !this.#cell.parseable) return null;
		const text = this.#doc.sliceString(v.from, v.to);
		if (kind === 'resourceList') {
			const r = parseIdList(text, v.from);
			return r.ok ? { kind: 'idList', value: r.value } : null;
		}
		const r = parseValue(kind, text, v.from);
		return r.ok ? r.value : null;
	}
}
