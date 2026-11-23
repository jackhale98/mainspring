// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * TJP-aware hints for the merge (phase-4.md 6.4 rule 2; types.ts): what a statement is keyed by
 * across the three sides, which statements are blocks, and the owner a conflict names.
 *
 * - **Keys.** A statement's key is its keyword with its scenario prefix (`delayed:effort`), and for
 *   a declaration its id (`task:api`, `resource:dev`, `macro:m`, `supplement:task:a.b`,
 *   `include:"x.tji"`, `scenario:plan`, `account:cost`). A statement-level macro call has none:
 *   it is matched only by its text. Keys are compared as written, so a macro id keys by its text.
 * - **Blocks** are `task`, `resource`, `project` and `supplement` statements: the merge enters
 *   their bodies (refinement), and a deleted or doubly added one is a `block` conflict. A
 *   supplement's owner is the task or resource it supplements, without a name.
 * - **Owners.** The full id as the symbol index forms it: the ids of the enclosing declarations of
 *   the same kind, under the prefix in force in the file's first visit (includes.ts: the
 *   `@property` an include site leaves applies before the visit's first include, else the
 *   `taskprefix`/`resourceprefix`). A macro id on the way, or an unknown prefix, gives null. A
 *   resource declaration's id is its own: resource ids are global (TjpSyntaxRules.rb 4796-4810).
 */
import type { SyntaxNode } from '@lezer/common';
import type { IncludeGraph } from '../../workspace/includes';
import type { WorkspacePath } from '../../workspace/paths';
import { MACRO_TOKENS } from '../grammar/parser';
import { statementHead } from '../tree';
import { parseString } from '../values/string-literal';
import type { Owner } from './types';

export type BlockKind = 'task' | 'resource' | 'project' | 'supplement';

const BLOCKS: Readonly<Record<string, BlockKind>> = {
	TaskStatement: 'task',
	ResourceStatement: 'resource',
	ProjectStatement: 'project',
	SupplementStatement: 'supplement',
};

/** Opaque keywords whose first argument names what they declare. */
const DECLARING: ReadonlySet<string> = new Set([
	'account',
	'shift',
	'scenario',
	'extend',
	'taskreport',
	'resourcereport',
	'textreport',
	'tracereport',
	'accountreport',
	'icalreport',
	'nikureport',
	'statussheetreport',
	'timesheetreport',
	'tagfile',
	'export',
	'timesheet',
	'statussheet',
	'journalentry',
]);

export const OTHER: Owner = { kind: 'other', id: null, name: null };

export function blockKind(stmt: SyntaxNode): BlockKind | null {
	return BLOCKS[stmt.name] ?? null;
}

const slice = (n: { from: number; to: number }, text: string): string => text.slice(n.from, n.to);

/** The keyword (or extension attribute name) with its scenario prefix: `delayed:effort`. */
export function attrName(stmt: SyntaxNode, text: string): string {
	const first = stmt.firstChild;
	const prefix = first?.name === 'ScenarioPrefix' ? slice(first, text) : '';
	const head = statementHead(stmt);
	return prefix + (head ? slice(head, text) : '');
}

/** The statement's key (module comment), or null for a statement-level macro call. */
export function statementKey(stmt: SyntaxNode, text: string): string | null {
	const head = statementHead(stmt);
	if (!head || stmt.name === 'MacroCallStatement') return null;
	if (head.name !== 'Keyword' && head.name !== 'AttributeName') return null;
	const attr = attrName(stmt, text);
	const child = (name: string): string | null => {
		const c = stmt.getChild(name);
		return c ? slice(c, text) : null;
	};
	switch (stmt.name) {
		case 'TaskStatement':
		case 'ResourceStatement': {
			const id = child('Id');
			return id === null ? attr : `${attr}:${id}`;
		}
		case 'ProjectStatement':
			return attr;
		case 'SupplementStatement':
			return `${attr}:${child('SupplementKind') ?? ''}:${child('Ref') ?? ''}`;
		case 'IncludeStatement':
		case 'MacroStatement': {
			const arg = head.nextSibling;
			return arg ? `${attr}:${slice(arg, text)}` : attr;
		}
		case 'OpaqueStatement': {
			const arg = head.nextSibling;
			const kw = slice(head, text);
			return DECLARING.has(kw) && arg && (arg.name === 'Identifier' || arg.name === 'String')
				? `${attr}:${slice(arg, text)}`
				: attr;
		}
		default:
			return attr;
	}
}

/** A string token's value, or null for a templated or broken one. */
function unquote(raw: string): string | null {
	const q = raw[0];
	if ((q === '"' || q === "'") && raw.length >= 2 && raw.endsWith(q) && !raw.includes('\\')) {
		return raw.slice(1, -1);
	}
	const r = parseString(raw);
	return r.ok ? r.value : null;
}

/** What owner ids need besides the tree: the file and ours' include graph. */
export class Naming {
	private visit: IncludeGraph['visits'][number] | null | undefined;
	private firstInclude = Infinity;

	constructor(
		readonly file: WorkspacePath,
		private readonly includes: IncludeGraph,
	) {}

	/** The prefix of a top-level declaration of `kind` at `pos`: '' for none, null when unknown. */
	prefix(kind: 'task' | 'resource', pos: number): string | null {
		if (this.visit === undefined) {
			this.visit = this.includes.visits.find((v) => v.file === this.file) ?? null;
			const v = this.visit;
			if (v) {
				for (const e of this.includes.edges) {
					if (e.parentVisit === v.index)
						this.firstInclude = Math.min(this.firstInclude, e.site.from);
				}
			}
		}
		const v = this.visit;
		if (!v) return '';
		if (v.property && v.property.kind === kind && pos < this.firstInclude) return v.property.id;
		if (kind === 'task') return v.taskPrefixUnknown ? null : (v.taskPrefix ?? '');
		return v.resourcePrefixUnknown ? null : (v.resourcePrefix ?? '');
	}

	/** The owner a block statement names (types.ts `Owner`); `other` for anything else. */
	owner(stmt: SyntaxNode | null, text: string): Owner {
		let kind = stmt ? blockKind(stmt) : null;
		if (!stmt || !kind) return OTHER;
		if (kind === 'supplement') {
			const sk = stmt.getChild('SupplementKind');
			const k = sk ? slice(sk, text) : '';
			if (k !== 'task' && k !== 'resource') return OTHER;
			kind = k;
		}
		const nameNode = stmt.getChild('Name')?.firstChild ?? null;
		const name = nameNode?.name === 'String' ? unquote(slice(nameNode, text)) : null;
		return { kind, id: this.fullId(stmt, kind, text), name };
	}

	private fullId(
		stmt: SyntaxNode,
		kind: 'task' | 'resource' | 'project',
		text: string,
	): string | null {
		const literal = (n: SyntaxNode | null): string | null => {
			const leaf = n?.firstChild ?? null;
			return leaf && !MACRO_TOKENS.has(leaf.name) ? slice(leaf, text) : null;
		};
		if (kind === 'project') return literal(stmt.getChild('Id'));
		// Resource ids are global: a declaration's id is its own, without its parents or the
		// resource prefix (rule_resourceHeader, TjpSyntaxRules.rb 4796-4810).
		if (kind === 'resource' && stmt.name === 'ResourceStatement') {
			return literal(stmt.getChild('Id'));
		}
		const ids: string[] = [];
		let top: SyntaxNode = stmt;
		for (let n: SyntaxNode | null = stmt; n; n = n.parent) {
			if (blockKind(n) === kind) {
				const id = literal(n.getChild('Id'));
				if (id === null) return null;
				ids.unshift(id);
				top = n;
			} else if (n.name === 'SupplementStatement') {
				const sk = n.getChild('SupplementKind');
				if (!sk || slice(sk, text) !== kind) continue;
				const ref = literal(n.getChild('Ref'));
				if (ref === null) return null;
				ids.unshift(ref);
				top = n;
			}
		}
		const prefix = this.prefix(kind, top.from);
		if (prefix === null) return null;
		return [prefix, ...ids].filter((s) => s !== '').join('.');
	}
}
