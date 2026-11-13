// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Test helpers for intents.ts: the gantt-manipulation fixture (tests/fixtures/gantt/manipulation,
 * phase-2.md 7.1) with its committed golden result, the index built with the engine's hints (as
 * the app builds it), the driving analysis, the working time and the drawn links, plus a way to
 * see the files after an action.
 */
import fs from 'node:fs';
import fc from 'fast-check';
import path from 'node:path';
import type { ScheduleResult } from '../../engine/protocol';
import { ROOT } from '../../../tests/grammar/corpus';
import { analyseResult } from '../schedule/critical';
import { workingTimeOf } from '../schedule/working-time';
import { buildIndex, hintsFromResult, type SymbolIndex } from '../tjp/index';
import { golden } from '../tjp/index/testing';
import type { EditOptions } from '../tjp/edit/types';
import { createWorkspace, type WorkspaceSnapshot } from '../workspace/workspace';
import { checkAction, type ActionContext, type ActionOutcome, type GanttAction } from './intents';
import { resolveLinks } from './links';
import { finishScenario } from '../schedule/finish';
import type { RawLink } from './model';

export const FIXTURE = 'gantt-manipulation';

export interface Fixture {
	readonly snap: WorkspaceSnapshot;
	readonly index: SymbolIndex;
	readonly result: ScheduleResult;
	readonly links: readonly RawLink[];
	ctx(over?: Partial<ActionContext>): ActionContext;
	/** The original text of a file. */
	text(file: string): string;
}

export function goldenResult(id: string): ScheduleResult {
	const g = JSON.parse(
		fs.readFileSync(path.join(ROOT, 'engine/golden/expected', `${id}.json`), 'utf8'),
	) as { result: ScheduleResult };
	return g.result;
}

/** A fixture from files and a result (the golden one, or one the engine just made). */
export function fixtureFrom(
	files: Record<string, string>,
	entry: string,
	result: ScheduleResult,
): Fixture {
	const snap = createWorkspace({ entry, files }).snapshot();
	const index = buildIndex(
		snap,
		hintsFromResult(result, (_f, l) => l),
		{ cache: null },
	);
	const analysis = analyseResult(result);
	const wt = result.project ? workingTimeOf(result.project) : null;
	const links = resolveLinks({
		sites: index.dependencies,
		result,
		scenario: finishScenario(result),
		current: true,
	});
	return {
		snap,
		index,
		result,
		links,
		ctx: (over = {}) => ({ index, result, analysis, wt, move: null, ...over }),
		text: (file) => {
			const f = snap.files.get(file);
			if (!f) throw new Error(`no file ${file}`);
			return f.text.toString();
		},
	};
}

export function manipulation(): Fixture {
	const ws = golden(FIXTURE).snapshot();
	const files: Record<string, string> = {};
	for (const [p, f] of ws.files) files[p] = f.text.toString();
	return fixtureFrom(files, ws.entry, goldenResult(FIXTURE));
}

/** Every file after an action that must give an edit (unchanged files as they were). */
export function filesAfter(
	fx: Fixture,
	a: GanttAction,
	over: Partial<ActionContext> = {},
	opts: EditOptions = {},
): Record<string, string> {
	const out = checkAction(a, fx.ctx(over), fx.snap, opts);
	if (out.status !== 'edit') throw new Error(`expected an edit, got ${JSON.stringify(brief(out))}`);
	const files: Record<string, string> = {};
	for (const [p, f] of fx.snap.files) {
		const cs = out.edit.changes[p];
		files[p] = cs ? cs.apply(f.text).toString() : f.text.toString();
	}
	return files;
}

/** An outcome without the edit object, for messages and snapshots. */
export function brief(out: ActionOutcome): unknown {
	return out.status === 'edit' ? { status: 'edit', intent: out.intent, label: out.label } : out;
}

/** `text` with `from` replaced by `to`, exactly once (the hand-written expected patch). */
export function patched(text: string, from: string, to: string): string {
	const at = text.indexOf(from);
	if (at < 0 || text.indexOf(from, at + 1) >= 0) {
		throw new Error(`expected exactly one ${JSON.stringify(from)}`);
	}
	return text.slice(0, at) + to + text.slice(at + from.length);
}

/**
 * Random Gantt actions on a fixture: mostly its own tasks (sometimes a missing one), its
 * resources and its drawn links, with links drawn more often (most random pairs are refused).
 */
export function actionArb(
	fx: Fixture,
	people: readonly string[] = ['dev1', 'dev2', 'dev3', 'ops1'],
): fc.Arbitrary<GanttAction> {
	const TASKS = [...fx.index.tasks.keys()];
	const FRAME_END = fx.ctx().wt?.frameEnd ?? 0;
	const task = fc.oneof(
		{ arbitrary: fc.constantFrom(...TASKS), weight: 9 },
		{ arbitrary: fc.constant('nope'), weight: 1 },
	);
	const parent = fc.oneof(fc.constant(null), fc.constantFrom(...TASKS));
	const person = fc.constantFrom(...people);
	const links =
		fx.links.length > 0
			? [fc.record({ type: fc.constant('unlink' as const), link: fc.constantFrom(...fx.links) })]
			: [];
	return fc.oneof(
		fc.record({
			type: fc.constant('resize' as const),
			task,
			at: fc.integer({ min: -1440, max: FRAME_END + 1440 }),
		}),
		fc.record({
			type: fc.constant('size-step' as const),
			task,
			steps: fc.integer({ min: -4, max: 4 }),
		}),
		fc.record({
			type: fc.constant('move' as const),
			task,
			days: fc.integer({ min: -15, max: 15 }),
		}),
		...Array.from({ length: 4 }, () =>
			fc.record({
				type: fc.constant('link' as const),
				pred: fc.constantFrom(...TASKS),
				succ: fc.constantFrom(...TASKS),
			}),
		),
		...links,
		fc.record({ type: fc.constant('reorder' as const), task, parent, index: fc.nat({ max: 6 }) }),
		fc.record({
			type: fc.constantFrom('assign' as const, 'unassign' as const),
			task,
			resource: person,
		}),
		fc.record({ type: fc.constant('replace-person' as const), task, from: person, to: person }),
		fc.record({ type: fc.constant('rename' as const), task, name: fc.string({ maxLength: 12 }) }),
		fc.record({
			type: fc.constant('progress' as const),
			task,
			percent: fc.integer({ min: -20, max: 130 }),
		}),
		fc.record({
			type: fc.constant('add' as const),
			parent,
			index: fc.nat({ max: 6 }),
			name: fc.string({ minLength: 1, maxLength: 12 }),
		}),
		fc.record({ type: fc.constant('delete' as const), task }),
	);
}
