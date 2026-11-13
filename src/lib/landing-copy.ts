// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Copy for the public landing page (src/pages/index.astro, ADR-0011). The app keeps its own copy
 * in strings.ts; the marketing page has its own file so the two can change at different speeds.
 * This file holds the top of the page (hero, plans as code, no syntax, the scheduler, the
 * audience); landing-copy-more.ts holds the rest. `landing` joins them.
 *
 * Audience: technical project managers and engineering leads, not TaskJuggler users. The draw is
 * to build a plan with visual tools and get a plain-text file that can be version controlled;
 * TaskJuggler is the proof that the scheduling is serious, not a prerequisite.
 *
 * Honesty rule: a feature is described as available only if it works in the app today. Visual
 * editing (drag, link, assign) is not built yet. Everything planned is in `coming`, taken from
 * docs/BUILD_PLAN.md, and the page marks it with a "Coming" tag.
 */
import { more } from './landing-copy-more';

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
	| 'external'
	| 'git-pull-request'
	| 'history'
	| 'git-branch'
	| 'clock'
	| 'users'
	| 'calendar'
	| 'route'
	| 'wrench';

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

const top = {
	meta: {
		title: 'Mainspring: plan visually, version it like code',
		description:
			'Mainspring is project planning for technical teams. Plan on a Gantt chart and keep the plan as a plain-text file you can commit, diff and review. A proven scheduling engine works out the dates. Free and open source.',
	},
	nav: {
		label: 'Main',
		home: 'Mainspring, home',
		repo: 'Why plain text',
		scheduler: 'The scheduler',
		features: 'Features',
		faq: 'FAQ',
		source: 'GitHub',
		openApp: 'Open app',
	},
	hero: {
		eyebrow: 'Project planning for technical teams',
		before: 'Plan visually. ',
		accent: 'Version it like code.',
		after: '',
		lead: 'Drag tasks, link dependencies and assign people on a Gantt chart. Mainspring writes everything to a plain-text plan you can commit, diff and review alongside your work, and a proven scheduling engine works out the dates.',
		openApp: 'Open the app',
		secondary: 'Why plain text',
		facts: ['No syntax to learn', 'Your files, your repo', 'Real resource leveling', 'Open source'],
		note: 'Early preview: today you edit the text and see the Gantt. Drag-and-drop editing is coming next.',
		mockLabel:
			'Mainspring in Split view. The plain-text plan is on the left and its Gantt chart on the right, for the same four tasks. The Design task is selected in both, and its effort 5d line is highlighted.',
	},
	mock: {
		brand: 'Mainspring',
		plan: 'plan.tjp',
		modes: ['Text', 'Split', 'Visual'],
		activeMode: 1,
		status: 'Scheduled',
		months: [
			{ name: 'December', year: '2025', day: 0 },
			{ name: 'January', year: '2026', day: 10 },
		],
		ticks: ['Dec 22', 'Dec 29', 'Jan 5', 'Jan 12'],
		chips: ['Today', 'Critical path'],
	},
	repo: {
		id: 'repo',
		eyebrow: 'Plans as code',
		before: 'Why your plan belongs in ',
		accent: 'your repository',
		after: '.',
		lead: 'A plan in your repository gets everything your code already has.',
		benefits: [
			{
				icon: 'git-pull-request',
				title: 'Review plan changes like code',
				body: 'A change to the plan is a diff. Your team comments on the lines and approves it before it lands.',
			},
			{
				icon: 'history',
				title: 'History and who changed what',
				body: 'Every version is a commit with an author and a message. See when a date moved, and why.',
			},
			{
				icon: 'git-branch',
				title: 'Branch a what-if',
				body: 'Try another staffing or scope on a branch. Merge it, or throw it away.',
			},
			{
				icon: 'unlock',
				title: 'No vendor lock-in',
				body: 'Your plan is a text file in your repository, not a record in someone else’s database.',
			},
			{
				icon: 'file-text',
				title: 'Plain text outlives any tool',
				body: 'Any editor and any tool can read it, now and later.',
			},
		] satisfies FeatureCopy[],
		note: 'Mainspring does not commit for you yet. Copy the text into your repository today. Saving to a folder and GitHub sync are coming.',
		pr: {
			label:
				'A pull request that changes one line of plan.tjp, from effort 5d to effort 8d. A note says the finish moves from Jan 6 to Jan 9.',
			title: 'Give Design more time',
			meta: 'ana wants to merge 1 commit into main',
			open: 'Open',
			file: 'plan.tjp',
			stats: '+1 −1',
			effect: 'Finish moves Jan 6 → Jan 9',
			effectTag: 'Schedule diff',
			caption:
				'An illustration. The schedule diff is coming. The review itself works in any git host today.',
		},
	},
	syntax: {
		id: 'syntax',
		eyebrow: 'No syntax to learn',
		before: 'No ',
		accent: 'syntax',
		after: ' to learn.',
		lead: 'Build the plan on the Gantt chart. Every drag or field edit becomes a small, clean text change, so you never need to learn the file format. If you like the syntax, the text editor is right there, with completion and inline errors, and both views stay in sync.',
		points: [
			{
				icon: 'move',
				title: 'Drag, link and assign',
				body: 'Resize a bar, draw a dependency, drop a person on a task.',
				coming: true,
			},
			{
				icon: 'file-text',
				title: 'Every change is a small text edit',
				body: 'Only the lines you touched change, so diffs stay clean and undo works.',
				coming: true,
			},
			{
				icon: 'code',
				title: 'The text editor is right there',
				body: 'Completion, inline errors and keyword docs. Edit the text and the chart follows.',
				coming: false,
			},
		] satisfies Array<FeatureCopy & { coming: boolean }>,
		next: 'Visual editing is the next step.',
		nextBody: 'Today you edit the text and the Gantt follows. Dragging comes next.',
		mock: {
			label:
				'Resizing the Design bar on the Gantt from five days to eight changes one line of plan.tjp, effort 5d to effort 8d.',
			gantt: 'On the Gantt',
			text: 'In plan.tjp',
			writes: 'becomes',
			drag: '8d',
		},
	},
	scheduler: {
		id: 'scheduler',
		eyebrow: 'The scheduling engine',
		before: 'A scheduler that does ',
		accent: 'the hard part',
		after: '.',
		lead: 'You say what needs doing and who is free. The scheduler works out the dates, and works them out again whenever anything changes.',
		items: [
			{
				icon: 'clock',
				title: 'Effort, not guesses',
				body: 'Ten days of work for two people takes five days on the calendar. Swap who is on the task and the dates follow.',
				art: 'effort',
			},
			{
				icon: 'users',
				title: 'Nobody is double-booked',
				body: 'A person works on one thing at a time. If Ana is busy, the next task waits until she is free, or goes to someone you named instead.',
				art: 'leveling',
			},
			{
				icon: 'calendar',
				title: 'Holidays and leave',
				body: 'Mark public holidays and time off. Work skips them, and the finish date accounts for them.',
				art: 'leave',
			},
			{
				icon: 'route',
				title: 'The critical path',
				body: 'The chain of tasks that sets your finish date. A slip on it moves the finish, so the chart marks it in red.',
				art: 'critical',
			},
		] satisfies Array<FeatureCopy & { art: 'effort' | 'leveling' | 'leave' | 'critical' }>,
		art: {
			work: '10d of work',
			calendar: '5 days',
			leave: 'Leave',
			ana: 'Ana',
			ben: 'Ben',
			float: 'Has float',
		},
		poweredBy:
			'Powered by TaskJuggler, a mature open-source scheduler. On our golden test plans, the results are identical to its own command-line tool.',
	},
	audience: {
		id: 'audience',
		eyebrow: 'Who it is for',
		before: 'For people who already ',
		accent: 'live in git',
		after: '.',
		lead: 'If your code already has branches, reviews and history, your plan can too.',
		who: [
			{
				icon: 'code',
				title: 'Engineering leads',
				body: 'Keep the plan beside the code. Review a change to the schedule the way you review a change to the software.',
			},
			{
				icon: 'gantt',
				title: 'Technical project managers',
				body: 'Plan with real effort, people and dependencies, and keep a history of every change to the plan.',
			},
			{
				icon: 'wrench',
				title: 'Hardware and systems teams',
				body: 'Boards, firmware, test rigs and suppliers in one plan, in the same repository as the project files.',
			},
		] satisfies FeatureCopy[],
	},
};

export const landing = { ...top, ...more } as const;
