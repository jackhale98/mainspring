// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The merged text as it is built, and the conflicts found on the way, with what their ids need
 * (types.ts "Stable ids"): the region's range in the base and its text on theirs.
 */
import type { ConflictSubject } from './types';

/** A half-open range of UTF-16 offsets in one text. */
export interface Rng {
	readonly from: number;
	readonly to: number;
}

export interface Pending {
	readonly subject: ConflictSubject;
	readonly base: string | null;
	readonly ours: string | null;
	readonly theirs: string | null;
	/** In the merged text. */
	readonly at: Rng;
	/** In ours' text. */
	readonly atOurs: Rng;
	/** In the base text: what the id is computed from. */
	readonly atBase: Rng;
	readonly both: boolean;
	/** The only side a choice may take (types.ts `MergeConflict.only`); absent is null. */
	readonly only?: 'ours' | 'theirs';
}

export class Out {
	private readonly parts: string[] = [];
	private length = 0;
	readonly conflicts: Pending[] = [];

	get pos(): number {
		return this.length;
	}

	/** Appends `s`; returns where it landed. */
	push(s: string): Rng {
		const from = this.length;
		if (s.length > 0) {
			this.parts.push(s);
			this.length += s.length;
		}
		return { from, to: this.length };
	}

	/** Whether the text so far is empty or ends a line. */
	get atLineStart(): boolean {
		const last = this.parts[this.parts.length - 1];
		return last === undefined || last.endsWith('\n');
	}

	conflict(c: Pending): void {
		this.conflicts.push(c);
	}

	/** Appends another output: its text, and its conflicts moved to where it lands. */
	append(o: Out): void {
		const shift = this.length;
		this.push(o.text());
		for (const c of o.conflicts) {
			this.conflicts.push({ ...c, at: { from: c.at.from + shift, to: c.at.to + shift } });
		}
	}

	text(): string {
		return this.parts.join('');
	}
}

/** A 53-bit string hash (cyrb53), as hex: ids stay short whatever the region's size. */
export function hash(s: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** The part of an id before the order suffix: file, subject, base range, theirs' text. */
export function idKey(file: string, c: Pending): string {
	const s = c.subject;
	const what =
		s.kind === 'attribute'
			? `attribute:${s.attr}`
			: s.kind === 'block' || s.kind === 'file'
				? `${s.kind}:${s.change}`
				: 'text';
	return `${file}#${what}@${c.atBase.from}-${c.atBase.to}:${hash(c.theirs ?? '\u0000none')}`;
}
