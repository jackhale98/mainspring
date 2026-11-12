// SPDX-License-Identifier: GPL-2.0-or-later
// One file through the round trip (phase-1.md 9.1): decode as the app does (ADR-0002 #13), parse
// through the workspace, print the tree, re-encode and compare. Also the coverage checks: error
// nodes, typed statements, MVP keywords left opaque, and typed values that fail to parse.
import type { SyntaxNode } from '@lezer/common';
import { checkedStatements } from '../../src/lib/tjp/diagnostics-values';
import type { TjpFile } from '../../src/lib/tjp/document';
import { headBodyContext, resolveHeadKeyword } from '../../src/lib/tjp/grammar/keyword-extras';
import { OPAQUE_STATEMENTS, typedStatementOf } from '../../src/lib/tjp/grammar/parser';
import { isContext, topContextId, type ContextId } from '../../src/lib/tjp/syntax/keywords';
import { printTree, statementHead, syntaxIssues } from '../../src/lib/tjp/tree';
import { KEYWORD_VALUE_KIND, hasExpansion, parseValue } from '../../src/lib/tjp/values';

export interface FileRow {
	corpus: string;
	plan: string;
	/** Repository-relative path. */
	file: string;
	bytes: number;
	/** The parse context the include site gave the file. */
	top: string;
	/** 'bytes': re-encoded bytes equal the file; 'text': equal after decoding (invalid UTF-8). */
	comparison: 'bytes' | 'text';
	errorNodes: number;
	firstErrorLine: number | null;
	typedStatements: number;
	opaqueStatements: number;
	valuesChecked: number;
	/** Problems found; empty means the file passed every check. */
	problems: string[];
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const encoder = new TextEncoder();

/** First index where two byte arrays differ, or -1 when equal. */
export function firstDifference(a: Uint8Array, b: Uint8Array): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
	return a.length === b.length ? -1 : n;
}

export const decode = (bytes: Uint8Array): string => decoder.decode(bytes);

interface Coverage {
	typed: number;
	opaque: number;
	problems: string[];
}

/** Statement tallies, and typed keywords left opaque, walking the contexts the tree implies. */
function statementCoverage(file: TjpFile, text: string): Coverage {
	const out: Coverage = { typed: 0, opaque: 0, problems: [] };
	const visit = (parent: SyntaxNode, ctx: ContextId | null): void => {
		for (let s = parent.firstChild; s; s = s.nextSibling) {
			if (!s.name.endsWith('Statement')) continue;
			const head = statementHead(s);
			let body: ContextId | null = null;
			const opaque = OPAQUE_STATEMENTS.has(s.name);
			if (opaque) out.opaque++;
			else out.typed++;
			if (head?.name === 'Keyword' && ctx !== null) {
				const word = text.slice(head.from, head.to);
				const entry = resolveHeadKeyword(word, ctx);
				if (entry) {
					if (opaque && typedStatementOf(entry.keyword) !== null) {
						out.problems.push(`${word}@${head.from} is a typed keyword left opaque`);
					}
					const kind = s.getChild('SupplementKind');
					const subject = kind ? text.slice(kind.from, kind.to) : undefined;
					body = headBodyContext(entry, subject);
					if (body === null && subject !== undefined && isContext(subject)) body = subject;
				}
			}
			for (let c = s.firstChild; c; c = c.nextSibling) {
				if (c.name === 'Body') visit(c, body);
				else for (const b of c.getChildren('Body')) visit(b, body);
			}
		}
	};
	visit(file.tree.topNode, topContextId(file.top));
	return out;
}

/** Typed value slots of a file: each statement without macro text must parse to a typed value. */
function valueCheck(file: TjpFile, text: string): { checked: number; problems: string[] } {
	const problems: string[] = [];
	let checked = 0;
	for (const stmt of checkedStatements(file)) {
		const head = statementHead(stmt);
		const first = head?.nextSibling;
		if (!head || !first) continue;
		const word = text.slice(head.from, head.to);
		const kind = KEYWORD_VALUE_KIND[word];
		const value = text.slice(first.from, stmt.to);
		if (!kind || hasExpansion(value) || /\$\{|\[/.test(value)) continue;
		checked++;
		const r = parseValue(kind, value, first.from);
		if (!r.ok) problems.push(`${word}@${first.from}: ${r.error.code} (${kind})`);
	}
	return { checked, problems };
}

/**
 * Checks one workspace file against its bytes. `expectedErrorLine` is the line of the first error
 * node a negative file must have, or null for a file that must have none. `invalidUtf8` files are
 * compared as text after decoding (ADR-0003 #1): U+FFFD cannot give the bad bytes back.
 */
export function checkFile(
	meta: { corpus: string; plan: string; file: string },
	bytes: Uint8Array,
	file: TjpFile,
	expectedErrorLine: number | null,
	invalidUtf8: boolean,
): FileRow {
	const problems: string[] = [];
	const decoded = decode(bytes);
	if (file.text.toString() !== decoded)
		problems.push('workspace text differs from the decoded file');
	let printed = '';
	try {
		printed = printTree(file.tree, decoded);
	} catch (e) {
		problems.push(`printTree threw: ${(e as Error).message}`);
	}
	if (printed !== decoded) problems.push('printed tree differs from the decoded text');
	if (invalidUtf8) {
		// ADR-0003 #1: text-exact only. The exemption must be real, or the file belongs in the gate.
		if (!decoded.includes('�')) problems.push('expected U+FFFD from invalid UTF-8');
	} else {
		const diff = firstDifference(encoder.encode(printed), bytes);
		if (diff >= 0) problems.push(`re-encoded bytes differ at byte ${diff}`);
	}
	const issues = syntaxIssues(file.tree, file.text);
	const first = issues[0]?.line ?? null;
	if (expectedErrorLine === null) {
		if (issues.length > 0) problems.push(`${issues.length} error node(s), first at line ${first}`);
	} else if (first !== expectedErrorLine) {
		problems.push(`first error node on line ${first}, expected ${expectedErrorLine}`);
	}
	const cover = statementCoverage(file, decoded);
	const valid = expectedErrorLine === null;
	const values = valid ? valueCheck(file, decoded) : { checked: 0, problems: [] };
	if (valid) problems.push(...cover.problems, ...values.problems);
	return {
		...meta,
		bytes: bytes.length,
		top: file.top,
		comparison: invalidUtf8 ? 'text' : 'bytes',
		errorNodes: issues.length,
		firstErrorLine: first,
		typedStatements: cover.typed,
		opaqueStatements: cover.opaque,
		valuesChecked: values.checked,
		problems,
	};
}
