// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The copy of the dependency picker (src/components/inspector/DependsPicker.svelte, polish item
 * 11), in a file of its own beside strings.ts: only the picker's lazy chunk reads it, so a first
 * load does not fetch it. The Add buttons that open it are in strings.ts (`inspectorStrings.dependency`).
 */
import type { PickRole, Unavailable } from './inspector/depends-picker';

export const dependsPickerStrings = {
	/** The search box, by what the chosen task will be to this one. */
	searchLabel: {
		predecessor: 'Find a task this one waits for',
		successor: 'Find a task that follows this one',
	} satisfies Record<PickRole, string>,
	searchPlaceholder: 'Search by name or id',
	listLabel: 'Tasks',
	/** The shown count, or the cap on a long list. */
	count: (shown: number, total: number) =>
		shown < total
			? `Showing ${shown} of ${total} tasks. Type to narrow the list.`
			: total === 1
				? '1 task'
				: `${total} tasks`,
	noMatch: (query: string) => `No task matches "${query}".`,
	/** Why a listed task cannot be chosen. */
	reason: {
		ancestor: 'Contains this task',
		descendant: 'Is inside this task',
		linked: 'Already linked',
		inherited: 'Already linked through a container',
		'macro-in-body': 'A macro in the task writes its links, so only the text can link it',
		'expanded-only': 'Declared by a macro, so only the text can link it',
	} satisfies Record<Unavailable, string>,
	/** Said when every task the search keeps is disabled. */
	noneChoosable: (n: number) =>
		n === 1 ? 'That task cannot be chosen.' : `None of these ${n} tasks can be chosen.`,
	/** Said when the link exists already and nothing was changed. */
	alreadyLinked: 'Already linked. Choose another task, or press Escape to close the list.',
	/** Said when a link is refused and the list stays open to choose again. */
	refused: 'Not linked. Choose another task, or press Escape to close the list.',
};
