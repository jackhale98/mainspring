// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Checks of a moved block's text that the index cannot see through (phase-1.md 5.4 "Moved macro
 * calls", References):
 *
 * - Parse order: TaskJuggler defines a macro when it reads its definition, so a block that calls
 *   a macro may only land after one of its definitions (`text-only`, `macro-call`). Positions are
 *   ordered by the include chain of their file's first visit (`parseOrder`).
 * - Relative text the index cannot read: when the ids change, an opaque statement in the block,
 *   or a macro the block calls, whose text holds a `!` may hold a relative task reference that
 *   now names another task (`unfixable-reference`).
 */
import type { TjpFile } from '../document';
import { MACRO_TOKENS } from '../grammar/parser';
import type { SourceRange, SymbolIndex } from '../index';
import { fileText } from './lines';
import { refused, type Refused } from './types';

const CALL = /^\$\{\??[ \t\n\v\f\r]*([A-Za-z_]\w*)/;

/** Sort key of a position in parse order (first visit of its file), or null when unread. */
export function parseOrder(index: SymbolIndex, file: string, pos: number): number[] | null {
	const v = index.visits.findIndex((x) => x.file === file);
	if (v < 0) return null;
	const key = [pos];
	for (let x = index.visits[v]; x && x.parent !== null && x.site; x = index.visits[x.parent]) {
		key.unshift(x.site.to);
	}
	return key;
}

/** Whether key `a` comes before key `b`. */
export function before(a: readonly number[], b: readonly number[]): boolean {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		const x = a[i] as number;
		const y = b[i] as number;
		if (x !== y) return x < y;
	}
	return a.length < b.length;
}

interface Call {
	readonly name: string;
	readonly at: SourceRange;
}

/** Macro calls written in [from, to) of a file (inside strings too). */
function callsIn(file: TjpFile, from: number, to: number): Call[] {
	const text = fileText(file);
	const out: Call[] = [];
	file.tree.iterate({
		from,
		to,
		enter(ref) {
			if (!MACRO_TOKENS.has(ref.name) || ref.from < from || ref.to > to) return;
			const src = text.slice(ref.from, ref.to);
			for (let i = src.indexOf('${'); i >= 0; i = src.indexOf('${', i + 2)) {
				const m = CALL.exec(src.slice(i));
				if (m?.[1]) out.push({ name: m[1], at: { file: file.path, from: ref.from, to: ref.to } });
			}
		},
	});
	return out;
}

/**
 * The checks of the module comment for moving [from, to) of `file` to `dest` (a position in
 * pre-edit coordinates); `idsChange` when the move changes the subtree's ids.
 */
export function checkMovedText(
	index: SymbolIndex,
	file: TjpFile,
	from: number,
	to: number,
	dest: { file: string; pos: number },
	idsChange: boolean,
): Refused | null {
	const target = parseOrder(index, dest.file, dest.pos);
	const calls = callsIn(file, from, to);
	for (const c of calls) {
		const defs = index.macros.get(c.name) ?? [];
		if (defs.length === 0) continue;
		const ok = defs.some((d) => {
			const k = parseOrder(index, d.statement.file, d.statement.from);
			return k !== null && target !== null && before(k, target);
		});
		if (!ok) return refused('text-only', [c.at], { textOnly: 'macro-call' });
	}
	if (!idsChange) return null;
	const bad: SourceRange[] = [];
	for (const c of calls) {
		if ((index.macros.get(c.name) ?? []).some((d) => d.text.includes('!'))) bad.push(c.at);
	}
	const text = fileText(file);
	for (const t of index.textOnly(file.path)) {
		if (t.reason !== 'opaque' || t.at.from < from || t.at.to > to) continue;
		if (text.slice(t.at.from, t.at.to).includes('!')) bad.push(t.at);
	}
	return bad.length > 0 ? refused('unfixable-reference', bad) : null;
}
