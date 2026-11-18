// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The copy of the resource table, the person details, the working-hours editor and the rest of the
 * project sheet (phase-3.md 9.6, 7.1 W6 to W8), kept in a file of its own beside strings.ts. Only lazy
 * chunks read it (the People views and the details of a person and the project sheet), so a Gantt-first
 * load does not fetch it: in strings.ts, whose one chunk every load fetches, it grew the first load by
 * 1.4 KB gzip (phase-3.md 23.1). It is still the one place for this copy; strings.ts holds the rest.
 */

/**
 * The resource table, groups and person details (src/components/resources, inspector/Resource*,
 * phase-3.md 9.6, 7.1 W6 to W8): the table's words, the labels of its edits (toasts and undo
 * entries) and the sentences for what the planner refuses.
 */
export const resourceStrings = {
	/** The Resources view: the divider between the table and the lanes. */
	view: { divider: 'Resize the people table', table: 'People table' },
	table: {
		label: 'People',
		region: 'People table',
		toolbar: 'People actions',
		col: { name: 'Name', id: 'Id', group: 'Group', efficiency: 'Efficiency', booked: 'Booked' },
		none: '–',
		addPerson: 'Add person',
		addGroup: 'Add group',
		namePerson: 'Name of the new person',
		nameGroup: 'Name of the new group',
		create: 'Add',
		cancel: 'Cancel',
		menu: 'Row actions',
		menuOff: 'Row actions: select a person first',
		intoGroup: 'Into the group above',
		outOfGroup: 'Out of its group',
		group: 'group',
		in: (group: string) => `in ${group}`,
		bookedSpoken: (hours: string) => `${hours} booked`,
		keys: 'Keys: Up and Down move, Right and Left open and close a group, Enter opens the details, F2 renames, Delete removes, Alt+Shift+arrows move the person.',
		selectHint: 'Select a person to see and change their details.',
		deleted: (name: string) => `${name} deleted`,
		changedMeanwhile: 'The plan changed while you were moving. Nothing was moved; try again.',
		nowhere: (step: string) =>
			({
				up: 'Already the first in its group.',
				down: 'Already the last in its group.',
				indent: 'There is no group above to move into.',
				outdent: 'Already at the top level.',
			})[step] ?? 'Nowhere to move.',
	},
	details: {
		title: 'Person details',
		groupTitle: 'Group details',
		empty: 'Select a person to see and change their details.',
		notFound: 'This person is no longer in the plan.',
		declarationTextOnly:
			'This person is declared with a macro, so they can only be edited as text.',
		field: {
			name: 'Name',
			id: 'Id',
			group: 'Group',
			efficiency: 'Efficiency',
			rate: 'Rate',
			email: 'E-mail',
			managers: 'Managers',
		},
		groupNone: 'None (top level)',
		efficiencyHint: '1 is a full working day of effort; 0.8 gets four fifths of it done.',
		rateHint: 'The cost of one working day, for reports.',
		emailHint: 'Saved when you leave the field.',
		rateInvalid: 'Enter a number such as 450 or 62.5.',
		managers: {
			none: 'No managers',
			add: 'Add a manager',
			choose: 'Choose a person',
			remove: (name: string) => `Remove manager ${name}`,
			from: (name: string) => `from ${name}`,
		},
		section: { hours: 'Working hours', leaves: 'Leaves', booked: 'Booked tasks' },
		leaves: {
			none: 'No leaves in the text.',
			add: 'Add leave',
			addHint: 'Opens the calendar with this person, where you paint the days.',
			edit: 'Edit',
			done: 'Done',
			remove: 'Remove',
			textOnly: 'From a shift or macro. Edit as text.',
			item: (type: string, days: string) => `${type}, ${days}`,
		},
		booked: {
			none: 'Nobody is booked yet.',
			item: (task: string, hours: string) => `${task}: ${hours}`,
			total: (hours: string) => `${hours} in the plan`,
		},
		del: 'Delete person',
		delGroup: 'Delete group',
		delHint: 'Removes the person and their allocations. Undo brings them back.',
		showInText: 'Show in text',
	},
	label: {
		efficiency: (name: string, to: string) => `Efficiency of ${name}: ${to}`,
		rate: (name: string, to: string) => `Rate of ${name}: ${to}`,
		rateCleared: (name: string) => `Rate of ${name} cleared`,
		email: (name: string, to: string) => `E-mail of ${name}: ${to}`,
		emailCleared: (name: string) => `E-mail of ${name} cleared`,
		managerAdded: (name: string, who: string) => `${who} now manages ${name}`,
		managerRemoved: (name: string, who: string) => `${who} no longer manages ${name}`,
		renamed: (from: string, to: string) => `${from} renamed ${to}`,
		/** What a delete removed with the resource: its members, and the allocations and lists that named it. */
		deleted: (name: string, members: number, references: number) => {
			const also = [
				members > 0 ? (members === 1 ? '1 member' : `${members} members`) : null,
				references > 0 ? (references === 1 ? '1 reference' : `${references} references`) : null,
			].filter((x) => x !== null);
			return also.length === 0 ? `Deleted ${name}` : `Removed ${name} and ${also.join(' and ')}`;
		},
		added: (name: string) => `Added ${name}`,
		groupAdded: (name: string) => `Added group ${name}`,
		movedInto: (who: string, group: string) => `${who} moved into ${group}`,
		movedOut: (who: string, group: string) => `${who} moved out of ${group}`,
		reordered: (who: string) => `${who} moved`,
	},
	refuse: {
		unknown: 'This person is no longer in the plan.',
		intoItself: (name: string) => `${name} cannot move into itself or into its own group.`,
		notAGroup: (name: string) =>
			`${name} has tasks, so people cannot join it. Make a group for them instead.`,
		samePlace: 'It is already there.',
	},
} as const;

/** The working-hours editor, shared by a person's details and the project sheet. */
export const hoursStrings = {
	title: 'Working hours',
	off: 'Off',
	day: {
		mon: 'Monday',
		tue: 'Tuesday',
		wed: 'Wednesday',
		thu: 'Thursday',
		fri: 'Friday',
		sat: 'Saturday',
		sun: 'Sunday',
	},
	short: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
	dayOff: (day: string) => `${day}: day off`,
	start: (day: string, n: number) => `${day}, range ${n}: from`,
	end: (day: string, n: number) => `${day}, range ${n}: to`,
	addRange: (day: string) => `Add hours on ${day}`,
	removeRange: (day: string, n: number) => `Remove range ${n} on ${day}`,
	hint: 'Times such as 9:00 and 17:30. A change is written for that weekday.',
	fromGroup: (parent: string) => `Same as ${parent} until changed here.`,
	fromProject: 'Same as the project until changed here.',
	invalid: {
		time: 'Enter a time such as 9:00.',
		order: 'Each range must end after it starts, and ranges must not overlap.',
	},
	label: (who: string, day: string, hours: string) => `${who}, ${day}: ${hours}`,
} as const;

/** The rest of the project sheet's frame (phase-2.md 19.9). */
export const projectFrameStrings = {
	/** The rest of the frame (phase-3.md 9.6): hours, the week and how dates and money read. */
	hoursTitle: 'Working hours',
	hoursLead: 'The hours the plan works each weekday. People start from these.',
	dailyHours: 'Hours in a working day',
	dailyHoursHint: 'What a day of effort means. TaskJuggler uses 8 when this is empty.',
	weekStart: 'Weeks start on Monday',
	weekStartHint: 'Off: weeks start on Sunday. The load columns follow it.',
	timeformat: 'Time format',
	timeformatHint: 'How reports write dates, such as %Y-%m-%d.',
	currency: 'Currency',
	currencyHint: 'The code reports show costs in, such as EUR.',
} as const;

/** The labels (toasts and undo entries) of the project sheet's frame edits. */
export const projectLabelStrings = {
	dailyHours: (to: string) => `Working day: ${to} h`,
	noDailyHours: 'Working day back to 8 h',
	weekStart: (monday: boolean) => `Weeks start on ${monday ? 'Monday' : 'Sunday'}`,
	timeformat: (to: string) => `Time format: ${to}`,
	noTimeformat: 'Time format cleared',
	currency: (to: string) => `Currency: ${to}`,
	noCurrency: 'Currency cleared',
} as const;
