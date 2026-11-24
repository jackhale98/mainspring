// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Which statements may be written several times in one block, each adding to what the others say
 * (repeatable), and which set one value that a second statement overwrites (single-valued). From
 * TaskJuggler 3.8.4 at 3b36c79 (engine/tj):
 *
 * - **List attributes.** `PropertyTreeNode#set` and `#[]=` (PropertyTreeNode.rb 436-494) append to
 *   an attribute whose class is a `ListAttributeBase` and raise `AttributeOverwrite` (the
 *   `attr_overwrite` warning) for any other. The attribute classes are in Project.rb 117-470 and
 *   Attributes.rb: for tasks `allocate`, `booking`, `charge`, `chargeset`, `depends`, `precedes`,
 *   `flags`, `responsible`, `fail`, `warn`; for resources `chargeset`, `flags`, `leaves`,
 *   `leaveallowances`, `managers`, `fail`, `warn`; for accounts `credits` and `flags`; for
 *   reports `columns`, `formats`, `flags`, `scenarios`, `definitions` and the `sort…` lists.
 * - **Rules that add.** `workinghours` sets days one statement at a time ("Working hours can be
 *   set multiple times", TjpSyntaxRules.rb 7711-7737); `shift`/`shifts` ("Multiple shift
 *   assignments are a common idiom", 4984-5010); `leaves` and `vacation` add (`+=`, 4945, 5026,
 *   5331, 5371; the project's `<<`, 3597, 3668); a resource's `booking` adds to a task's bookings;
 *   `journalentry`, `purge` and top-level `flags` declare one more each. `extend` and
 *   `projectids` are not counted as repeatable: unchecked on the engine, they are single-valued
 *   (a conflict when both sides add one), as the third review allowed.
 * - **Not additive although repeatable:** `workinghours` replaces the hours of the days it lists,
 *   and `purge X` clears X (check.ts keys them by weekday and by X).
 * - **Everything else** is single-valued, unknown keywords included (a second `priority`,
 *   `start`, `complete`, `rate`, `timezone`, `limits` … overwrites). The sizing criteria
 *   `effort`, `duration`, `length` and `milestone` are one value: a task has one.
 *
 * Keys are hints.ts statement keys: a scenario prefix stays part of the key (`delayed:effort` is
 * another value than `effort`).
 */
import type { SyntaxNode } from '@lezer/common';
import { statementHead } from '../tree';
import { attrName, statementKey } from './hints';

export const REPEATABLE: ReadonlySet<string> = new Set([
	'allocate',
	'booking',
	'charge',
	'chargeset',
	'columns',
	'credits',
	'definitions',
	'depends',
	'fail',
	'flags',
	'formats',
	'journalentry',
	'leaveallowances',
	'leaves',
	'managers',
	'precedes',
	'purge',
	'responsible',
	'scenarios',
	'shift',
	'shifts',
	'sortaccounts',
	'sortjournalentries',
	'sortresources',
	'sorttasks',
	'vacation',
	'warn',
	'workinghours',
]);

const SIZING: ReadonlySet<string> = new Set(['effort', 'duration', 'length', 'milestone']);

/** The statement's keyword (or extension attribute name), without its scenario prefix. */
export function keywordOf(stmt: SyntaxNode, text: string): string {
	const head = statementHead(stmt);
	return head ? text.slice(head.from, head.to) : '';
}

/** Whether statements of this keyword add to each other (module comment). */
export function repeatable(keyword: string): boolean {
	return REPEATABLE.has(keyword);
}

/** The value a statement sets: its key, with the sizing criteria as one (`delayed:sizing`). */
export function slotOf(stmt: SyntaxNode, text: string): string | null {
	const key = statementKey(stmt, text);
	if (key === null) return null;
	const kw = keywordOf(stmt, text);
	return SIZING.has(kw) ? `${attrName(stmt, text).slice(0, -kw.length)}sizing` : key;
}
