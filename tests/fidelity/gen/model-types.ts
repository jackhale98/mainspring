// SPDX-License-Identifier: GPL-2.0-or-later
// Types of the random plan model (model.ts) and the small builders its generators share.
import type { Gap } from './facts';

export interface MItem {
	/** A task id (depends), a resource id (allocate, responsible) or a flag. */
	target: string;
	rel: boolean;
	gap: Gap | null;
}
export interface MStmt {
	key: string;
	scenario: string | null;
	/** Raw value text; null for statements without one (`milestone`) and for lists. */
	value: string | null;
	items: MItem[] | null;
	/** The value is a macro call. */
	macro: boolean;
	trailing: string | null;
	/** A comment line above; `attached` means no blank line between. */
	lead: { text: string; attached: boolean } | null;
	wrap: boolean;
}
export interface MTask {
	local: string;
	id: string;
	name: string;
	nameMacro: boolean;
	quote: '"' | "'";
	kids: MTask[];
	file: number;
	parent: MTask | null;
	stmts: MStmt[];
	supp: MStmt[];
	/** Statement-level macro calls, with the position among `stmts` they come before. */
	calls: Array<{ macro: string; before: number }>;
	oneLine: boolean;
	blankBefore: boolean;
	lead: { text: string; attached: boolean } | null;
	trailing: string | null;
}
export interface MRes {
	id: string;
	name: string;
	kids: MRes[];
	leaves: string | null;
}
export interface MMacro {
	name: string;
	body: string;
	multiline: boolean;
}
export interface MFile {
	path: string;
	/** For a prefixed include: the id of the task whose children the file holds. */
	prefix: string | null;
	/** Top-level tasks of a plain include. */
	plain: boolean;
}
export interface MPlan {
	seed: number;
	indent: string;
	eol: string;
	/** Indentation of some lines is wrong on purpose (for `format`). */
	sloppy: boolean;
	horizon: number;
	scenarios: boolean;
	headerBody: boolean;
	files: MFile[];
	macros: MMacro[];
	flagDecls: string[][];
	globalLeaves: string | null;
	resources: MRes[];
	tasks: MTask[];
	resourceLeaves: string[];
}

export const IDS = [
	'design',
	'build',
	'test',
	'review',
	'deploy',
	'plan',
	'docs',
	'api',
	'ui',
	'db',
	'qa',
	'ship',
	'spec',
	'demo',
	'audit',
	'setup',
	'data',
	'infra',
	'sync',
	'polish',
];
export const RES = ['ana', 'bob', 'cy', 'dee', 'eli', 'fay'];
export const FLAGS = ['urgent', 'later', 'blocked', 'hot', 'risk'];
export const WORDS = [
	'Alpha',
	"Dev's",
	'Review "fix"',
	'Phase 2',
	'Release',
	'Docs',
	'Cleanup',
	'Spike',
];
export const BLOCK = '/*block*/';
export const COMMENTS = ['TODO later', 'kept as is', 'see ticket', 'owner: team', 'rough', BLOCK];

export interface PlanOpts {
	/** Print with wrong indentation on some lines, so `format` has work. */
	sloppy?: boolean;
	/** At least this many tasks. */
	minTasks?: number;
	/** Force statement-level macros, scenarios, supplements and several files. */
	rich?: boolean;
}

export const mk = (key: string, value: string | null, extra: Partial<MStmt> = {}): MStmt => ({
	key,
	scenario: null,
	value,
	items: null,
	macro: false,
	trailing: null,
	lead: null,
	wrap: false,
	...extra,
});
export const list = (key: string, targets: string[], extra: Partial<MStmt> = {}): MStmt =>
	mk(key, null, { items: targets.map((target) => ({ target, rel: false, gap: null })), ...extra });
