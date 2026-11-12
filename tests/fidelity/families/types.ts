// SPDX-License-Identifier: GPL-2.0-or-later
// What one intent family is. Adding a family (for example the T11b task structure intents or the T11d
// resource, project and calendar intents) is one module that exports a `Family` and one line in
// families/index.ts: it draws intents against the plan facts, says where their text changes may fall
// (its oracle region) and what the index must read afterwards (its model update).
import type { EditIntent, IntentType } from '../../../src/lib/tjp/edit/types';
import type { Facts, Rg, Sem } from '../gen/facts';
import type { Rng } from '../gen/rng';

/** One change of an edit, in pre-edit coordinates. */
export interface Change {
	readonly file: string;
	readonly from: number;
	readonly to: number;
	readonly insert: string;
}

/** Where an edit may change text: a set of ranges, or a rule for changes that are not local. */
export type Region = readonly Rg[] | ((c: Change, f: Facts) => boolean);

export interface Drawn {
	readonly intent: EditIntent;
	/**
	 * The intent aims at text-only text (a macro, a templated name) or at text it must not accept,
	 * so it must be refused, with one of these reasons.
	 */
	readonly mustRefuse?: readonly string[];
}

export interface Family {
	readonly name: string;
	/** The intent types it covers. */
	readonly types: readonly IntentType[];
	/** An intent of `type` over this plan, or null when the plan has no fitting target. */
	draw(type: IntentType, f: Facts, sem: Sem, rng: Rng): Drawn | null;
	/** Where an edit of `intent` may change text (7.1 "Targets"), from the pre-edit facts. */
	region(intent: EditIntent, f: Facts): Region;
	/** The semantics after an edit of `intent` that applied (the model update). */
	expect(sem: Sem, f: Facts, intent: EditIntent): Sem;
}
