// SPDX-License-Identifier: GPL-2.0-or-later
/** The lower half of the landing page's copy: features, phone, FAQ, credit, close, footer. */
import type { FeatureCopy } from './landing-copy';

export const more = {
	features: {
		id: 'features',
		eyebrow: 'What you get',
		before: 'What works ',
		accent: 'today',
		after: '.',
		lead: 'Everything in this first list is in the app now.',
		comingTitle: 'On the way',
		comingLead: 'Visual editing is the next step. These are planned, and not in the app yet.',
		comingTag: 'Coming',
	},
	available: [
		{
			icon: 'cpu',
			title: 'A scheduling engine you can trust',
			body: 'TaskJuggler 3.8.4 runs in your browser. On our golden test plans, its results are identical to the native tool.',
		},
		{
			icon: 'file-text',
			title: 'Plain text, in your repository',
			body: 'Your plan is a .tjp file, and the text is the only source of truth. It diffs and merges like code.',
		},
		{
			icon: 'code',
			title: 'An editor that helps',
			body: 'Live scheduling as you type, inline errors and completion. The keyword docs are generated from TaskJuggler itself.',
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
			plan: 'plan.tjp',
			chips: ['Week', 'Today', 'Critical path'],
			task: 'Build',
			critical: 'Critical',
			complete: 'complete',
			detail: 'Effort 10d · Ana, Ben',
			tabs: ['Plan', 'Gantt', 'Text'],
			activeTab: 1,
		},
	},
	faq: {
		id: 'faq',
		eyebrow: 'FAQ',
		before: 'Questions, ',
		accent: 'answered',
		after: '.',
		items: [
			{
				q: 'Do I need to know TaskJuggler?',
				a: 'No. The aim is that you never write the syntax by hand: you drag and fill in fields, and Mainspring writes the file. Visual editing is coming. Until then you edit the text, and the editor’s completion, inline errors and keyword docs help you along.',
			},
			{
				q: 'Where do my plans live?',
				a: 'In your browser tab, today. Changes stay there until saving arrives, so copy your text out before you close the tab. Saving to a folder and GitHub sync are coming, and your plan will always be a plain text file you own.',
			},
			{
				q: 'Is it free?',
				a: 'Yes. Mainspring is open source under GPL-2.0-or-later. There is no sign-up, and no server holds your plan.',
			},
			{
				q: 'Can I use my existing TaskJuggler files?',
				a: 'Yes. Mainspring runs TaskJuggler 3.8.4 itself, and a plan is an ordinary .tjp file. Paste it into the editor today. Opening files from a folder is coming.',
			},
		],
	},
	builtOn: {
		id: 'taskjuggler',
		eyebrow: 'Built on TaskJuggler',
		before: 'Built on ',
		accent: 'TaskJuggler',
		after: '.',
		lead: 'Mainspring does not reimplement scheduling. It runs TaskJuggler 3.8.4, the open-source project scheduler, unmodified, inside a Web Worker in your browser. TaskJuggler is the work of its authors and contributors. Learn more at ',
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
	closing: {
		before: 'Try a plan ',
		accent: 'in your browser',
		after: '.',
		lead: 'The app opens with a sample plan. Edit the text and watch the Gantt and the dates change. No account and nothing to install.',
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
