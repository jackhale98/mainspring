// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Copy for the public landing page (src/pages/index.astro, ADR-0011). The app keeps its own copy
 * in strings.ts; the marketing page has its own file so the two can change at different speeds.
 * Honesty rule: a feature is in `available` only if it works in the app today. Everything that
 * is only planned is in `coming`, taken from docs/BUILD_PLAN.md, and the page marks it with a
 * "Coming" tag.
 */

export type IconName =
	| 'cpu'
	| 'file-text'
	| 'code'
	| 'gantt'
	| 'contrast'
	| 'unlock'
	| 'move'
	| 'grid'
	| 'pulse'
	| 'folder'
	| 'download'
	| 'layers'
	| 'arrow-right'
	| 'check'
	| 'github'
	| 'external';

export interface FeatureCopy {
	icon: IconName;
	title: string;
	body: string;
}

export const landingLinks = {
	source: 'https://github.com/jackhale98/mainspring',
	licence: 'https://github.com/jackhale98/mainspring/blob/main/LICENSE',
	taskjuggler: 'https://taskjuggler.org/',
} as const;

export const landing = {
	meta: {
		title: 'Mainspring: TaskJuggler plans in your browser',
		description:
			'Mainspring runs the real TaskJuggler scheduler in your browser. Write the plan as plain text and see it as a Gantt chart beside it. Free and open source.',
	},
	nav: {
		label: 'Main',
		home: 'Mainspring, home',
		how: 'How it works',
		features: 'Features',
		builtOn: 'Built on TaskJuggler',
		source: 'GitHub',
		openApp: 'Open app',
	},
	hero: {
		eyebrow: 'Open source · For TaskJuggler',
		before: 'Plain text plans that ',
		accent: 'keep time',
		after: '.',
		lead: 'Mainspring runs the real TaskJuggler scheduler in your browser. Write the plan as plain text. See it as a Gantt chart beside the text. The dates match the command-line tool.',
		openApp: 'Open the app',
		how: 'How it works',
		facts: ['No sign-up', 'Runs in your browser', 'Plain .tjp files', 'Free and open source'],
		note: 'Early preview. Changes stay in your browser tab until saving arrives.',
		mockLabel:
			'Mainspring in Split view. A TaskJuggler plan as text on the left and its Gantt chart on the right: five tasks, with the critical path in red.',
	},
	mock: {
		brand: 'Mainspring',
		plan: 'relaunch.tjp',
		modes: ['Text', 'Split', 'Visual'],
		activeMode: 1,
		status: 'Scheduled',
		month: 'December',
		year: '2026',
		ticks: ['Dec 7', 'Dec 14', 'Dec 21', 'Dec 28'],
		chips: ['Week', 'Today', 'Critical path'],
	},
	how: {
		id: 'how',
		eyebrow: 'How it works',
		before: 'The text is the plan. The chart is ',
		accent: 'a view',
		after: '.',
		lead: 'Everything lives in a plain .tjp file. Mainspring schedules it with TaskJuggler as you type and draws the result beside the text. Nothing in the chart is stored anywhere else.',
		steps: [
			{
				title: 'Write the plan',
				body: 'Tasks, effort, people and dependencies, in TaskJuggler’s own syntax. Completion and keyword docs come from TaskJuggler itself.',
			},
			{
				title: 'It schedules as you type',
				body: 'The real scheduler runs in a background worker in your browser. Errors show inline, on the line that caused them.',
			},
			{
				title: 'The Gantt follows',
				body: 'Change 10d to 8d and the bar gets shorter. The chart is read-only today, so the text is where you edit.',
			},
		],
		demoLabel:
			'A TaskJuggler plan beside its Gantt chart. The line “effort 10d” and the Build bar are highlighted: ten days of effort shared by two people makes a bar five working days long.',
		demoFile: 'plan.tjp',
		demoCaption: 'effort 10d, two people: a bar five working days long',
		comingNote:
			'Dragging bars and links to edit the plan, with undo, is coming. Each drag will write a small text change.',
	},
	features: {
		id: 'features',
		eyebrow: 'What you get',
		before: 'What works ',
		accent: 'today',
		after: '.',
		lead: 'Everything in this list is in the app now.',
		comingTitle: 'On the way',
		comingLead: 'Planned in the build plan. Not in the app yet.',
		comingTag: 'Coming',
	},
	available: [
		{
			icon: 'cpu',
			title: 'The real TaskJuggler',
			body: 'TaskJuggler 3.8.4 runs in your browser on ruby.wasm. On our golden test plans, its results are identical to the native tool.',
		},
		{
			icon: 'file-text',
			title: 'Plain text, always',
			body: 'Your plan is a .tjp file, and the text is the only source of truth. There is no hidden project format.',
		},
		{
			icon: 'code',
			title: 'An editor that knows TaskJuggler',
			body: 'Live scheduling, inline errors and completion. The keyword docs are generated from TaskJuggler itself, so they match the scheduler you run.',
		},
		{
			icon: 'gantt',
			title: 'A Gantt beside the text',
			body: 'Split view shows the editor and a read-only Gantt chart side by side, with milestones, dependency links and the critical path.',
		},
		{
			icon: 'contrast',
			title: 'Light, dark and every screen',
			body: 'It follows your system’s light or dark setting. Phone, tablet and desktop layouts show the same plan.',
		},
		{
			icon: 'unlock',
			title: 'Free and local',
			body: 'No sign-up, and no server holds your plan. Mainspring is open source under GPL-2.0-or-later.',
		},
	] satisfies FeatureCopy[],
	coming: [
		{
			icon: 'move',
			title: 'Visual editing',
			body: 'Drag bars, links and rows. Every change is written back as a minimal text edit, with undo.',
		},
		{
			icon: 'grid',
			title: 'Workload and resources',
			body: 'A heatmap of who is busy and who is free, by day, week or month.',
		},
		{
			icon: 'pulse',
			title: 'Plan health checks',
			body: 'Flags tasks with missing logic, hard date constraints and overloaded people.',
		},
		{
			icon: 'folder',
			title: 'Save and sync',
			body: 'Save to a folder. Sync with GitHub and see a schedule diff before you commit.',
		},
		{
			icon: 'download',
			title: 'Install and work offline',
			body: 'Install Mainspring as an app and keep working with no connection.',
		},
		{
			icon: 'layers',
			title: 'Scenarios and tracking',
			body: 'Compare what-ifs against a baseline, and track progress against a status date.',
		},
	] satisfies FeatureCopy[],
	builtOn: {
		id: 'taskjuggler',
		eyebrow: 'Built on TaskJuggler',
		before: 'Real scheduling, not a ',
		accent: 'lookalike',
		after: '.',
		lead: 'Mainspring does not reimplement scheduling. It runs TaskJuggler 3.8.4, the open-source project scheduler, inside a Web Worker. The dates you see are the dates the command-line tool gives.',
		listTitle: 'What TaskJuggler schedules',
		capabilities: [
			{
				name: 'Effort',
				body: 'Give a task effort. The scheduler works out its length from who is free.',
			},
			{ name: 'Resource leveling', body: 'A person is never booked for two things at once.' },
			{ name: 'Shifts', body: 'Working hours, shifts and leave for each person.' },
			{ name: 'Limits', body: 'Daily, weekly and monthly caps on work.' },
			{ name: 'Scenarios', body: 'Variants of one plan, scheduled side by side.' },
		],
		capabilitiesNote:
			'You write all of these in the text today. Visual controls for scenarios are coming.',
		credit: 'TaskJuggler is the work of its authors and contributors. Learn more at ',
		creditLink: 'taskjuggler.org',
		gpl: 'TaskJuggler is free software under the GNU GPL, version 2. Mainspring ships it unmodified, with its notices. Mainspring itself is licensed GPL-2.0-or-later. It is an independent project, not an official TaskJuggler release.',
		plateTitle: 'The movement',
		plateLabel: 'Specification of the Mainspring engine',
		plate: [
			['Scheduler', 'TaskJuggler 3.8.4'],
			['Runs on', 'ruby.wasm, in a Web Worker'],
			['Source of truth', '.tjp and .tji text'],
			['Server for your plan', 'None'],
			['Licence', 'GPL-2.0-or-later'],
		] as ReadonlyArray<readonly [string, string]>,
	},
	phone: {
		eyebrow: 'On every screen',
		before: 'The same plan, ',
		accent: 'in your pocket',
		after: '.',
		lead: 'On a desktop, the text and the chart sit side by side. On a phone, a tab bar switches between the plan, the Gantt and the text. The layouts for phone, tablet and desktop are built together.',
		points: [
			'Touch targets are at least 44 pixels on phones and tablets.',
			'Light and dark follow your system.',
			'The same scheduler runs on every screen.',
		],
		mockLabel:
			'Mainspring on a phone. A Gantt chart of five tasks, with the Build task open in a card that shows 30 percent complete, and a tab bar for Plan, Gantt and Text.',
		mock: {
			plan: 'relaunch.tjp',
			chips: ['Week', 'Today', 'Critical path'],
			task: 'Build',
			critical: 'Critical',
			complete: 'complete',
			detail: 'Effort 10d · Ana, Ben',
			tabs: ['Plan', 'Gantt', 'Text'],
			activeTab: 1,
		},
	},
	closing: {
		before: 'Open a sample plan and ',
		accent: 'try it',
		after: '.',
		lead: 'The app opens with a sample plan. Edit the text and watch the schedule change. No account and nothing to install.',
		openApp: 'Open the app',
		source: 'Read the source',
		note: 'Early preview: changes stay in your browser tab until saving arrives. Copy your text before you close the tab.',
	},
	footer: {
		label: 'Site footer',
		legal:
			'Mainspring is free software under the GNU GPL, version 2 or (at your option) any later version. It includes TaskJuggler, free software under the GNU GPL, version 2. Mainspring is an independent project.',
		source: 'Source on GitHub',
		licence: 'Licence',
		taskjuggler: 'TaskJuggler',
		external: '(opens in a new tab)',
	},
} as const;
