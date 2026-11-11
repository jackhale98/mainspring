// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The external tokenizer of the TJP grammar: TaskJuggler's scanner (tokens.ts) plus the choice of
 * grammar term for each token (phase-1.md 5.2).
 *
 * An identifier becomes a keyword term only when the keyword table (syntax/keywords.ts) has it in
 * the current context (or keyword-extras.ts adds it there) and the parse state can shift it, so an identifier in a value slot, after a
 * `,` or right after a keyword that needs an argument is never a keyword. Tokens that could
 * either continue a statement or start the next one get a separate head term:
 * - keywords, and capitalised extension attributes (`extend task { text Phone … }`, TaskJuggler
 *   requires the capital) in task and resource bodies, start a statement whenever they can;
 * - macro calls and unknown identifiers (in bodies whose context is unknown) start one only when
 *   they cannot continue the current one;
 * - a scenario prefix starts one when a keyword or extension attribute follows it.
 */
import type { Stack } from '@lezer/lr';
import type { ContextId, KeywordEntry } from '../syntax/keywords';
import { resolveHeadKeyword } from './keyword-extras';
import type { TjpFrame } from './context';
import * as T from './parser.terms.generated';
import { TYPED_KEYWORDS } from './terms';
import { TokenFlag } from './token-kinds';
import { tjpExternalTokenizer, type ScannedToken } from './tokens';

const UNITS: ReadonlySet<string> = new Set(['min', 'h', 'd', 'w', 'm', 'y']);
const SUPPLEMENT_KINDS: ReadonlySet<string> = new Set(['task', 'resource', 'account', 'report']);
/** Contexts whose bodies accept extension attributes (TaskJuggler's `extend task|resource`). */
const EXTENSION_CONTEXTS: ReadonlySet<ContextId> = new Set([
	'task',
	'supplement.task',
	'resource',
	'supplement.resource',
]);

const PUNCT: ReadonlyMap<string, number> = new Map([
	['}', T.CloseBrace],
	['(', T.OpenParen],
	[')', T.CloseParen],
	[',', T.Comma],
	['!', T.Bang],
	['-', T.Minus],
	['+', T.Plus],
	['%', T.Percent],
]);

const needsArgument = new Map<string, boolean>();

/**
 * Whether a keyword's syntax line has a mandatory argument after the keyword: what is left once
 * the name and every `[…]` group are removed. 'milestone' and 'limits [{ <attributes> }]' have
 * none; 'task [<id>] <name> [{ … }]' has one.
 */
export function requiresArgument(entry: KeywordEntry): boolean {
	let known = needsArgument.get(entry.keyword);
	if (known === undefined) {
		const syntax = entry.syntax.startsWith(entry.name)
			? entry.syntax.slice(entry.name.length)
			: entry.syntax;
		let depth = 0;
		let rest = '';
		for (const c of syntax) {
			if (c === '[') depth++;
			else if (c === ']') depth = Math.max(0, depth - 1);
			else if (depth === 0) rest += c;
		}
		known = rest.trim() !== '';
		needsArgument.set(entry.keyword, known);
	}
	return known;
}

function isUpper(c: number): boolean {
	return c >= 65 && c <= 90;
}

function frameOf(stack: Stack): TjpFrame {
	return stack.context as TjpFrame;
}

/** Whether `name` would start a statement in `ctx`: a keyword or an extension attribute. */
function isHeadWord(name: string, ctx: ContextId | null): boolean {
	if (ctx === null || name === '') return false;
	if (resolveHeadKeyword(name, ctx)) return true;
	return EXTENSION_CONTEXTS.has(ctx) && isUpper(name.charCodeAt(0));
}

function identifierTerm(name: string, stack: Stack): number {
	const ctx = frameOf(stack).ctx;
	if (ctx !== null) {
		const entry = resolveHeadKeyword(name, ctx);
		if (entry) {
			const term =
				TYPED_KEYWORDS.get(entry.keyword)?.head ?? (requiresArgument(entry) ? T.kwArgs : T.kw);
			if (stack.canShift(term)) return term;
		} else if (
			EXTENSION_CONTEXTS.has(ctx) &&
			isUpper(name.charCodeAt(0)) &&
			stack.canShift(T.AttributeName)
		) {
			return T.AttributeName;
		}
	} else if (!stack.canShift(T.Identifier) && stack.canShift(T.headUnknown)) {
		return T.headUnknown;
	}
	if (UNITS.has(name) && stack.canShift(T.Unit)) return T.Unit;
	if (SUPPLEMENT_KINDS.has(name) && stack.canShift(T.SupplementKind)) return T.SupplementKind;
	return T.Identifier;
}

/** The word after a scenario prefix of `length` code units, skipping blanks. */
function wordAfter(length: number, peek: (offset: number) => number): string {
	let i = length;
	for (let c = peek(i); c === 32 || (c >= 9 && c <= 13); c = peek(++i));
	let s = '';
	for (let c = peek(i); ; c = peek(++i)) {
		const word = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95;
		if (!word) return s;
		s += String.fromCharCode(c);
	}
}

/** A macro token: as a value when the statement can take one, else at the head of the next. */
function macroTerm(stack: Stack, value: number, head: number): number {
	if (stack.canShift(value) || !stack.canShift(head)) return value;
	return head;
}

/** The grammar term for a scanned token (see TjpTermFor in tokens.ts). */
export function termFor(
	token: ScannedToken,
	text: () => string,
	stack: Stack,
	peek: (offset: number) => number,
): number {
	switch (token.kind) {
		case 'Whitespace':
			return T.whitespace;
		case 'LineComment':
			return T.LineComment;
		case 'BlockComment':
			return T.BlockComment;
		case 'Bom':
			return T.Bom;
		case 'Error':
			return T.ScanError;
		case 'Identifier':
			return identifierTerm(text(), stack);
		case 'ScenarioPrefix':
			if (
				stack.canShift(T.headPrefix) &&
				(!stack.canShift(T.ScenarioPrefix) ||
					isHeadWord(wordAfter(token.length, peek), frameOf(stack).ctx))
			) {
				return T.headPrefix;
			}
			return T.ScenarioPrefix;
		case 'AbsoluteId':
			return T.AbsoluteId;
		case 'Date':
			return T.Date;
		case 'Time':
			return T.Time;
		case 'Float':
			return T.Float;
		case 'Integer':
			return T.Integer;
		case 'String':
			return token.flags & (TokenFlag.Macro | TokenFlag.Env) ? T.TemplateString : T.String;
		case 'MacroBody':
			return T.MacroBody;
		case 'MacroCall':
			return macroTerm(stack, T.MacroCall, T.headMacro);
		case 'MacroWord':
			return macroTerm(stack, T.MacroWord, T.headMacroWord);
		case 'EnvRef':
			return macroTerm(stack, T.EnvRef, T.headEnvRef);
		case 'Punct': {
			const s = text();
			if (s === '{') return stack.canShift(T.ExprOpen) ? T.ExprOpen : T.OpenBrace;
			return PUNCT.get(s) ?? T.Punct;
		}
	}
}

/** The tokenizer the grammar declares with `@external tokens`. */
export const tjpTokens = tjpExternalTokenizer(termFor, { contextual: true });
