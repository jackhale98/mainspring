// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Line numbers as TaskJuggler counts them. TaskJuggler reads files with universal newlines, so
 * `\n`, `\r\n` and a lone `\r` each end one line; error messages and source references use those
 * line numbers. CodeMirror documents here split on `\n` only (document.ts), so their `lineAt` would
 * put everything in a file with lone `\r` breaks on line 1. Use these for anything compared with
 * the engine's lines.
 */
import type { Text } from '@codemirror/state';

/** The lines of one text, TaskJuggler style. Build once per text for many lookups. */
export class TjLines {
	private readonly text: string;
	/** Start offset of each line; `starts[0]` is 0. */
	private readonly starts: number[] = [0];

	constructor(text: string | Text) {
		this.text = typeof text === 'string' ? text : text.toString();
		const s = this.text;
		for (let i = 0; i < s.length; i++) {
			const c = s.charCodeAt(i);
			if (c === 10 || (c === 13 && s.charCodeAt(i + 1) !== 10)) this.starts.push(i + 1);
		}
	}

	/** The number of lines (a final break starts an empty last line). */
	get count(): number {
		return this.starts.length;
	}

	/** The 1-based line of offset `pos` (clamped to the text). A line break belongs to its line. */
	lineOf(pos: number): number {
		const p = Math.max(0, Math.min(pos, this.text.length));
		let lo = 0;
		let hi = this.starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((this.starts[mid] ?? 0) <= p) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	}

	/** The range of 1-based `line` without its line break. Throws RangeError for no such line. */
	range(line: number): { from: number; to: number } {
		const from = line >= 1 ? this.starts[line - 1] : undefined;
		if (from === undefined) throw new RangeError(`no line ${line}`);
		let to = this.starts[line] ?? this.text.length;
		if (to > from && this.text.charCodeAt(to - 1) === 10) to--;
		if (to > from && this.text.charCodeAt(to - 1) === 13) to--;
		return { from, to };
	}
}

/** The 1-based TaskJuggler line of `pos` in `text`. */
export function tjLineOf(text: string | Text, pos: number): number {
	return new TjLines(text).lineOf(pos);
}

/** The range of 1-based TaskJuggler `line` in `text`, without its line break. */
export function tjLineRange(text: string | Text, line: number): { from: number; to: number } {
	return new TjLines(text).range(line);
}
