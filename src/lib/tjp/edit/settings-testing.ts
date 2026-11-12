// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for the T11d intents (resource-tree.ts, resource-attrs.ts, project.ts,
 * calendar.ts, calendar-leaves.ts): random intents over the golden and T16 fixture workspaces
 * (links-testing.ts `linkCorpora`) for fast-check, and a check of what each intent must mean in
 * the index rebuilt from the edited text (9.3 P3). Test-only.
 */
import fc from 'fast-check';
import { lastSite } from '../index';
import {
	applyWorkingHours,
	parseValue,
	sameValue,
	TJ_WEEKDAYS,
	type WeekTable,
	type Weekday,
} from '../values';
import type { LinkCorpus } from './links-testing';
import type { EditIntent, LeaveSpec, LeaveType } from './types';

export const SETTING_TYPES = [
	'addResource',
	'deleteResource',
	'moveResource',
	'renameResource',
	'setResourceAttr',
	'removeResourceAttr',
	'setProjectHeader',
	'setProjectAttr',
	'removeProjectAttr',
	'setWorkingHours',
	'addLeave',
	'updateLeave',
	'removeLeave',
] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

const NAMES = ['New person', 'Zoë "Z"', "O'Neil", 'Team B', 'x'];
const LEAVE_TYPES: readonly LeaveType[] = ['holiday', 'annual', 'special', 'sick', 'unpaid'];
const HOURS: ReadonlyArray<ReadonlyArray<readonly [string, string]> | 'off'> = [
	'off',
	[['9:00', '17:00']],
	[
		['8:00', '12:00'],
		['13:00', '17:00'],
	],
	[['10:00', '14:00']],
];

/** `YYYY-MM-DD` of the project start plus `days`. */
function dayText(c: LinkCorpus, days: number): string {
	const start = c.index.project?.start ?? Date.UTC(2026, 0, 5) / 1000;
	return new Date((start + days * 86400) * 1000).toISOString().slice(0, 10);
}

function leaveArb(c: LinkCorpus): fc.Arbitrary<LeaveSpec> {
	return fc
		.record({
			type: fc.constantFrom(...LEAVE_TYPES),
			day: fc.integer({ min: 0, max: 40 }),
			len: fc.constantFrom(null, '+1d', '+3d', 2),
			named: fc.boolean(),
		})
		.map(({ type, day, len, named }) => ({
			type,
			start: dayText(c, day),
			...(len === null ? {} : { end: typeof len === 'number' ? dayText(c, day + len) : len }),
			...(named ? { name: 'Away' } : {}),
		}));
}

/** Whether corpus `c` can give `type` something to work on (leave items to edit). */
export function usable(c: LinkCorpus, type: SettingType): boolean {
	if (type === 'updateLeave' || type === 'removeLeave') return c.index.leaves.length > 0;
	if (type === 'removeResourceAttr') return c.resources.length > 0;
	return true;
}

/** A random intent of `type` on corpus `c`. */
export function settingArb(c: LinkCorpus, type: SettingType): fc.Arbitrary<EditIntent> {
	const res = c.resources.length > 0 ? fc.constantFrom(...c.resources) : fc.constant('nobody');
	const parent = fc.oneof(fc.constant(null), res);
	const at = fc.integer({ min: 0, max: 6 });
	const name = fc.constantFrom(...NAMES);
	const items = c.index.leaves.flatMap((l) => l.items);
	const item = items.length > 0 ? fc.constantFrom(...items) : fc.constant(null);
	const scope = fc.oneof(
		fc.constant({ kind: 'project' as const }),
		res.map((resource) => ({ kind: 'resource' as const, resource })),
	);
	switch (type) {
		case 'addResource':
			return fc
				.record({ parent, at, name, eff: fc.constantFrom(null, '0.5', '2.0') })
				.map(({ parent: p, at: i, name: n, eff }) => ({
					type,
					parent: p,
					index: i,
					name: n,
					...(eff ? { attrs: [['efficiency', eff] as const] } : {}),
				}));
		case 'deleteResource':
			return res.map((resource) => ({ type, resource }));
		case 'moveResource':
			return fc
				.record({ resource: res, parent, at })
				.map((x) => ({ type, resource: x.resource, parent: x.parent, index: x.at }));
		case 'renameResource':
			return fc.record({ resource: res, name }).map((x) => ({ type, ...x }));
		case 'setResourceAttr':
			return fc
				.record({
					resource: res,
					pick: fc.constantFrom<readonly [string, string | string[]]>(
						['efficiency', '0.5'],
						['efficiency', '1.25'],
						['rate', '400'],
						['email', '"someone@example.com"'],
					),
					managers: fc.uniqueArray(res, { minLength: 1, maxLength: 2 }),
					useManagers: fc.boolean(),
				})
				.map(({ resource, pick, managers, useManagers }) =>
					useManagers
						? { type, resource, attr: 'managers' as const, value: managers }
						: { type, resource, attr: pick[0] as 'efficiency', value: pick[1] },
				);
		case 'removeResourceAttr': {
			const own = [...c.index.resources.values()].flatMap((r) =>
				r.attrs
					.filter((a) => ['efficiency', 'rate', 'email', 'managers'].includes(a.keyword))
					.map((a) => ({ resource: r.id, attr: a.keyword as 'rate' })),
			);
			const any = fc
				.record({ resource: res, attr: fc.constantFrom('efficiency', 'rate', 'email', 'managers') })
				.map((x) => ({ resource: x.resource, attr: x.attr as 'rate' }));
			const pick =
				own.length > 0 ? fc.oneof(any, fc.constantFrom(...own), fc.constantFrom(...own)) : any;
			return pick.map((x) => ({ type, ...x }));
		}
		case 'setProjectHeader':
			return fc
				.oneof(
					name.map((n) => ({ name: n })),
					fc.integer({ min: 30, max: 400 }).map((d) => ({ end: dayText(c, d) })),
					fc.constantFrom('+3m', '+40d').map((end) => ({ end })),
					fc.integer({ min: -20, max: 3 }).map((d) => ({ start: dayText(c, d) })),
				)
				.map((h) => ({ type, ...h }));
		case 'setProjectAttr':
			return fc
				.oneof(
					fc
						.constantFrom('"UTC"', '"Europe/Berlin"', '"America/New_York"', '"Asia/Kathmandu"')
						.map((value) => ({ attr: 'timezone' as const, value })),
					fc
						.integer({ min: 0, max: 30 })
						.map((d) => ({ attr: 'now' as const, value: dayText(c, d) })),
					fc
						.constantFrom('7', '8.5')
						.map((value) => ({ attr: 'dailyworkinghours' as const, value })),
					fc.constantFrom('"EUR"', '"USD"').map((value) => ({ attr: 'currency' as const, value })),
					fc.constant({ attr: 'timeformat' as const, value: '"%Y-%m-%d"' }),
					fc.boolean().map((value) => ({ attr: 'weekstartsmonday' as const, value })),
				)
				.map((x) => ({ type, ...x }));
		case 'removeProjectAttr':
			return fc
				.constantFrom(
					'timezone',
					'now',
					'timeformat',
					'currency',
					'dailyworkinghours',
					'weekstartsmonday',
				)
				.map((attr) => ({ type, attr: attr as 'now' }));
		case 'setWorkingHours':
			return fc
				.record({
					scope,
					days: fc.uniqueArray(fc.constantFrom<Weekday>(...TJ_WEEKDAYS), {
						minLength: 1,
						maxLength: 7,
					}),
					hours: fc.constantFrom(...HOURS),
				})
				.map((x) => ({ type, ...x }));
		case 'addLeave':
			return fc
				.record({
					scope: fc.oneof(fc.constant({ kind: 'global' as const }), scope),
					leave: leaveArb(c),
				})
				.map((x) => ({ type, ...x }));
		case 'updateLeave':
			return fc.record({ item, to: leaveArb(c) }).map(({ item: i, to }) => ({
				type,
				leave: { item: i ?? { file: '', from: 0, to: 0 } },
				to,
			}));
		case 'removeLeave':
			return item.map((i) => ({ type, leave: { item: i ?? { file: '', from: 0, to: 0 } } }));
	}
}

const treeOf = (c: LinkCorpus, kind: 'task' | 'resource'): string =>
	[...(kind === 'task' ? c.index.tasks : c.index.resources).values()]
		.map((s) => `${s.id}<${s.parent ?? ''}`)
		.sort()
		.join(',');

const leaveCount = (c: LinkCorpus): number =>
	c.index.leaves.reduce((n, l) => n + l.items.length, 0);

/** The week a scope's own statements give, starting from an empty week. */
function ownWeek(c: LinkCorpus, scope: { kind: string; resource?: string }): WeekTable {
	let week: WeekTable = TJ_WEEKDAYS.map(() => [[-1, -1] as const]);
	for (const w of c.index.workingHours) {
		const same =
			w.scope.kind === scope.kind &&
			(scope.kind === 'project' || ('resource' in w.scope && w.scope.resource === scope.resource));
		const top = w.attr.scenario === null || w.attr.scenario === c.index.scenarios[0]?.id;
		if (same && top && w.attr.parsed?.kind === 'workinghours')
			week = applyWorkingHours(week, w.attr.parsed.value);
	}
	return week;
}

/** What the intent must mean in the rebuilt index (9.3 P3); a message when it does not. */
export function settingProblem(
	before: LinkCorpus,
	after: LinkCorpus,
	intent: EditIntent,
): string | null {
	const tree = intent.type.endsWith('Resource') && intent.type !== 'renameResource';
	if (treeOf(before, 'task') !== treeOf(after, 'task')) return 'task tree changed';
	if (!tree && treeOf(before, 'resource') !== treeOf(after, 'resource'))
		return 'resource tree changed';
	const res = (id: string) => after.index.resources.get(id);
	switch (intent.type) {
		case 'addResource': {
			const added = [...after.index.resources.keys()].filter(
				(id) => !before.index.resources.has(id),
			);
			const r = added.length === 1 ? res(added[0] as string) : undefined;
			if (!r || r.parent !== intent.parent || r.name !== intent.name)
				return `added ${added.join()}`;
			return null;
		}
		case 'deleteResource':
			return before.index.resources.size > after.index.resources.size && !res(intent.resource)
				? null
				: 'not deleted';
		case 'moveResource':
			return res(intent.resource)?.parent === intent.parent &&
				before.index.resources.size === after.index.resources.size
				? null
				: 'not moved';
		case 'renameResource':
			return res(intent.resource)?.name === intent.name ? null : 'not renamed';
		case 'setResourceAttr': {
			if (intent.attr === 'managers') return null;
			const site = lastSite(
				res(intent.resource)?.attrs ?? [],
				intent.attr,
				null,
				after.index.scenarios[0]?.id ?? null,
			);
			const want = parseValue(intent.attr === 'email' ? 'string' : 'number', String(intent.value));
			return site?.parsed && want.ok && sameValue(site.parsed, want.value) ? null : 'value not set';
		}
		case 'removeResourceAttr':
			return (res(intent.resource)?.attrs ?? []).some(
				(a) => a.keyword === intent.attr && a.scenario === null,
			)
				? 'still set'
				: null;
		case 'setProjectAttr': {
			const attrs = after.index.project?.attrs ?? [];
			if (intent.attr === 'weekstartsmonday') {
				const last = attrs.filter((a) => a.keyword.startsWith('weekstarts')).pop();
				return (last?.keyword === 'weekstartsmonday') === intent.value
					? null
					: 'week start not set';
			}
			const kind =
				intent.attr === 'now' ? 'date' : intent.attr === 'dailyworkinghours' ? 'number' : 'string';
			const site = lastSite(attrs, intent.attr);
			const want = parseValue(kind, String(intent.value));
			return site?.parsed && want.ok && sameValue(site.parsed, want.value) ? null : 'value not set';
		}
		case 'removeProjectAttr':
			return (after.index.project?.attrs ?? []).some((a) => a.keyword === intent.attr)
				? 'still set'
				: null;
		case 'setProjectHeader':
			return intent.name === undefined || after.index.project?.name === intent.name
				? null
				: 'name not set';
		case 'setWorkingHours': {
			const week = ownWeek(after, intent.scope);
			const hours =
				intent.hours === 'off'
					? []
					: intent.hours.map(([a, b]) =>
							[a, b].map((t) => {
								const [h, m] = t.split(':').map(Number);
								return (h ?? 0) * 60 + (m ?? 0);
							}),
						);
			for (const d of intent.days) {
				const got = week[TJ_WEEKDAYS.indexOf(d)] ?? [];
				if (JSON.stringify(got) !== JSON.stringify(hours))
					return `hours of ${d}: ${JSON.stringify(got)}`;
			}
			return null;
		}
		case 'addLeave':
			return leaveCount(after) === leaveCount(before) + 1 ? null : 'leave not added';
		case 'removeLeave':
			return leaveCount(after) === leaveCount(before) - 1 ? null : 'leave not removed';
		case 'updateLeave':
			return leaveCount(after) === leaveCount(before) ? null : 'leave count changed';
		default:
			return null;
	}
}
