// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Ids and task references.
 *
 * An id is `[a-zA-Z_]\w*` with ASCII `\w`; an absolute id joins ids with dots
 * (ProjectFileScanner.rb:79-85). A task reference (`taskDepId`, TjpSyntaxRules.rb:6070-6103) is
 * an absolute id, an id, or a relative id: one or more `!` tokens (`relativeId`, :3759-3768;
 * whitespace between them is allowed, as they are separate tokens) and then an id or absolute id.
 * Each `!` moves one level up from the task being declared, so inside `p.x`, `!a` is `p.a` and
 * `!!a` is `a`; a `!` too many is `too_many_bangs`.
 *
 * The edit API writes `!id` for a sibling and the absolute id otherwise (spec 7.1, 13.7).
 */
import { parseWith, type Cursor } from './cursor';
import { fail, ok, raise, type Parsed, type Result, type Span } from './result';

const ID = /^[a-zA-Z_]\w*$/;
const ABS_ID = /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/;

export const isId = (s: string): boolean => ID.test(s);
/** An id or a dotted id. */
export const isIdPath = (s: string): boolean => ABS_ID.test(s);

export interface TaskRef {
	/** Number of leading `!`. */
	readonly up: number;
	/** The id or dotted id after them. */
	readonly path: string;
}

export function readTaskRef(c: Cursor): TaskRef {
	let up = 0;
	while (c.eat('!')) up++;
	return { up, path: c.expect('id', 'absId').text };
}

export function parseTaskRef(text: string, base = 0): Parsed<TaskRef> {
	return parseWith(text, base, readTaskRef);
}

export function printTaskRef(r: TaskRef): Result<string> {
	if (!Number.isInteger(r.up) || r.up < 0 || !isIdPath(r.path)) return fail('not-an-id', 0, 0);
	return ok('!'.repeat(r.up) + r.path);
}

export const sameTaskRef = (a: TaskRef, b: TaskRef): boolean => a.up === b.up && a.path === b.path;

/**
 * The full id a reference names, read inside the task `property` (its full id; null at the top
 * level). Plain and absolute ids are returned unchanged: prefixes are the index's business.
 */
export function resolveTaskRef(ref: TaskRef, property: string | null): Result<string> {
	if (ref.up === 0) return ok(ref.path);
	let task = property === null ? null : property.split('.');
	let up = ref.up;
	while (task !== null && up > 0) {
		up--;
		task = task.length > 1 ? task.slice(0, -1) : null;
	}
	if (up > 0) return fail('too-many-bangs', 0, 0, 'too_many_bangs');
	return ok(task === null ? ref.path : `${task.join('.')}.${ref.path}`);
}

/** The reference the edit API writes in `from`'s body for task `to`: `!id` for a sibling. */
export function refFor(from: string, to: string): TaskRef {
	const parent = (id: string): string => id.slice(0, Math.max(0, id.lastIndexOf('.')));
	if (parent(from) === parent(to)) return { up: 1, path: to.slice(to.lastIndexOf('.') + 1) };
	return { up: 0, path: to };
}

export interface IdListOptions {
	/** Accept dotted ids as items. */
	readonly dotted?: boolean;
}

/** `id (, id)*` as `flags`, `responsible`, `managers` and plain `allocate` lists use. */
export function readIdList(c: Cursor, opts: IdListOptions, items: Span[]): string[] {
	const one = (): string => {
		const t = c.expect('id', 'absId');
		if (t.kind === 'absId' && !opts.dotted) raise('not-an-id', t.from, t.to);
		items.push({ from: t.from, to: t.to });
		return t.text;
	};
	const list = [one()];
	while (c.eat(',')) list.push(one());
	return list;
}

export function parseIdList(
	text: string,
	base = 0,
	opts: IdListOptions = {},
): Parsed<string[], { items: readonly Span[] }> {
	const items: Span[] = [];
	return parseWith(
		text,
		base,
		(c) => readIdList(c, opts, items),
		() => ({ items }),
	);
}

export function parseId(text: string, base = 0): Parsed<string> {
	return parseWith(text, base, (c) => c.expect('id').text);
}

export function printIdList(ids: readonly string[], opts: IdListOptions = {}): Result<string> {
	const okId = opts.dotted ? isIdPath : isId;
	if (ids.length === 0 || !ids.every(okId)) return fail('not-an-id', 0, 0);
	return ok(ids.join(', '));
}

/**
 * An id made from a name: ASCII letters, digits and `_`, lower case, not starting with a digit,
 * with `_2`, `_3`, … appended while `taken` says the id is used (spec 7.1 `addTask`).
 */
export function slugId(name: string, taken: (id: string) => boolean = () => false): string {
	let s = name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '');
	if (s === '') s = 'task';
	if (/^\d/.test(s)) s = `_${s}`;
	if (!taken(s)) return s;
	for (let n = 2; ; n++) if (!taken(`${s}_${n}`)) return `${s}_${n}`;
}
