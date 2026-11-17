// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The people picker's search (polish item 17): which of the plan's people a typed query keeps.
 * Pure text matching, no DOM. The query is split on spaces and every word must be found in the
 * person's name or id (case and accents ignored), so "ana lop" keeps "Ana López". The result
 * keeps each person's place in the full list (the drag and the avatar colour need it), with the
 * people whose name or id starts with the first word ahead of the rest, then the plan's own order.
 */
import type { Person } from './types';

/** Lower case, accents and diacritics removed, for comparing what a person types. */
export function fold(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export interface Match {
	readonly person: Person;
	/** The person's place in the full list given to `filterPeople`. */
	readonly index: number;
}

/** Whether a folded text starts with `word`, at its start or at the start of one of its words. */
const startsWord = (text: string, word: string): boolean =>
	text.startsWith(word) || text.includes(` ${word}`);

export function filterPeople(people: readonly Person[], query: string): Match[] {
	const words = fold(query).split(/\s+/).filter(Boolean);
	const all = people.map((person, index): Match => ({ person, index }));
	const first = words[0];
	if (first === undefined) return all;
	const kept: Array<Match & { rank: number }> = [];
	for (const m of all) {
		const name = fold(m.person.name);
		const id = fold(m.person.id);
		if (!words.every((w) => name.includes(w) || id.includes(w))) continue;
		kept.push({ ...m, rank: startsWord(name, first) || id.startsWith(first) ? 0 : 1 });
	}
	// Array.prototype.sort is stable: the plan's order holds within a rank.
	kept.sort((a, b) => a.rank - b.rank);
	return kept.map(({ person, index }) => ({ person, index }));
}
