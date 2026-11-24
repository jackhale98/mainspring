// SPDX-License-Identifier: GPL-2.0-or-later
// The gate's three-file plan (phase-4.md 16.1) and sides made by the edit API, for the merge tests.
import { applyIntent } from '../tjp/edit/apply';
import { textsAfter } from '../tjp/edit/testing';
import type { EditIntent } from '../tjp/edit/types';
import { buildIndex } from '../tjp/index';
import { createWorkspace } from '../workspace/workspace';

const ENTRY = 'plan.tjp';

// The gate's plan (16.1): an entry file, people and an included task file.
export const PLAN = {
	[ENTRY]:
		'project demo "Demo" 2027-01-04 +3m\ninclude "people.tji"\n' +
		'task x "X" {\n  effort 3d\n  allocate dev\n}\n' +
		'task t "T" {\n  effort 2d\n  allocate dev\n}\n' +
		'include "more.tji"\n',
	'people.tji': 'resource dev "Dev"\nresource qa "QA"\n',
	'more.tji': 'task m "M" {\n  effort 1d\n  allocate qa\n}\n',
} as const;

/** The files after applying `intents` in turn through the edit API. */
export function edited(
	files: Readonly<Record<string, string>>,
	...intents: EditIntent[]
): Record<string, string> {
	let out: Record<string, string> = { ...files };
	for (const intent of intents) {
		const snap = createWorkspace({ entry: ENTRY, files: out }).snapshot();
		out = textsAfter(snap, applyIntent(snap, buildIndex(snap, undefined, { cache: null }), intent));
	}
	return out;
}
