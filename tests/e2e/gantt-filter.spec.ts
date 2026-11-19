// SPDX-License-Identifier: GPL-2.0-or-later
// The Gantt's filter by person and by flag (phase-3.md T19, "Amendments from T19"; 13.2 `gantt-filter.spec.ts`).
// On the small people plan (ui-people: five people, flags on a container and on single tasks; the
// oracle reads the result and the text, so it does not depend on the plan's size). The list of 24
// people scrolled to the chosen person is the one case left on fedora-res:
// - the rows the filter shows equal an oracle written here from the schedule result (a person's
//   booked and named tasks) and from the plan text (flags, as TaskJuggler inherits them), with the
//   ancestors of a match as context rows;
// - a person and a flag together intersect; a filter nothing matches says so and has a way out;
// - clearing restores the whole tree with its collapsed rows and its selection, and nothing in the
//   text or the schedule ever changed;
// - the keyboard path, axe in light and dark, the toolbar on one row, and 44 px targets on a phone.
// Desktop and Pixel 7 (Chromium).
// Over 400 lines on purpose: the oracle (about 150 lines: the result's person rule, and TaskJuggler's
// flag inheritance read from the text) is the point of the spec and must sit beside the cases that
// use it, so that it reads as independent of src/lib/gantt/filter.ts; the rest is one case per
// behaviour of the filter, each needing the same plan open.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ScheduleResult } from '../../src/engine/protocol';
import { READY_TIMEOUT_MS, Rig, isTouch } from './lib/gantt-rig';
import { animationsDone, boxStable, ganttSettled } from './lib/settle';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// A step that cannot be done fails in seconds, not at the test's end.
test.use({ actionTimeout: 15_000 });

// The oracle itself, on the probe plan run through native TaskJuggler (a taskreport with `columns id, flags`):
// app = early, late, sup; app.a = early; app.b = early, late; c = none in `plan`, `scen` in `delayed`.
test.describe('the flag oracle', () => {
	const PROBE = `project p "P" 2026-01-05 +30d {
  scenario plan "Plan" { scenario delayed "Delayed" }
}
flags early, late, sup, scen
task app "App" {
  flags early
  task a "A" { effort 1d }
  flags late
  task b "B" { effort 1d }
}
supplement task app { flags sup }
task c "C" { delayed:flags scen effort 1d }
`;
	const sorted = (m: Map<string, Set<string>>, id: string): string[] =>
		[...flagsOfTask(m, id)].sort();
	test('a flag after a child, a supplement and a scenario flag follow TaskJuggler', () => {
		const f = flagsOfText(PROBE);
		expect(sorted(f, 'app')).toEqual(['early', 'late', 'sup']);
		expect(sorted(f, 'app.a')).toEqual(['early']);
		expect(sorted(f, 'app.b')).toEqual(['early', 'late']);
		expect(sorted(f, 'c')).toEqual([]);
		expect(sorted(flagsOfText(PROBE, 'delayed'), 'c')).toEqual(['scen']);
	});
});

test.beforeEach(() => {
	test.setTimeout(READY_TIMEOUT_MS * 2);
});

interface ViewRow {
	key: string;
	depth: number;
	context: boolean;
	expanded: boolean | null;
}
type Win = {
	__mainspringGantt: { rows(): ViewRow[]; result(): ScheduleResult | null };
};
const viewRows = (page: Page): Promise<ViewRow[]> =>
	page.evaluate(() => (window as unknown as Win).__mainspringGantt.rows());
const resultOf = async (page: Page): Promise<ScheduleResult> => {
	const r = await page.evaluate(() => (window as unknown as Win).__mainspringGantt.result());
	if (!r) throw new Error('no result');
	return r;
};

// --- The oracle: written from the result and the text, sharing nothing with src/lib/gantt/filter.ts.

const scenarioOf = (r: ScheduleResult): string => {
	const s = r.project?.scenarios.find((x) => x.active);
	if (!s) throw new Error('no active scenario');
	return s.id;
};
const leavesOf = (r: ScheduleResult): Set<string> => {
	const parents = new Set(r.tasks.flatMap((t) => (t.parent === null ? [] : [t.parent])));
	return new Set(r.tasks.filter((t) => !parents.has(t.id)).map((t) => t.id));
};
/** Leaf tasks a person is booked on, or is the first candidate of an `allocate` item written for. */
function tasksOf(r: ScheduleResult, person: string): Set<string> {
	const sc = scenarioOf(r);
	const out = new Set<string>();
	for (const t of r.tasks) {
		const s = t.scenarios[sc];
		// A milestone ignores the `allocate` it inherits (TaskScenario.rb:583): only a booking counts.
		const asked = !t.milestone && s?.allocate.some((a) => a.candidates[0] === person);
		if (s?.allocated.includes(person) || asked) out.add(t.id);
	}
	for (const b of r.bookings) {
		if (b.scenario === sc && b.resource === person && b.intervals.length > 0) out.add(b.task);
	}
	const leaves = leavesOf(r);
	return new Set([...out].filter((id) => leaves.has(id)));
}

/**
 * The flags each task carries, from the plan text, as TaskJuggler gives them (checked with native
 * TaskJuggler on the probe plan below: a `taskreport` with `columns id, flags`). A parent's flags are
 * copied into a child once, when the child's header is read, so a child has its own and those its
 * parent had written before the child's `task` keyword; a `flags` after the child, or in a later
 * `supplement`, is not inherited by it. A `scen:flags` counts only for the shown scenario.
 * `purge flags` is not handled (the plans have none).
 */
function flagsOfText(text: string, shown = 'plan'): Map<string, Set<string>> {
	// The root's id is a macro (`${content}${major}`, defined in the same file as `f` and `20`).
	const source = text.replaceAll('${content}${major}', 'f20');
	const tokens =
		source
			.match(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|#[^\n]*|\{|\}|,|[^\s{},"#]+/g)
			?.filter((t) => !t.startsWith('#') && !t.startsWith('/*')) ?? [];
	/** A task's `flags` statements: where (the token index) and the names. */
	const own = new Map<string, Array<{ at: number; flags: string[] }>>();
	const header = new Map<string, number>();
	const parentOf = new Map<string, string | null>();
	const stack: Array<string | null> = [];
	let pending: string | null = null;
	const taskId = (): string | null => {
		for (let i = stack.length - 1; i >= 0; i--) {
			const id = stack[i];
			if (id !== null && id !== undefined) return id;
		}
		return null;
	};
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i] as string;
		if (t === 'task' && pending === null) {
			const id = tokens[i + 1] as string;
			const after = tokens[i + 2] as string;
			const brace = after?.startsWith('"') ? tokens[i + 3] : after;
			if (brace === '{') {
				if (tokens[i - 1] === 'supplement') {
					// A supplement adds to a task declared earlier, under its full id.
					pending = id;
				} else {
					const parent = taskId();
					pending = parent === null ? id : `${parent}.${id}`;
					header.set(pending, i);
					parentOf.set(pending, parent);
				}
				i++;
			}
		} else if (t === '{') {
			stack.push(pending);
			pending = null;
		} else if (t === '}') {
			stack.pop();
		} else if (/^(?:\w+:)?flags$/.test(t) && stack.length > 0 && stack[stack.length - 1] !== null) {
			const scenario = t.includes(':') ? t.slice(0, t.indexOf(':')) : null;
			const id = stack[stack.length - 1] as string;
			const names: string[] = [];
			for (let j = i + 1; j < tokens.length; j += 2) {
				names.push(tokens[j] as string);
				if (tokens[j + 1] !== ',') break;
			}
			if (scenario === null || scenario === shown) {
				own.set(id, [...(own.get(id) ?? []), { at: i, flags: names }]);
			}
		}
	}
	const created = new Map<string, Set<string>>();
	const atCreation = (id: string): Set<string> => {
		const known = created.get(id);
		if (known) return known;
		const parent = parentOf.get(id) ?? null;
		const set = new Set<string>(parent === null ? [] : atCreation(parent));
		if (parent !== null) {
			for (const o of own.get(parent) ?? []) {
				if (o.at < (header.get(id) ?? 0)) for (const f of o.flags) set.add(f);
			}
		}
		created.set(id, set);
		return set;
	};
	const all = new Map<string, Set<string>>();
	for (const id of header.keys()) {
		const set = new Set(atCreation(id));
		for (const o of own.get(id) ?? []) for (const f of o.flags) set.add(f);
		all.set(id, set);
	}
	return all;
}
const flagsOfTask = (flags: Map<string, Set<string>>, id: string): Set<string> =>
	flags.get(id) ?? new Set();
const tasksWith = (
	r: ScheduleResult,
	flags: Map<string, Set<string>>,
	flag: string,
): Set<string> => {
	const leaves = leavesOf(r);
	return new Set(
		r.tasks.filter((t) => leaves.has(t.id) && flagsOfTask(flags, t.id).has(flag)).map((t) => t.id),
	);
};

/** The rows that show for a set of matched leaves: the matches and their ancestors, in order. */
function expectedKeys(r: ScheduleResult, matched: ReadonlySet<string>): string[] {
	const parent = new Map(r.tasks.map((t) => [t.id, t.parent]));
	const keep = new Set<string>();
	for (const id of matched) {
		for (let k: string | null | undefined = id; k; k = parent.get(k)) keep.add(k);
	}
	return r.tasks.filter((t) => keep.has(t.id)).map((t) => `task:${t.id}`);
}

const intersect = (a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> =>
	new Set([...a].filter((x) => b.has(x)));

// --- The page.

async function open(
	page: Page,
	info: Parameters<typeof Rig.open>[1],
	width = 1280,
	plan = 'ui-people',
): Promise<Rig> {
	if (!isTouch(info)) await page.setViewportSize({ width, height: 720 });
	return Rig.open(page, info, 'month', 'visual', plan);
}
const button = (page: Page): Locator => page.getByTestId('filter-button');
const panel = (page: Page): Locator => page.getByTestId('filter-panel');

async function openPanel(page: Page): Promise<void> {
	await button(page).click();
	await expect(panel(page)).toBeVisible();
}
async function choosePerson(page: Page, id: string, name: string): Promise<void> {
	const search = page.getByRole('combobox', { name: 'Find a person to filter by' });
	await search.fill(name);
	await panel(page).locator(`[role="option"][data-person="${id}"]`).click();
}
const flagRadio = (page: Page, flag: string): Locator =>
	panel(page).getByRole('radio', { name: new RegExp(`^${flag}\\b`) });
async function chooseFlag(page: Page, flag: string): Promise<void> {
	await flagRadio(page, flag).check();
}
/** The × beside the pill, or, where the row has no room for it (a phone), Clear filter in the panel. */
async function clearFilter(page: Page): Promise<void> {
	const x = page.getByTestId('filter-clear');
	if (await x.isVisible()) {
		await x.click();
	} else {
		await openPanel(page);
		await panel(page).getByRole('button', { name: 'Clear filter' }).click();
		await closePanel(page);
	}
	await expect(button(page)).not.toHaveAccessibleName(/Filter:/);
}
async function closePanel(page: Page): Promise<void> {
	await panel(page).getByRole('button', { name: 'Done' }).click();
	await expect(panel(page)).toBeHidden();
}

/** What the Gantt shows must equal the oracle: the keys in order, which are context, and the DOM. */
async function expectRows(
	page: Page,
	r: ScheduleResult,
	matched: ReadonlySet<string>,
	state: string,
): Promise<void> {
	const want = expectedKeys(r, matched);
	await expect
		.poll(async () => (await viewRows(page)).map((x) => x.key), { message: state })
		.toEqual(want);
	const rows = await viewRows(page);
	expect(
		rows.filter((x) => !x.context).map((x) => x.key),
		`${state}: the matches are not context`,
	).toEqual(want.filter((k) => matched.has(k.slice(5))));
	// The task list shows the same rows, in the same order (it mounts the rows near the viewport).
	const dom = await page
		.locator('[role="row"][data-key]')
		.evaluateAll((els) => els.map((e) => e.getAttribute('data-key') ?? ''));
	expect(dom.length, state).toBeGreaterThan(0);
	expect(dom, state).toEqual(want.slice(0, dom.length));
}

/** A person whose tasks are a few, so the oracle is checked on a short, readable list. */
function aPerson(r: ScheduleResult): { id: string; name: string; tasks: Set<string> } {
	const people = r.resources.filter((x) => !x.group);
	for (const p of people) {
		const tasks = tasksOf(r, p.id);
		if (tasks.size >= 3 && tasks.size <= 40) return { id: p.id, name: p.name, tasks };
	}
	throw new Error('no suitable person');
}

test.describe('filter by person', () => {
	test('shows the tasks of the person and their ancestors, and the oracle agrees', async ({
		page,
	}, info) => {
		const rig = await open(page, info);
		const r = await resultOf(page);
		const all = await viewRows(page);
		const before = await rig.text();
		const revision = await rig.revision();
		const person = aPerson(r);
		await openPanel(page);
		await choosePerson(page, person.id, person.name);
		await closePanel(page);

		await expectRows(page, r, person.tasks, `person ${person.id}`);
		const rows = await viewRows(page);
		expect(rows.length).toBeLessThan(all.length);
		expect(rows.some((x) => x.context)).toBe(true);
		// The toolbar names the filter, and the line over the task table (the live region) says which
		// it is and how many tasks it shows, so a filtered chart is never unlabelled.
		await expect(button(page)).toHaveAccessibleName(`Filter: ${person.name}`);
		await expect(button(page)).toHaveAttribute('title', `Filter: ${person.name}`);
		const note = page.getByTestId('filter-note');
		await expect(note).toHaveText(
			`${person.name} \u00b7 ${person.tasks.size === 1 ? '1 task' : `${person.tasks.size} tasks`}`,
		);
		await expect(note).toBeVisible();
		await expect(note).toHaveAttribute('role', 'status');
		// It sits in the empty band of the table's header, over the column titles.
		const noteBox = await note.boundingBox();
		const head = await page.locator('[data-col-head="name"]').boundingBox();
		if (!noteBox || !head) throw new Error('no boxes');
		// (the column title cells run the header's whole height, their words at the foot).
		expect(noteBox.y).toBeGreaterThanOrEqual(head.y);
		expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(head.y + head.height * 0.7);
		// A row kept only for context says so to a screen reader; a match does not.
		const ctx = rows.find((x) => x.context);
		const hit = rows.find((x) => !x.context);
		await expect(rig.row(ctx?.key ?? '')).toHaveAttribute(
			'aria-label',
			/Shown because a task under it matches/,
		);
		await expect(rig.row(hit?.key ?? '')).not.toHaveAttribute('aria-label', /Shown because/);
		// A view state only: the text and the schedule are as they were.
		expect(await rig.text()).toBe(before);
		expect(await rig.revision()).toBe(revision);
	});

	test('choosing the same person again takes the filter off', async ({ page }, info) => {
		await open(page, info);
		const r = await resultOf(page);
		const all = await viewRows(page);
		const person = aPerson(r);
		await openPanel(page);
		await choosePerson(page, person.id, person.name);
		await expect(button(page)).toHaveAccessibleName(`Filter: ${person.name}`);
		await choosePerson(page, person.id, person.name);
		await expect(button(page)).not.toHaveAccessibleName(/Filter:/);
		await expect(page.getByTestId('filter-clear')).toBeHidden();
		expect((await viewRows(page)).length).toBe(all.length);
	});
});

test.describe('filter by flag', () => {
	test('shows the tasks that carry the flag, inherited ones included, and the oracle agrees', async ({
		page,
	}, info) => {
		const rig = await open(page, info);
		const r = await resultOf(page);
		const flags = flagsOfText(await rig.text());
		const key = tasksWith(r, flags, 'urgent');
		expect(key.size, 'the oracle finds tasks with the flag `urgent`').toBeGreaterThan(3);
		const before = await rig.text();
		await openPanel(page);
		await chooseFlag(page, 'urgent');
		await closePanel(page);
		await expectRows(page, r, key, 'flag urgent');
		await expect(button(page)).toHaveAccessibleName('Filter: flag urgent');

		// An inherited flag: `urgent` is written on a container whose children carry it too.
		for (const flag of ['urgent', 'review']) {
			await openPanel(page);
			await chooseFlag(page, flag);
			await closePanel(page);
			await expectRows(page, r, tasksWith(r, flags, flag), `flag ${flag}`);
		}
		expect(await rig.text()).toBe(before);
	});

	test('lists the flags in use with how many tasks carry each', async ({ page }, info) => {
		const rig = await open(page, info);
		const r = await resultOf(page);
		const flags = flagsOfText(await rig.text());
		await openPanel(page);
		const radios = panel(page).getByRole('radio');
		const names = await radios.evaluateAll((els) =>
			els.map((e) => e.closest('label')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
		);
		expect(names[0]).toBe('Any flag');
		for (const flag of ['urgent', 'review', 'later']) {
			const n = tasksWith(r, flags, flag).size;
			expect(
				names.some((x) => x.startsWith(`${flag} ${n}, `) && x.endsWith(`${n} tasks`)),
				`${flag} ${n} in ${names.join('|')}`,
			).toBe(true);
		}
	});
});

test.describe('both together, and nothing', () => {
	test('a person and a flag intersect', async ({ page }, info) => {
		const rig = await open(page, info);
		const r = await resultOf(page);
		const flags = flagsOfText(await rig.text());
		// A person and a flag whose tasks overlap, but neither contains the other.
		let pick: {
			id: string;
			name: string;
			flag: string;
			both: Set<string>;
			person: Set<string>;
		} | null = null;
		for (const p of r.resources.filter((x) => !x.group)) {
			const mine = tasksOf(r, p.id);
			for (const flag of ['urgent', 'review', 'later']) {
				const withFlag = tasksWith(r, flags, flag);
				const both = intersect(mine, withFlag);
				if (both.size >= 2 && both.size < mine.size && both.size < withFlag.size) {
					pick = { id: p.id, name: p.name, flag, both, person: mine };
					break;
				}
			}
			if (pick) break;
		}
		if (!pick) throw new Error('no person and flag with a proper overlap');
		await openPanel(page);
		await choosePerson(page, pick.id, pick.name);
		await chooseFlag(page, pick.flag);
		await closePanel(page);
		await expectRows(page, r, pick.both, `${pick.id} and ${pick.flag}`);
		await expect(button(page)).toHaveAccessibleName(
			`Filter: ${pick.name} \u00b7 flag ${pick.flag}`,
		);
		// Taking the flag off leaves the person; the person off leaves nothing.
		await openPanel(page);
		await panel(page).getByRole('radio', { name: 'Any flag' }).check();
		await closePanel(page);
		await expectRows(page, r, pick.person, `${pick.id} alone`);
	});

	test('a filter nothing matches says so, and Clear filter brings the tree back', async ({
		page,
	}, info) => {
		const rig = await open(page, info);
		const r = await resultOf(page);
		const flags = flagsOfText(await rig.text());
		const all = (await viewRows(page)).length;
		let empty: { id: string; name: string; flag: string } | null = null;
		for (const p of r.resources.filter((x) => !x.group)) {
			const mine = tasksOf(r, p.id);
			for (const flag of ['urgent', 'review', 'later']) {
				if (intersect(mine, tasksWith(r, flags, flag)).size === 0) {
					empty = { id: p.id, name: p.name, flag };
					break;
				}
			}
			if (empty) break;
		}
		if (!empty) throw new Error('no empty combination');
		await openPanel(page);
		await choosePerson(page, empty.id, empty.name);
		await chooseFlag(page, empty.flag);
		await expect(panel(page).getByTestId('filter-count')).toHaveText('No task matches the filter');
		await closePanel(page);
		await expect(page.getByTestId('filter-empty')).toContainText('No task matches this filter.');
		expect(await viewRows(page)).toEqual([]);
		await page.getByTestId('filter-empty').getByRole('button', { name: 'Clear filter' }).click();
		await expect(page.getByTestId('filter-empty')).toBeHidden();
		expect((await viewRows(page)).length).toBe(all);
		await expect(button(page)).not.toHaveAccessibleName(/Filter:/);
	});
});

test.describe('the cleared state', () => {
	test('restores the tree with its collapsed rows and its selection, and the text never changed', async ({
		page,
	}, info) => {
		const rig = await open(page, info);
		const r = await resultOf(page);
		const text = await rig.text();
		const revision = await rig.revision();
		const person = aPerson(r);
		// Close the container (one level under the root) that holds one of the person's tasks.
		const grid = page.getByTestId('gantt-treegrid');
		const deep = [...person.tasks].find((id) => id.split('.').length >= 3);
		if (!deep) throw new Error('no task of the person under a container');
		const container = `task:${deep.split('.').slice(0, 2).join('.')}`;
		await rig.row(container).locator('.twisty').click();
		const closed = await viewRows(page);
		expect(closed.find((x) => x.key === container)?.expanded).toBe(false);

		await openPanel(page);
		await choosePerson(page, person.id, person.name);
		await closePanel(page);
		// The filter opens what it finds: the container the person's tasks are under is open.
		await expectRows(page, r, person.tasks, 'filtered, with a container closed before');

		await clearFilter(page);
		// The tree is as it was left: the same rows, the closed container still closed.
		expect((await viewRows(page)).map((x) => [x.key, x.expanded, x.context])).toEqual(
			closed.map((x) => [x.key, x.expanded, false]),
		);
		await expect(grid).toBeVisible();
		expect(await rig.text()).toBe(text);
		expect(await rig.revision()).toBe(revision);
	});

	test('keeps the selected task selected and in view through a filter and its clearing', async ({
		page,
	}, info) => {
		const rig = await open(page, info);
		const r = await resultOf(page);
		const person = aPerson(r);
		const task = [...person.tasks][0] as string;
		await rig.select(task);
		await openPanel(page);
		await choosePerson(page, person.id, person.name);
		await closePanel(page);
		// Below the sticky header and above the foot of the scroller (a phone's task line floats there).
		const inView = async (): Promise<string> =>
			rig.row(`task:${task}`).evaluate((el) => {
				const box = el.getBoundingClientRect();
				const scroller = el.closest('.scroller')?.getBoundingClientRect();
				if (!scroller) return 'no scroller';
				const head =
					document.querySelector('.head')?.getBoundingClientRect().bottom ?? scroller.top;
				return box.top >= head - 0.5 && box.bottom <= scroller.bottom + 0.5
					? 'in view'
					: `row ${Math.round(box.top)}-${Math.round(box.bottom)}, header ends ${Math.round(head)}, scroller ends ${Math.round(scroller.bottom)}`;
			});
		await expect(rig.row(`task:${task}`)).toHaveAttribute('aria-selected', 'true');
		expect(await inView()).toBe('in view');
		await clearFilter(page);
		await expect(rig.row(`task:${task}`)).toHaveAttribute('aria-selected', 'true');
		await expect.poll(inView).toBe('in view');
	});

	test('a filter in one plan is not in the next', async ({ page }, info) => {
		const rig = await open(page, info);
		const r = await resultOf(page);
		const person = aPerson(r);
		await openPanel(page);
		await choosePerson(page, person.id, person.name);
		await closePanel(page);
		await expect(button(page)).toHaveAccessibleName(/Filter:/);
		await page.getByRole('combobox', { name: 'Sample plan' }).selectOption('gantt-manipulation');
		await expect(rig.row('task:design')).toBeVisible({ timeout: READY_TIMEOUT_MS });
		await expect(button(page)).not.toHaveAccessibleName(/Filter:/);
		await expect(page.getByTestId('filter-clear')).toBeHidden();
	});
});

test.describe('a filter whose code cannot be fetched', () => {
	test('says so, over the table and on the pill, and Retry brings the filter back', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'one device is enough: the same code runs');
		await page.route('**/_astro/filter.*.js', (route) => route.abort());
		await open(page, info);
		const r = await resultOf(page);
		const all = (await viewRows(page)).length;
		const person = aPerson(r);
		await openPanel(page);
		await choosePerson(page, person.id, person.name);
		await closePanel(page);
		const note = page.getByTestId('filter-note');
		await expect(note).toHaveText(`Filter ${person.name} could not load`);
		await expect(button(page)).toHaveAccessibleName(
			`Filter: ${person.name}, could not load. Press to retry`,
		);
		// Nothing is claimed: the whole tree shows, and the note says why.
		expect((await viewRows(page)).length).toBe(all);
		await page.unroute('**/_astro/filter.*.js');
		await page.getByRole('button', { name: 'Retry', exact: true }).click();
		await expect(note).toHaveText(
			`${person.name} \u00b7 ${person.tasks.size === 1 ? '1 task' : `${person.tasks.size} tasks`}`,
		);
		await expectRows(page, r, person.tasks, 'after Retry');
	});

	test('the people list says so, and Retry opens it', async ({ page }, info) => {
		test.skip(isTouch(info), 'the picker is a mouse control');
		await page.route('**/_astro/PeopleList.*.js', (route) => route.abort());
		await open(page, info);
		await page.getByTestId('assign-button').click();
		await expect(page.getByRole('alert')).toContainText('The list could not be loaded.');
		await page.unroute('**/_astro/PeopleList.*.js');
		await page.getByRole('alert').getByRole('button', { name: 'Retry', exact: true }).click();
		await expect(page.getByRole('combobox', { name: 'Find a person by name or id' })).toBeVisible();
	});
});

test.describe('the panel opens on the person chosen', () => {
	test('the active option is the chosen person, scrolled into view', async ({ page }, info) => {
		test.skip(isTouch(info), 'a mouse and a keyboard');
		// Named for scale: the last of 24 people sits below the list's fold.
		await open(page, info, 1280, 'fedora-res');
		const r = await resultOf(page);
		// A person far down the list of 24, so that opening on them needs the scroll.
		const people = r.resources.filter((x) => !x.group);
		const last = people[people.length - 1];
		if (!last) throw new Error('no people');
		await openPanel(page);
		await choosePerson(page, last.id, last.name);
		await closePanel(page);
		await openPanel(page);
		const option = panel(page).locator(`[role="option"][data-person="${last.id}"]`);
		await expect(option).toHaveAttribute('aria-selected', 'true');
		await expect(option).toBeInViewport();
		await expect(
			page.getByRole('combobox', { name: 'Find a person to filter by' }),
		).toHaveAttribute('aria-activedescendant', (await option.getAttribute('id')) ?? '');
	});
});

test.describe('the keyboard', () => {
	test('opens, searches, picks a person and a flag, and Escape returns to the button', async ({
		page,
	}, info) => {
		test.skip(isTouch(info), 'a keyboard');
		const rig = await open(page, info);
		const r = await resultOf(page);
		const flags = flagsOfText(await rig.text());
		const person = aPerson(r);
		const withFlag = [...person.tasks].flatMap((t) => [...flagsOfTask(flags, t)]);
		const flag = withFlag[0];
		if (flag === undefined) throw new Error('the person has no flagged task');

		await button(page).focus();
		await page.keyboard.press('Enter');
		const search = page.getByRole('combobox', { name: 'Find a person to filter by' });
		await expect(search).toBeFocused();
		await page.keyboard.type(person.name);
		await page.keyboard.press('Enter');
		await expect(button(page)).toHaveAccessibleName(`Filter: ${person.name}`);
		await expectRows(page, r, person.tasks, 'person by keyboard');
		// Tab leaves the search box for the flags; the arrows pick one.
		await page.keyboard.press('Tab');
		await expect(
			flagRadio(page, 'Any flag').or(panel(page).getByRole('radio', { checked: true })),
		).toBeFocused();
		const names = await panel(page)
			.getByRole('radio')
			.evaluateAll((els) =>
				els.map((e) => e.closest('label')?.querySelector('span')?.textContent ?? ''),
			);
		const steps = names.indexOf(flag);
		expect(steps).toBeGreaterThan(0);
		for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowDown');
		await expect(button(page)).toHaveAccessibleName(`Filter: ${person.name} \u00b7 flag ${flag}`);
		await expectRows(
			page,
			r,
			intersect(person.tasks, tasksWith(r, flags, flag)),
			'person and flag by keyboard',
		);
		await page.keyboard.press('Escape');
		await expect(panel(page)).toBeHidden();
		await expect(button(page)).toBeFocused();
		// The clear button is a tab stop of its own, and Enter takes the filter off.
		await page.keyboard.press('Tab');
		await expect(page.getByTestId('filter-clear')).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(button(page)).not.toHaveAccessibleName(/Filter:/);
	});

	test('Tab out of the panel closes it', async ({ page }, info) => {
		test.skip(isTouch(info), 'a keyboard');
		await open(page, info);
		await button(page).focus();
		await page.keyboard.press('Enter');
		await expect(panel(page)).toBeVisible();
		// Past the last control: the search, the flags, Clear filter (off), Done, then out.
		await panel(page).getByRole('button', { name: 'Done' }).focus();
		await page.keyboard.press('Tab');
		await expect(panel(page)).toBeHidden();
	});
});

async function axe(page: Page, state: string): Promise<void> {
	await animationsDone(page, 3);
	const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const detail = r.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
	);
	expect.soft(detail, state).toEqual([]);
}

test.describe('accessibility', () => {
	for (const scheme of ['light', 'dark'] as const) {
		test(`axe in ${scheme}: the control, the open panel, a filtered chart`, async ({
			page,
		}, info) => {
			await page.emulateMedia({ colorScheme: scheme });
			await open(page, info);
			const r = await resultOf(page);
			const person = aPerson(r);
			await axe(page, `closed (${scheme})`);
			await openPanel(page);
			await axe(page, `panel open (${scheme})`);
			await choosePerson(page, person.id, person.name);
			await chooseFlag(page, 'urgent');
			await axe(page, `panel with a filter (${scheme})`);
			await closePanel(page);
			await axe(page, `filtered (${scheme})`);
			await openPanel(page);
			await chooseFlag(page, 'later');
			await choosePerson(page, person.id, person.name);
			await closePanel(page);
			await axe(page, `nothing matches (${scheme})`);
		});
	}

	test('targets are 44 px on a finger', async ({ page }, info) => {
		test.skip(!isTouch(info), 'a finger');
		await open(page, info);
		const r = await resultOf(page);
		const person = aPerson(r);
		const small = async (l: Locator): Promise<string[]> =>
			l.evaluateAll((els) =>
				els.flatMap((e) => {
					const box = (e.closest('label') ?? e).getBoundingClientRect();
					return box.width < 43.5 || box.height < 43.5
						? [
								`${e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 20)} ${Math.round(box.width)}x${Math.round(box.height)}`,
							]
						: [];
				}),
			);
		expect(await small(button(page))).toEqual([]);
		await openPanel(page);
		expect(
			await small(
				panel(page).locator('button, input[type="radio"], [role="option"], [role="combobox"]'),
			),
		).toEqual([]);
		await choosePerson(page, person.id, person.name);
		await closePanel(page);
		// Under 480 px the pill alone says a filter is on: it has no × beside it (Clear filter is in the panel).
		await expect(page.getByTestId('filter-clear')).toBeHidden();
		await expect(button(page)).toHaveAccessibleName(/^Filter: /);
	});
});

test.describe('the toolbar', () => {
	/** One row: nothing scrolls and nothing is cut off at the right edge of the chart. */
	async function oneRow(page: Page, state: string): Promise<void> {
		await boxStable(page.locator('[data-testid="gantt"] .chips'));
		await ganttSettled(page);
		const m = await page.getByTestId('gantt').evaluate((el) => {
			const chart = el.getBoundingClientRect();
			const chips = [...(el.querySelector('.chips')?.children ?? [])].flatMap((c) => {
				const b = c.getBoundingClientRect();
				return c instanceof HTMLElement && b.width > 4 && b.height > 4 ? [b] : [];
			});
			const mid = (b: DOMRect): number => b.top + b.height / 2;
			return {
				right: chart.right,
				chipRight: Math.max(...chips.map((b) => b.right)),
				spread: Math.max(...chips.map(mid)) - Math.min(...chips.map(mid)),
				filter: !!el.querySelector('[data-testid="filter-button"]'),
			};
		});
		expect(m.filter, state).toBe(true);
		expect(m.spread, `${state}: the controls share a line`).toBeLessThan(6);
		expect(m.chipRight, `${state}: nothing is cut off`).toBeLessThanOrEqual(m.right + 0.5);
	}

	for (const [width, height] of [
		[1500, 900],
		[1280, 720],
		[1024, 768],
		[820, 1000],
	] as const) {
		test(`stays on one row at ${width} px: closed, open, filtered`, async ({ page }, info) => {
			test.skip(isTouch(info), 'a desktop window');
			await page.setViewportSize({ width, height });
			await Rig.open(page, info, 'month', 'visual', 'ui-people');
			const r = await resultOf(page);
			const person = aPerson(r);
			await oneRow(page, 'closed');
			await openPanel(page);
			await oneRow(page, 'open');
			// The panel stays inside the window, whichever side of the button it opens to.
			const box = await panel(page).boundingBox();
			if (!box) throw new Error('no panel');
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
			await choosePerson(page, person.id, person.name);
			await closePanel(page);
			await oneRow(page, 'filtered');
			await rigSelect(page, [...person.tasks][0] as string);
			await oneRow(page, 'filtered, a task selected');
		});
	}

	for (const width of [360, 412]) {
		test(`a phone at ${width} px keeps the row on one line, closed and filtered`, async ({
			page,
		}, info) => {
			test.skip(!isTouch(info), 'a phone');
			await page.setViewportSize({ width, height: 800 });
			await Rig.open(page, info, 'week', 'visual', 'ui-people');
			const r = await resultOf(page);
			const person = aPerson(r);
			await oneRow(page, 'closed');
			await openPanel(page);
			// A sheet at the foot of the chart, as wide as it.
			const sheet = await panel(page).boundingBox();
			const chart = await page.getByTestId('gantt').boundingBox();
			if (!sheet || !chart) throw new Error('no sheet');
			expect(sheet.x).toBeGreaterThanOrEqual(chart.x - 0.5);
			expect(sheet.x + sheet.width).toBeLessThanOrEqual(chart.x + chart.width + 0.5);
			expect(sheet.y + sheet.height).toBeLessThanOrEqual(chart.y + chart.height + 0.5);
			await choosePerson(page, person.id, person.name);
			await closePanel(page);
			await oneRow(page, 'filtered');
		});
	}

	async function rigSelect(page: Page, task: string): Promise<void> {
		await page.locator(`[role="row"][data-key="task:${task}"] .label`).click();
		await expect(page.locator(`[role="row"][data-key="task:${task}"]`)).toHaveAttribute(
			'aria-selected',
			'true',
		);
	}
});
