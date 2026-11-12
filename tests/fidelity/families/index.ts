// SPDX-License-Identifier: GPL-2.0-or-later
// The intent families the fidelity suite covers. To add one (T11b: addTask, deleteTask, moveTask;
// T11d: resource, project, working-hours and leave intents): write a module with a `Family` (draw an
// intent, its oracle region, its model update), add it to FAMILIES and delete its types from PENDING.
// The coverage check then requires at least 5 edits of each of its types.
import type { IntentType } from '../../../src/lib/tjp/edit/types';
import { allocFamily } from './alloc';
import { attrFamily } from './attr';
import { depsFamily } from './deps';
import { flagsFamily } from './flags';
import { formatFamily } from './format';
import { renameFamily } from './rename';
import { resourcesFamily } from './resources';
import type { Family } from './types';

export const FAMILIES: readonly Family[] = [
	attrFamily,
	renameFamily,
	flagsFamily,
	depsFamily,
	allocFamily,
	formatFamily,
	resourcesFamily,
];

/** The 7.1 intents whose edit code has not merged: listed as skipped, not enforced. */
export const PENDING: ReadonlyArray<{ type: IntentType; task: string }> = [
	{ type: 'addTask', task: 'T11b' },
	{ type: 'deleteTask', task: 'T11b' },
	{ type: 'moveTask', task: 'T11b' },
	{ type: 'setProjectHeader', task: 'T11d' },
	{ type: 'setProjectAttr', task: 'T11d' },
	{ type: 'removeProjectAttr', task: 'T11d' },
	{ type: 'setWorkingHours', task: 'T11d' },
	{ type: 'addLeave', task: 'T11d' },
	{ type: 'updateLeave', task: 'T11d' },
	{ type: 'removeLeave', task: 'T11d' },
];

/** Every intent type the suite enforces, in family order. */
export const ENFORCED: readonly IntentType[] = FAMILIES.flatMap((f) => f.types);

export function familyOf(type: IntentType): Family {
	const f = FAMILIES.find((x) => x.types.includes(type));
	if (!f) throw new Error(`no fidelity family for ${type}`);
	return f;
}
